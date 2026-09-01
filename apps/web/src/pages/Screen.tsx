import { useCallback, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Property } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { wsUrl } from "../lib/wsUrl.js";
import { useFlip } from "../lib/useFlip.js";
import BrandMark from "../components/BrandMark.js";
import BarraTiempo from "../components/BarraTiempo.js";

const WS_URL = wsUrl("/ws/screen");

type PlayerSummary = { playerId: string; nickname: string; taps: number; valorPujado: number };
type Portafolio = { playerId: string; nickname: string; inmueblesAdjudicados: number; valorTotal: number; titulo?: string };

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
        <BrandMark className="w-14 h-14 mb-6" />
        <p className="font-mono tabular text-6xl mb-4">{pin}</p>
        {joinUrl ? (
          <div className="qr-border bg-manila p-4 rounded-xl mb-6">
            <QRCodeSVG value={joinUrl} size={220} />
          </div>
        ) : null}
        <p className="opacity-70 mb-8">Escanea el código QR para participar</p>
        <p className="opacity-50">{jugadores.length} jugador(es) conectado(s)</p>
      </FullScreen>
    );
  }

  return (
    <FullScreen>
      {sello ? (
        <div className="text-center scale-in-overshoot">
          <div className="border-8 border-sello rounded-full px-10 py-6 rotate-[-6deg] inline-block">
            <p className="font-display text-4xl text-sello">ADJUDICADO</p>
          </div>
          <p className="font-display text-2xl mt-6">{sello.ganador}</p>
          <p className="font-mono tabular text-xl mt-1">{sello.valorFinal.toLocaleString("es-CO")} COP</p>
        </div>
      ) : (
        <>
          {propiedad.imagenUrl && (
            <img
              src={propiedad.imagenUrl}
              alt={propiedad.nombre}
              className="w-80 h-52 object-cover rounded-xl mb-4 border-4 border-manila/20"
            />
          )}
          <p className="font-mono text-sm uppercase opacity-70">{propiedad.matriculaInmobiliaria}</p>
          <h2 className="font-display text-3xl mt-1">{propiedad.nombre}</h2>
          <p className="opacity-70">{propiedad.ciudad} · {propiedad.areaM2} m² · avalúo {propiedad.avaluo.toLocaleString("es-CO")} COP</p>
          <p className="font-mono tabular text-6xl mt-8">{Math.ceil(remainingMs / 1000)}s</p>
          <BarraTiempo remainingMs={remainingMs} duracionMs={duracionMs} className="w-96 mt-4" />
          <p className="opacity-60 mt-2">{tapsTotales} taps totales</p>
          <div ref={top5FlipRef} className="mt-8 flex flex-col gap-2 w-96">
            {top5.map((p, i) => (
              <div
                key={p.playerId}
                data-flip-key={p.playerId}
                className={`flex justify-between rounded px-4 py-2 transition-colors duration-300 ${
                  i === 0 ? "bg-oro text-archivo font-display" : "bg-manila/10"
                }`}
              >
                <span>#{i + 1} {p.nickname}</span>
                <span className="font-mono tabular">{p.valorPujado.toLocaleString("es-CO")} COP</span>
              </div>
            ))}
          </div>
        </>
      )}
    </FullScreen>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center bg-gradient-to-br from-archivo via-navy3 to-archivo text-manila font-body">
      {children}
    </div>
  );
}
