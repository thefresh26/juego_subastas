import { WebSocket } from "ws";
import { nanoid } from "nanoid";
import {
  GAME_CONSTANTS,
  type PlayerSummary,
  type Property,
} from "@subasta/shared";
import { PROPERTIES } from "./properties.js";
import type { PlayerConn, RoomState, RoundState } from "./types.js";

const PIN = "1234"; // fijo en Fase 1 (sala única, sin persistencia)

function safeSend(socket: WebSocket | null, payload: unknown) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

export class GameRoom {
  state: RoomState = {
    pin: PIN,
    valorPorTap: GAME_CONSTANTS.DEFAULT_VALOR_POR_TAP,
    estado: "lobby",
    players: new Map(),
    properties: PROPERTIES,
    currentRound: null,
    roundHistory: [],
    screens: new Set(),
    hosts: new Set(),
  };

  private tickInterval: NodeJS.Timeout | null = null;

  now() {
    return Date.now();
  }

  // ---------- Conexiones ----------

  joinPlayer(nickname: string, resumeToken: string | undefined, socket: WebSocket) {
    let player: PlayerConn;
    if (resumeToken) {
      const existing = [...this.state.players.values()].find((p) => p.resumeToken === resumeToken);
      if (existing) {
        existing.socket = socket;
        existing.nickname = nickname || existing.nickname;
        player = existing;
        this.broadcastHostState();
        return player;
      }
    }
    player = {
      playerId: nanoid(10),
      nickname: nickname.slice(0, 24) || `Jugador-${nanoid(4)}`,
      resumeToken: resumeToken || nanoid(16),
      socket,
      lastSeq: -1,
    };
    this.state.players.set(player.playerId, player);
    this.broadcastLobby();
    this.broadcastHostState();
    return player;
  }

  addScreen(socket: WebSocket) {
    this.state.screens.add(socket);
    this.broadcastLobby();
  }

  removeScreen(socket: WebSocket) {
    this.state.screens.delete(socket);
  }

  addHost(socket: WebSocket) {
    this.state.hosts.add(socket);
    this.broadcastHostState();
  }

  removeHost(socket: WebSocket) {
    this.state.hosts.delete(socket);
  }

  disconnectPlayer(playerId: string) {
    const p = this.state.players.get(playerId);
    if (p) p.socket = null;
    this.broadcastHostState();
  }

  // ---------- Mensajería jugador ----------

  handlePing(playerId: string, t0: number) {
    const p = this.state.players.get(playerId);
    if (!p) return;
    safeSend(p.socket, { t: "pong", t0, t1: this.now() });
  }

  handleTapBatch(
    playerId: string,
    msg: { roundId: string; seq: number; count: number; firstTs: number; lastTs: number; jitter: number }
  ) {
    const round = this.state.currentRound;
    if (!round || round.roundId !== msg.roundId || round.estado !== "running") return;

    const seen = round.seqSeen.get(playerId) ?? new Set<number>();
    if (seen.has(msg.seq)) return; // dedup por reenvío
    seen.add(msg.seq);
    round.seqSeen.set(playerId, seen);

    // Ventana de tiempo autoritativa (ver plan 2.2 / 2.3)
    const windowEnd = round.startAt + round.duracionMs + GAME_CONSTANTS.GRACE_MS;
    if (msg.lastTs < round.startAt || msg.lastTs > windowEnd) {
      const rec = round.recortados.get(playerId) ?? 0;
      round.recortados.set(playerId, rec + msg.count);
      return;
    }

    const prev = round.counts.get(playerId) ?? 0;
    const next = prev + msg.count;
    round.counts.set(playerId, next);
    round.firstReachedAt.set(playerId, this.now());
  }

  // ---------- Ciclo de ronda (host) ----------

  armRound(propertyId: string) {
    const propiedad = this.state.properties.find((p) => p.id === propertyId);
    if (!propiedad) throw new Error("Inmueble no encontrado");

    const roundId = nanoid(12);
    const startAt = this.now() + GAME_CONSTANTS.ARM_LEAD_MS;
    const round: RoundState = {
      roundId,
      propiedad,
      startAt,
      duracionMs: GAME_CONSTANTS.ROUND_DURATION_MS,
      estado: "armed",
      counts: new Map(),
      seqSeen: new Map(),
      recortados: new Map(),
      firstReachedAt: new Map(),
      ganador: null,
    };
    this.state.currentRound = round;
    this.state.estado = "armed";

    const payload = {
      t: "round_armed" as const,
      roundId,
      propiedad,
      startAt,
      duracionMs: round.duracionMs,
    };
    for (const p of this.state.players.values()) safeSend(p.socket, payload);
    for (const s of this.state.screens) safeSend(s, payload);
    this.broadcastHostState();

    // Programar el arranque exacto de la ronda contra el reloj del servidor.
    const delay = startAt - this.now();
    setTimeout(() => this.startTicking(roundId), Math.max(0, delay));
  }

  private startTicking(roundId: string) {
    const round = this.state.currentRound;
    if (!round || round.roundId !== roundId) return;
    round.estado = "running";
    this.state.estado = "running";

    if (this.tickInterval) clearInterval(this.tickInterval);
    this.tickInterval = setInterval(() => this.broadcastTick(), 1000 / GAME_CONSTANTS.TICK_HZ_SCREEN);

    setTimeout(() => this.endRound(roundId), round.duracionMs);
  }

  abortRound() {
    if (this.tickInterval) clearInterval(this.tickInterval);
    this.state.currentRound = null;
    this.state.estado = "lobby";
    this.broadcastHostState();
  }

  repeatRound(roundId: string) {
    const past = this.state.roundHistory.find((r) => r.roundId === roundId) ?? this.state.currentRound;
    if (!past) throw new Error("Ronda no encontrada");
    this.armRound(past.propiedad.id);
  }

