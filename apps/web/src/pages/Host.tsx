import { useCallback, useState } from "react";
import type { Property } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";

const WS_URL = `${location.protocol === "https:" ? "wss" : "ws"}://${location.hostname}:8787/ws/host`;

type HostState = {
  estado: string;
  pin: string;
  properties: Property[];
  jugadores: { playerId: string; nickname: string; flagged: boolean }[];
  rondaActual: { roundId: string; propiedad: Property; estado: string } | null;
};

export default function Host() {
  const [token, setToken] = useState("dev-host-token");
  const [authed, setAuthed] = useState(false);
  const [state, setState] = useState<HostState | null>(null);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.t === "host:state") setState(msg as unknown as HostState);
    if (msg.t === "error") console.warn(msg);
  }, []);

  const { send, connected } = useSocket(WS_URL, onMessage);

  const login = () => {
    send({ t: "host:join", token });
    setAuthed(true);
  };

  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-archivo text-manila font-body">
        <div className="bg-manila text-archivo rounded-xl p-8 w-full max-w-sm">
          <h1 className="font-display text-2xl mb-4">Consola del presentador</h1>
          <input
            className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Token"
          />
          <button className="w-full bg-sello text-manila py-3 rounded font-display" disabled={!connected} onClick={login}>
            Entrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-archivo text-manila font-body p-8">
      <h1 className="font-display text-2xl mb-1">Consola del presentador</h1>
      <p className="opacity-70 mb-6">
        PIN: <span className="font-mono tabular">{state?.pin ?? "----"}</span> · estado:{" "}
        <span className="font-mono">{state?.estado ?? "-"}</span> · {state?.jugadores.length ?? 0} jugadores
      </p>

      {state?.rondaActual ? (
        <div className="bg-manila/10 rounded-xl p-4 mb-6">
          <p className="font-display text-lg">{state.rondaActual.propiedad.nombre}</p>
          <p className="opacity-70 text-sm mb-3">ronda: {state.rondaActual.estado}</p>
          <div className="flex gap-2">
            <button
              className="bg-sello px-4 py-2 rounded"
              onClick={() => send({ t: "host:repeat", roundId: state.rondaActual!.roundId })}
            >
              Repetir ronda
            </button>
            <button className="bg-manila/20 px-4 py-2 rounded" onClick={() => send({ t: "host:abort" })}>
              Abortar
            </button>
          </div>
        </div>
      ) : (
        <div className="mb-6">
          <p className="opacity-70 mb-3">Elige el inmueble para la siguiente ronda:</p>
          <div className="grid grid-cols-3 gap-3">
            {state?.properties.map((p) => (
              <button
                key={p.id}
                className="bg-manila text-archivo rounded-lg p-4 text-left hover:bg-oro transition"
                onClick={() => send({ t: "host:arm", propertyId: p.id })}
              >
                <p className="font-display">{p.nombre}</p>
                <p className="text-sm opacity-70">{p.ciudad} · {p.avaluo.toLocaleString("es-CO")} COP</p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-6">
        <button className="bg-oro text-archivo px-4 py-2 rounded font-display" onClick={() => send({ t: "host:podium" })}>
          Mostrar podio
        </button>
      </div>

      <div>
        <p className="font-display mb-2">Jugadores</p>
        <div className="flex flex-wrap gap-2">
          {state?.jugadores.map((j) => (
            <span
              key={j.playerId}
              className={`px-3 py-1 rounded-full text-sm ${j.flagged ? "bg-sello" : "bg-manila/10"}`}
            >
              {j.nickname}
              {j.flagged ? " ⚠" : ""}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
