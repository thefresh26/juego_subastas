import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Property } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { wsUrl } from "../lib/wsUrl.js";
import { useFlip } from "../lib/useFlip.js";
import { usePrefersReducedMotion } from "../lib/useReducedMotion.js";
import BrandMark from "../components/BrandMark.js";
import BarraTiempo from "../components/BarraTiempo.js";

const WS_URL = wsUrl("/ws/screen");

type PlayerSummary = { playerId: string; nickname: string; taps: number; valorPujado: number };
type Portafolio = { playerId: string; nickname: string; inmueblesAdjudicados: number; valorTotal: number; titulo?: string };

type PiezaConfeti = { id: number; left: number; delay: number; duracion: number; rot: number; color: string };

const CONFETTI_COLORES = ["bg-oro", "bg-azul", "bg-esmeralda", "bg-manila"];

function generarConfeti(cantidad: number): PiezaConfeti[] {
  return Array.from({ length: cantidad }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 700,
    duracion: 2200 + Math.random() * 1400,
    rot: Math.random() * 360,
    color: CONFETTI_COLORES[i % CONFETTI_COLORES.length],
  }));
}

export default function Screen() {
  const [pin, setPin] = useState("----");
  const [jugadores, setJugadores] = useState<{ playerId: string; nickname: string }[]>([]);
  const [propiedad, setPropiedad] = useState<Property | null>(null);
  const [remainingMs, setRemainingMs] = useState(0);
  const [duracionMs, setDuracionMs] = useState(30_000);
  const [top5, setTop5] = useState<PlayerSummary[]>([]);
  const [tapsTotales, setTapsTotales] = useState(0);
  const [sello, setSello] = useState<{ ganador: string; valorFinal: number } | null>(null);
  const [podio, setPodio] = useState<Portafolio[] | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [confetti, setConfetti] = useState<PiezaConfeti[]>([]);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    switch (msg.t) {
      case "lobby":
        setPin(msg.pin as string);
        setJugadores(msg.jugadores as { playerId: string; nickname: string }[]);
        setQrUrl(msg.qrUrl as string);
        break;
      case "round_armed":
        setPropiedad(msg.propiedad as Property);
        setDuracionMs(msg.duracionMs as number);
        setSello(null);
        setTop5([]);
        break;
      case "tick":
        setRemainingMs(msg.remainingMs as number);
        setTop5(msg.top5 as PlayerSummary[]);
        setTapsTotales(msg.tapsTotales as number);
        break;
      case "round_end":
        setSello(
          (msg.ganador as { nickname: string; valorFinal: number } | null)
            ? { ganador: (msg.ganador as { nickname: string }).nickname, valorFinal: msg.valorFinal as number }
            : null
        );
        setTop5(msg.top5 as PlayerSummary[]);
        break;
      case "podium":
        setPodio(msg.portafolios as Portafolio[]);
        break;
    }
  }, []);

  useSocket(WS_URL, onMessage);

  const top5FlipRef = useFlip(top5.map((p) => p.playerId));
  const reducedMotion = usePrefersReducedMotion();

  // Genera las posiciones del confeti una sola vez por adjudicación (no en
  // cada render): se regenera cuando `sello` pasa de null a un valor.
  useEffect(() => {
    if (sello) setConfetti(generarConfeti(36));
  }, [sello]);

  if (podio) {
    return (
      <FullScreen>
        <h1 className="font-display text-4xl mb-8">Podio final</h1>
        <div className="flex gap-6">
          {podio.slice(0, 3).map((p, i) => (
            <div key={p.playerId} className="bg-manila text-archivo rounded-xl p-6 w-64 text-center">
              <p className="text-oro font-mono text-sm">#{i + 1}</p>
              <p className="font-display text-xl mt-2">{p.nickname}</p>
              <p className="text-sm opacity-70 mt-1">{p.titulo}</p>
              <p className="font-mono tabular mt-3">
                {p.inmueblesAdjudicados} activos · {p.valorTotal.toLocaleString("es-CO")} COP
              </p>
            </div>
          ))}
        </div>
      </FullScreen>
    );
  }

  if (!propiedad) {
    const joinUrl = qrUrl ? `${window.location.origin}${qrUrl}` : null;
    return (
      <FullScreen>
        <BrandMark className="w-16 h-16 mb-6" />
        {joinUrl ? (
          <div className="bg-manila p-6 rounded-xl mb-6">
            <QRCodeSVG value={joinUrl} size={340} />
          </div>
        ) : null}
        <p className="opacity-70 mb-8">Escanea el código QR para participar</p>
        <p className="opacity-50">{jugadores.length} jugador(es) conectado(s)</p>
      </FullScreen>
    );
  }

  if (sello) {
    return (
      <FullScreen>
        {!reducedMotion && (
          <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
            {confetti.map((p) => (
              <span
                key={p.id}
                className={`confetti-piece absolute top-0 w-2 h-3 rounded-sm ${p.color}`}
                style={
                  {
                    left: `${p.left}%`,
                    "--confetti-duration": `${p.duracion}ms`,
                    "--confetti-delay": `${p.delay}ms`,
                    "--confetti-rot": `${p.rot}deg`,
                  } as React.CSSProperties
                }
              />
            ))}
          </div>
        )}
        <div className="relative z-10 text-center scale-in-overshoot">
          <p className={`text-7xl ${!reducedMotion ? "trophy-bounce" : ""}`} aria-hidden="true">
            🏆
          </p>
          <p className={`font-display text-5xl text-oro mt-4 ${!reducedMotion ? "winner-glow" : ""}`}>
            ¡Ha ganado {sello.ganador}!
          </p>
          <p className="font-mono tabular text-2xl mt-3">{sello.valorFinal.toLocaleString("es-CO")} COP</p>
        </div>
      </FullScreen>
    );
  }

  // Ronda en vivo: la foto del inmueble es la protagonista (se ve desde
  // lejos en el proyector), con el resto de datos organizados alrededor.
  return (
    <div className="min-h-screen bg-gradient-to-br from-archivo via-navy3 to-archivo text-manila font-body flex items-center justify-center p-6 lg:p-10">
      <FullscreenButton />
      <div className="w-full max-w-7xl grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-8 lg:gap-12 items-center">
        <div className="relative">
          {propiedad.imagenUrl ? (
            <img
              src={propiedad.imagenUrl}
              alt={propiedad.nombre}
              className="w-full h-[42vh] lg:h-[72vh] object-cover rounded-2xl border-4 border-manila/20 shadow-2xl"
            />
          ) : (
            <div className="w-full h-[42vh] lg:h-[72vh] rounded-2xl bg-manila/10 border-4 border-manila/20 flex items-center justify-center">
              <BrandMark className="w-20 h-20 opacity-40" />
            </div>
          )}
          <div className="absolute bottom-4 left-4 lg:bottom-6 lg:left-6 bg-archivo/85 rounded-xl px-5 py-3 lg:px-6 lg:py-4">
            <p className="font-mono tabular text-4xl lg:text-6xl">{Math.ceil(remainingMs / 1000)}s</p>
          </div>
        </div>

        <div className="text-left">
          <p className="font-mono text-sm uppercase opacity-70">{propiedad.matriculaInmobiliaria}</p>
          <h2 className="font-display text-3xl lg:text-5xl mt-1">{propiedad.nombre}</h2>
          <p className="opacity-70 text-base lg:text-lg mt-2">
            {propiedad.ciudad} · {propiedad.areaM2} m² · avalúo {propiedad.avaluo.toLocaleString("es-CO")} COP
          </p>
          <BarraTiempo remainingMs={remainingMs} duracionMs={duracionMs} className="mt-6" />
          <p className="opacity-60 mt-2">{tapsTotales} taps totales</p>
          <div
            ref={top5FlipRef}
            className="mt-6 flex flex-col gap-2 bg-gradient-to-b from-navy3/40 to-archivo/40 backdrop-blur-sm rounded-xl border border-manila/10 shadow-lg shadow-black/20 p-6"
          >
            {(() => {
              const valorMaximo = Math.max(...top5.map((p) => p.valorPujado), 1);
              return top5.map((p, i) => {
                const pct = (p.valorPujado / valorMaximo) * 100;
                const esLider = i === 0;
                return (
                  <div
                    key={p.playerId}
                    data-flip-key={p.playerId}
                    className={`relative overflow-hidden rounded-lg ${esLider ? "border-2 border-oro" : ""}`}
                  >
                    <div
                      className="absolute inset-y-0 left-0 bg-azul/25 rounded-r-full transition-all duration-300 ease-out"
                      style={{ width: `${pct}%` }}
                    />
                    <div
                      className={`relative z-10 flex items-center justify-between px-4 py-2.5 ${
                        esLider ? "text-oro font-display" : "text-manila"
                      }`}
                    >
                      <span className="text-xl">
                        {esLider && "🏆 "}#{i + 1} {p.nickname}
                      </span>
                      <span key={p.valorPujado} className="value-pop font-mono tabular text-2xl lg:text-3xl">
                        {p.valorPujado.toLocaleString("es-CO")} COP
                      </span>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-escenario text-manila font-body">
      <FullscreenButton />
      {children}
    </div>
  );
}

/** Botón discreto para entrar/salir de pantalla completa (proyector). */
function FullscreenButton() {
  const [pantallaCompleta, setPantallaCompleta] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement
  );

  useEffect(() => {
    const onChange = () => setPantallaCompleta(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const alternar = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  };

  return (
    <button
      type="button"
      aria-label={pantallaCompleta ? "Salir de pantalla completa" : "Pantalla completa"}
      className="fixed top-4 right-4 z-50 w-11 h-11 flex items-center justify-center rounded-full bg-manila/10 text-manila opacity-30 hover:opacity-100 transition-opacity duration-150"
      onClick={alternar}
    >
      {pantallaCompleta ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V5a1 1 0 0 0-1-1H4m0 0l5 5M9 15v4a1 1 0 0 1-1 1H4m0 0l5-5m6-10v4a1 1 0 0 0 1 1h4m0 0l-5-5m5 15h-4a1 1 0 0 1-1-1v-4m0 0l5 5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
        </svg>
      )}
    </button>
  );
}