  private endRound(roundId: string) {
    const round = this.state.currentRound;
    if (!round || round.roundId !== roundId) return;
    if (this.tickInterval) clearInterval(this.tickInterval);
    round.estado = "ended";
    this.state.estado = "ended";

    const ranking = this.rankRound(round);
    const winner = ranking[0];
    round.ganador = winner
      ? {
          playerId: winner.playerId,
          nickname: this.state.players.get(winner.playerId)?.nickname ?? "?",
          valorFinal: winner.valorPujado,
        }
      : null;

    this.state.roundHistory.push(round);

    for (const p of this.state.players.values()) {
      const misTaps = round.counts.get(p.playerId) ?? 0;
      const miPosicion = ranking.findIndex((r) => r.playerId === p.playerId) + 1 || ranking.length + 1;
      safeSend(p.socket, {
        t: "round_end",
        roundId,
        ganador: round.ganador,
        miPosicion,
        misTaps,
        recortados: round.recortados.get(p.playerId) ?? 0,
      });
    }

    const top5 = ranking.slice(0, 5);
    const screenPayload = {
      t: "round_end" as const,
      roundId,
      ganador: round.ganador,
      valorFinal: round.ganador?.valorFinal ?? 0,
      top5,
    };
    for (const s of this.state.screens) safeSend(s, screenPayload);
    this.broadcastHostState();
  }

  private rankRound(round: RoundState): PlayerSummary[] {
    const rows: PlayerSummary[] = [...this.state.players.values()].map((p) => {
      const taps = round.counts.get(p.playerId) ?? 0;
      return {
        playerId: p.playerId,
        nickname: p.nickname,
        taps,
        valorPujado: taps * this.state.valorPorTap,
        flagged: false,
      };
    });
    rows.sort((a, b) => {
      if (b.taps !== a.taps) return b.taps - a.taps;
      const ta = round.firstReachedAt.get(a.playerId) ?? Infinity;
      const tb = round.firstReachedAt.get(b.playerId) ?? Infinity;
      return ta - tb; // quien llegó primero a ese conteo gana el desempate
    });
    return rows;
  }

  buildPodium() {
    const totals = new Map<string, { adjudicados: number; valor: number; taps: number }>();
    for (const round of this.state.roundHistory) {
      for (const [playerId, taps] of round.counts.entries()) {
        const t = totals.get(playerId) ?? { adjudicados: 0, valor: 0, taps: 0 };
        t.taps += taps;
        if (round.ganador?.playerId === playerId) {
          t.adjudicados += 1;
          t.valor += round.ganador.valorFinal;
        }
        totals.set(playerId, t);
      }
    }
    const titulos = ["El Magnate Inmobiliario", "El Tiburón de los Bienes Raíces", "El Cazador de Ofertas"];
    const rows = [...totals.entries()]
      .map(([playerId, t]) => ({
        playerId,
        nickname: this.state.players.get(playerId)?.nickname ?? "?",
        inmueblesAdjudicados: t.adjudicados,
        valorTotal: t.valor,
        tapsAcumulados: t.taps,
      }))
      .sort((a, b) => b.inmueblesAdjudicados - a.inmueblesAdjudicados || b.valorTotal - a.valorTotal || b.tapsAcumulados - a.tapsAcumulados)
      .map((r, i) => ({ ...r, titulo: titulos[i] }));

    for (const s of this.state.screens) {
      safeSend(s, { t: "podium", top3: rows.slice(0, 3), portafolios: rows });
    }
    return rows;
  }

  // ---------- Broadcasts ----------

  private broadcastTick() {
    const round = this.state.currentRound;
    if (!round || round.estado !== "running") return;
    const remainingMs = Math.max(0, round.startAt + round.duracionMs - this.now());
    const ranking = this.rankRound(round);

    for (const p of this.state.players.values()) {
      const misTaps = round.counts.get(p.playerId) ?? 0;
      const miPosicion = ranking.findIndex((r) => r.playerId === p.playerId) + 1 || ranking.length + 1;
      safeSend(p.socket, {
        t: "tick",
        roundId: round.roundId,
        remainingMs,
        misTaps,
        miPosicion,
        valorActual: misTaps * this.state.valorPorTap,
      });
    }

    const tapsTotales = [...round.counts.values()].reduce((a, b) => a + b, 0);
    const top5 = ranking.slice(0, 5);
    const payload = {
      t: "tick" as const,
      roundId: round.roundId,
      remainingMs,
      top5,
      tapsTotales,
      valorActual: tapsTotales * this.state.valorPorTap,
    };
    for (const s of this.state.screens) safeSend(s, payload);
  }

  broadcastLobby() {
    const payload = {
      t: "lobby" as const,
      pin: this.state.pin,
      qrUrl: `/play?pin=${this.state.pin}`,
      jugadores: [...this.state.players.values()].map((p) => ({ playerId: p.playerId, nickname: p.nickname })),
    };
    for (const s of this.state.screens) safeSend(s, payload);
  }

  broadcastHostState() {
    const payload = {
      t: "host:state" as const,
      estado: this.state.estado,
      pin: this.state.pin,
      properties: this.state.properties,
      jugadores: [...this.state.players.values()].map((p) => ({
        playerId: p.playerId,
        nickname: p.nickname,
        flagged: false,
      })),
      rondaActual: this.state.currentRound
        ? {
            roundId: this.state.currentRound.roundId,
            propiedad: this.state.currentRound.propiedad,
            estado: this.state.currentRound.estado,
          }
        : null,
    };
    for (const h of this.state.hosts) safeSend(h, payload);
  }
}
