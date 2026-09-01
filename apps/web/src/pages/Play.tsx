import { useCallback, useEffect, useRef, useState } from "react";
import type { Property } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { ServerClock } from "../lib/clock.js";
import { wsUrl } from "../lib/wsUrl.js";

type Fase = "join" | "esperando" | "armado" | "corriendo" | "fin";

const WS_URL = wsUrl("/ws/player");

export default function Play() {
  const clockRef = useRef(new ServerClock());
  const pinFromQr = new URLSearchParams(window.location.search).get("pin");
  const [fase, setFase] = useState<Fase>("join");
  const [pin, setPin] = useState(pinFromQr ?? "1234");
  const [nickname, setNickname] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correo, setCorreo] = useState("");
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [valorPorTap, setValorPorTap] = useState(1_000_000);

  const [propiedad, setPropiedad] = useState<Property | null>(null);
  const [startAt, setStartAt] = useState(0);
  const [duracionMs, setDuracionMs] = useState(30_000);
  const [roundId, setRoundId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(0);
  const [remainingMs, setRemainingMs] = useState(0);

  const [misTaps, setMisTaps] = useState(0); // conteo optimista local
  const [servidorTaps, setServidorTaps] = useState(0);
  const [miPosicion, setMiPosicion] = useState(0);
  const [lider, setLider] = useState<{ nickname: string; taps: number } | null>(null);
  const [coins, setCoins] = useState<{ id: number; x: number }[]>([]);
  const coinIdRef = useRef(0);
  const [resultado, setResultado] = useState<{
    ganador: { nickname: string; valorFinal: number } | null;
    misTaps: number;
    recortados: number;
  } | null>(null);

  const seqRef = useRef(0);
  const pendingTapsRef = useRef(0);
  const tapTimestampsRef = useRef<number[]>([]);
  const roundActiveRef = useRef(false);
  const resumeTokenRef = useRef<string | undefined>(localStorage.getItem("subasta_resume") ?? undefined);
  const roundIdRef = useRef<string | null>(null);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    switch (msg.t) {
      case "joined": {
        setPlayerId(msg.playerId as string);
        setValorPorTap(msg.valorPorTap as number);
        resumeTokenRef.current = msg.resumeToken as string;
        localStorage.setItem("subasta_resume", msg.resumeToken as string);
        setFase("esperando");
        break;
      }
      case "round_armed": {
        setPropiedad(msg.propiedad as Property);
        setStartAt(msg.startAt as number);
        setDuracionMs(msg.duracionMs as number);
        setRoundId(msg.roundId as string);
        roundIdRef.current = msg.roundId as string;
        seqRef.current = 0;
        pendingTapsRef.current = 0;
        tapTimestampsRef.current = [];
        setMisTaps(0);
        setServidorTaps(0);
        setLider(null);
        setCoins([]);
        setFase("armado");
        break;
      }
      case "tick": {
        setRemainingMs(msg.remainingMs as number);
        setServidorTaps(msg.misTaps as number);
        setMiPosicion(msg.miPosicion as number);
        setLider((msg.lider as { nickname: string; taps: number } | null) ?? null);
        break;
      }
      case "round_end": {
        roundActiveRef.current = false;
        setResultado({
          ganador: msg.ganador as { nickname: string; valorFinal: number } | null,
          misTaps: msg.misTaps as number,
          recortados: msg.recortados as number,
        });
        setFase("fin");
        break;
      }
      case "pong": {
        clockRef.current.addSample(msg.t0 as number, msg.t1 as number);
        break;
      }
      case "error": {
        console.warn("[server error]", msg);
        break;
      }
    }
  }, []);

  const { send, connected } = useSocket(WS_URL, onMessage);

  // Ping periódico para calibrar el reloj.
  useEffect(() => {
    if (!connected) return;
    const iv = setInterval(() => send({ t: "ping", t0: Date.now() }), 2000);
    send({ t: "ping", t0: Date.now() });
    return () => clearInterval(iv);
  }, [connected, send]);

  // Cuenta regresiva contra el reloj corregido del servidor.
  useEffect(() => {
    if (fase !== "armado") return;
    const iv = setInterval(() => {
      const msLeft = startAt - clockRef.current.now();
      if (msLeft <= 0) {
        clearInterval(iv);
        roundActiveRef.current = true;
        setFase("corriendo");
      } else {
        setCountdown(Math.ceil(msLeft / 1000));
      }
    }, 50);
    return () => clearInterval(iv);
  }, [fase, startAt]);

  // Envío del lote de taps cada 150ms.
  useEffect(() => {
    if (fase !== "corriendo") return;
    const iv = setInterval(() => {
      const count = pendingTapsRef.current;
      if (count === 0) return;
      pendingTapsRef.current = 0;

      const stamps = tapTimestampsRef.current;
      tapTimestampsRef.current = [];
      const firstTs = stamps[0] ?? Date.now();
      const lastTs = stamps[stamps.length - 1] ?? Date.now();
      const jitter = stddev(intervals(stamps));

      seqRef.current += 1;
      send({
        t: "tap_batch",
        roundId: roundIdRef.current,
        seq: seqRef.current,
        count,
        firstTs,
        lastTs,
        jitter,
      });
    }, 150);
    return () => clearInterval(iv);
  }, [fase, send]);

  const onJoin = () => {
    send({ t: "join", pin, nickname, telefono, correo, resumeToken: resumeTokenRef.current });
  };

  const emailValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
  const puedeEntrar =
    connected && nickname.trim().length > 0 && telefono.trim().length > 0 && emailValido;

  const onTap = (e: React.PointerEvent) => {
    if (!e.isTrusted || !roundActiveRef.current) return;
    pendingTapsRef.current += 1;
    tapTimestampsRef.current.push(Date.now());
    setMisTaps((n) => n + 1);
    if (navigator.vibrate) navigator.vibrate(8);

    // Solo visual: una monedita que sube y se desvanece con cada tap.
    const id = coinIdRef.current++;
    const x = (Math.random() - 0.5) * 160; // desplazamiento horizontal aleatorio
    setCoins((cs) => [...cs, { id, x }]);
    setTimeout(() => setCoins((cs) => cs.filter((c) => c.id !== id)), 900);
  };

  if (fase === "join") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-archivo px-6">
        <div className="bg-manila text-archivo rounded-xl p-8 w-full max-w-sm font-body">
          <h1 className="font-display text-2xl mb-1">Subasta Activa</h1>
          <p className="text-sm mb-6 opacity-70">Completa tus datos para participar en la subasta.</p>

          {!pinFromQr && (
            <>
              <label className="block text-xs uppercase tracking-wide mb-1">PIN</label>
              <input
                className="w-full mb-4 px-3 py-2 rounded border border-archivo/30 font-mono tabular"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                inputMode="numeric"
              />
            </>
          )}

          <label className="block text-xs uppercase tracking-wide mb-1">Nombre</label>
          <input
            className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="Tu nombre en pantalla"
          />

          <label className="block text-xs uppercase tracking-wide mb-1">Celular</label>
          <input
            className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
            placeholder="300 123 4567"
            inputMode="tel"
          />

          <label className="block text-xs uppercase tracking-wide mb-1">Correo</label>
          <input
            className="w-full mb-6 px-3 py-2 rounded border border-archivo/30"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            placeholder="correo@empresa.com"
            type="email"
          />

          <button
            className="w-full bg-sello text-manila py-3 rounded font-display disabled:opacity-40"
            disabled={!puedeEntrar}
            onClick={onJoin}
          >
            {connected ? "Entrar" : "Conectando..."}
          </button>
        </div>
      </div>
    );
  }

  if (fase === "esperando") {
    return (
      <Centered>
        <p className="font-display text-xl">Estás dentro, {nickname}.</p>
        <p className="opacity-70 mt-2">Esperando a que el presentador arme la siguiente ronda…</p>
      </Centered>
    );
  }

  if (fase === "armado") {
    return (
      <Centered>
        <p className="font-mono text-sm uppercase tracking-wide opacity-70">{propiedad?.nombre}</p>
        <p className="font-display text-7xl tabular mt-4">{countdown > 0 ? countdown : "¡YA!"}</p>
        <p className="mt-4 opacity-70">Prepara el pulgar.</p>
      </Centered>
    );
  }

  if (fase === "corriendo") {
    const voyGanando = lider && lider.nickname === nickname;
    return (
      <div
        className="min-h-screen bg-sello select-none flex flex-col items-center justify-center gap-8 relative overflow-hidden"
        style={{ touchAction: "manipulation", overscrollBehavior: "none", WebkitTapHighlightColor: "transparent" }}
        onPointerDown={onTap}
      >
        <div className="flex flex-col items-center pointer-events-none">
          <span className="font-mono tabular text-manila text-6xl font-bold">{misTaps}</span>
          <span className="text-manila/80 mt-2">TAPS — {(misTaps * valorPorTap).toLocaleString("es-CO")} COP</span>
          <span className="text-manila/60 mt-6 font-mono tabular">{Math.ceil(remainingMs / 1000)}s</span>
          <span className="text-manila/40 text-xs mt-1">posición #{miPosicion || "-"} · servidor: {servidorTaps}</span>
          {lider && (
            <span className={`text-sm mt-3 font-display ${voyGanando ? "text-oro" : "text-manila/70"}`}>
              {voyGanando ? "🏆 ¡Vas ganando!" : `🏆 Va ganando: ${lider.nickname}`}
            </span>
          )}
        </div>

        <button
          type="button"
          className="w-56 h-56 rounded-full bg-manila text-archivo font-display text-3xl tracking-wide shadow-[0_0_0_10px_rgba(0,0,0,0.08)] active:scale-90 transition-transform relative"
        >
          ¡PUJA!
          {coins.map((c) => (
            <span
              key={c.id}
              className="coin-float absolute text-3xl pointer-events-none"
              style={{ left: `calc(50% + ${c.x}px)`, bottom: "50%" }}
            >
              🪙
            </span>
          ))}
        </button>
      </div>
    );
  }

  // fase === "fin"
  return (
    <Centered>
      <p className="font-display text-2xl mb-2">
        {resultado?.ganador ? "Ronda cerrada" : "Ronda cerrada, sin adjudicación"}
      </p>
      {resultado?.ganador && (
        <p className="opacity-80 mb-4">
          Ganó <span className="text-oro font-semibold">{resultado.ganador.nickname}</span> con{" "}
          {resultado.ganador.valorFinal.toLocaleString("es-CO")} COP
        </p>
      )}
      <p className="font-mono tabular">Tus taps válidos: {resultado?.misTaps ?? 0}</p>
      {(resultado?.recortados ?? 0) > 0 && (
        <p className="text-sm opacity-60 mt-1">{resultado?.recortados} taps descartados (fuera de ventana)</p>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-archivo text-manila px-6 font-body">
      {children}
    </div>
  );
}

function intervals(stamps: number[]) {
  const out: number[] = [];
  for (let i = 1; i < stamps.length; i++) out.push(stamps[i] - stamps[i - 1]);
  return out;
}

function stddev(values: number[]) {
  if (values.length === 0) return 999; // sin datos suficientes: no se marca
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
