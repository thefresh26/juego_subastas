import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import type { Property, PropertyInput } from "@subasta/shared";
import { useSocket } from "../lib/useSocket.js";
import { wsUrl } from "../lib/wsUrl.js";
import { supabase } from "../lib/supabaseClient.js";
import BrandMark from "../components/BrandMark.js";

const WS_URL = wsUrl("/ws/host");

type HostState = {
  estado: string;
  pin: string;
  properties: Property[];
  jugadores: {
    playerId: string;
    nickname: string;
    telefono?: string;
    correo?: string;
    conectado?: boolean;
    flagged: boolean;
  }[];
  rondaActual: { roundId: string; propiedad: Property; estado: string } | null;
};

type LiveTick = {
  roundId: string;
  remainingMs: number;
  top: { playerId: string; nickname: string; taps: number; valorPujado: number; flagged: boolean }[];
  tapsTotales: number;
  valorActual: number;
};

const EMPTY_FORM: PropertyInput = {
  nombre: "",
  ciudad: "",
  tipo: "",
  matriculaInmobiliaria: "",
  areaM2: 0,
  avaluo: 0,
  descripcion: "",
  imagenUrl: "",
};

export default function Host() {
  // --- Login (Supabase Auth email+contraseña, con fallback a token fijo si Supabase no está configurado) ---
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [devToken, setDevToken] = useState("dev-host-token");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  const [state, setState] = useState<HostState | null>(null);
  const [liveTick, setLiveTick] = useState<LiveTick | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [showJugadores, setShowJugadores] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator;

  // --- Formulario de propiedades (crear / editar) ---
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PropertyInput>(EMPTY_FORM);

  // --- Crear nuevos administradores ---
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [nuevoAdminEmail, setNuevoAdminEmail] = useState("");
  const [nuevoAdminPassword, setNuevoAdminPassword] = useState("");
  const [adminMsg, setAdminMsg] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
  const [creandoAdmin, setCreandoAdmin] = useState(false);

  const onMessage = useCallback((data: unknown) => {
    const msg = data as Record<string, unknown>;
    if (msg.t === "host:state") {
      setState(msg as unknown as HostState);
      if (!(msg as unknown as HostState).rondaActual) setLiveTick(null);
    }
    if (msg.t === "host:tick") setLiveTick(msg as unknown as LiveTick);
    if (msg.t === "host:admin_created") {
      setCreandoAdmin(false);
      setAdminMsg({ tipo: "ok", texto: `Administrador creado: ${msg.email}` });
      setNuevoAdminEmail("");
      setNuevoAdminPassword("");
    }
    if (msg.t === "error") {
      setCreandoAdmin(false);
      if (msg.code === "admin_create_failed") {
        setAdminMsg({ tipo: "error", texto: String(msg.mensaje ?? "No se pudo crear el administrador") });
      } else {
        setActionError(String(msg.mensaje ?? "Ocurrió un error"));
      }
    }
  }, []);

  const { send, connected } = useSocket(WS_URL, onMessage);

  const joinWithToken = useCallback(
    (t: string) => {
      send({ t: "host:join", token: t });
      setAuthed(true);
    },
    [send]
  );

  // Si ya hay una sesión de Supabase activa (recarga de página), reusarla.
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setAccessToken(data.session.access_token);
      }
    });
  }, []);

  useEffect(() => {
    if (accessToken && connected && !authed) {
      joinWithToken(accessToken);
    }
  }, [accessToken, connected, authed, joinWithToken]);

  const loginConSupabase = async () => {
    if (!supabase) return;
    setLoggingIn(true);
    setLoginError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoggingIn(false);
    if (error || !data.session) {
      setLoginError(error?.message ?? "No se pudo iniciar sesión");
      return;
    }
    setAccessToken(data.session.access_token);
  };

  const loginConToken = () => {
    joinWithToken(devToken);
  };

  const logout = async () => {
    if (supabase) await supabase.auth.signOut();
    setAuthed(false);
    setAccessToken(null);
    setState(null);
  };

  const openCreateForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEditForm = (p: Property) => {
    setEditingId(p.id);
    setForm({
      nombre: p.nombre,
      ciudad: p.ciudad,
      tipo: p.tipo,
      matriculaInmobiliaria: p.matriculaInmobiliaria,
      areaM2: p.areaM2,
      avaluo: p.avaluo,
      descripcion: p.descripcion ?? "",
      imagenUrl: p.imagenUrl ?? "",
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = () => {
    setActionError(null);
    const data: PropertyInput = {
      ...form,
      areaM2: Number(form.areaM2),
      avaluo: Number(form.avaluo),
      descripcion: form.descripcion || undefined,
      imagenUrl: form.imagenUrl || undefined,
    };
    if (editingId) {
      send({ t: "host:update_property", propertyId: editingId, data });
    } else {
      send({ t: "host:create_property", data });
    }
    closeForm();
  };

  const eliminarPropiedad = (id: string) => {
    if (!window.confirm("¿Eliminar este inmueble? Esta acción no se puede deshacer.")) return;
    send({ t: "host:delete_property", propertyId: id });
  };

  const volverAPonerEnSubasta = (id: string) => {
    send({ t: "host:relist_property", propertyId: id });
  };

  const joinUrl = (pin: string) => `${window.location.origin}/play?pin=${pin}`;

  const copiarEnlace = async (pin: string) => {
    try {
      await navigator.clipboard.writeText(joinUrl(pin));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // clipboard no disponible (permiso o navegador viejo): no hacemos nada más.
    }
  };

  const compartirEnlace = async (pin: string) => {
    try {
      await navigator.share({
        title: "Subasta Activa",
        text: "Únete a la subasta:",
        url: joinUrl(pin),
      });
    } catch {
      // el usuario canceló el share o no está disponible: sin problema.
    }
  };

  const crearAdmin = () => {
    setAdminMsg(null);
    setCreandoAdmin(true);
    send({ t: "host:create_admin", email: nuevoAdminEmail, password: nuevoAdminPassword });
  };

  const passwordValida = nuevoAdminPassword.length >= 6;
  const emailAdminValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevoAdminEmail);

  // ---------- Pantalla de login ----------
  if (!authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-archivo text-manila font-body">
        <div className="bg-manila text-archivo rounded-xl p-8 w-full max-w-sm">
          <BrandMark className="w-12 h-12 mb-3" />
          <h1 className="font-display text-2xl mb-4">Consola del presentador</h1>

          {supabase ? (
            <>
              <input
                className="w-full mb-3 px-3 py-2 rounded border border-archivo/30"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@empresa.com"
                autoComplete="username"
              />
              <input
                className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Contraseña"
                autoComplete="current-password"
                onKeyDown={(e) => e.key === "Enter" && loginConSupabase()}
              />
              {loginError && <p className="text-sello text-sm mb-3">{loginError}</p>}
              <button
                className="w-full bg-sello text-manila py-3 rounded font-display disabled:opacity-50"
                disabled={!connected || loggingIn || !email || !password}
                onClick={loginConSupabase}
              >
                {loggingIn ? "Entrando..." : "Entrar"}
              </button>
            </>
          ) : (
            <>
              <p className="text-sm opacity-70 mb-3">
                Supabase no está configurado en este entorno; usando token de desarrollo.
              </p>
              <input
                className="w-full mb-4 px-3 py-2 rounded border border-archivo/30"
                value={devToken}
                onChange={(e) => setDevToken(e.target.value)}
                placeholder="Token"
              />
              <button
                className="w-full bg-sello text-manila py-3 rounded font-display"
                disabled={!connected}
                onClick={loginConToken}
              >
                Entrar
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  const disponibles = state?.properties.filter((p) => p.estado === "disponible") ?? [];
  const enSubasta = state?.properties.filter((p) => p.estado === "en_subasta") ?? [];
  const adjudicadas = state?.properties.filter((p) => p.estado === "adjudicado") ?? [];

  return (
    <div className="min-h-screen bg-archivo text-manila font-body p-8">
      <div className="flex items-start justify-between mb-1">
        <h1 className="font-display text-2xl">Consola del presentador</h1>
        <div className="flex items-center gap-4">
          <button className="text-sm opacity-70 underline" onClick={() => setShowAdminForm(true)}>
            + Nuevo administrador
          </button>
          <button className="text-sm opacity-70 underline" onClick={logout}>
            Cerrar sesión
          </button>
        </div>
      </div>
      <p className="opacity-70 mb-4">
        PIN: <span className="font-mono tabular">{state?.pin ?? "----"}</span> · estado:{" "}
        <span className="font-mono">{state?.estado ?? "-"}</span> · {state?.jugadores.length ?? 0} jugadores
      </p>

      {state?.pin && (
        <div className="bg-manila/10 rounded-xl p-4 mb-6 flex items-center gap-4">
          <div className="bg-manila p-2 rounded-lg shrink-0">
            <QRCodeSVG value={joinUrl(state.pin)} size={110} />
          </div>
          <div className="flex-1">
            <p className="font-display mb-1">QR de registro para los clientes</p>
            <p className="text-sm opacity-70 mb-2">
              Compártelo o proyéctalo para que escaneen y se registren (nombre, celular, correo) antes de pujar.
              Cualquiera con este enlace puede reenviarlo a otros.
            </p>
            <p className="text-xs font-mono opacity-60 break-all mb-3">{joinUrl(state.pin)}</p>
            <div className="flex gap-2">
              <button
                className="bg-manila text-archivo px-3 py-1.5 rounded text-sm"
                onClick={() => copiarEnlace(state.pin)}
              >
                {copiado ? "¡Copiado!" : "Copiar enlace"}
              </button>
              {canShare && (
                <button
                  className="bg-manila text-archivo px-3 py-1.5 rounded text-sm"
                  onClick={() => compartirEnlace(state.pin)}
                >
                  Compartir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {actionError && (
        <div className="bg-sello/90 text-manila rounded-lg px-4 py-2 mb-6 flex justify-between">
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)}>✕</button>
        </div>
      )}

      {state?.rondaActual ? (
        <div className="bg-manila/10 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-3 mb-1">
            {state.rondaActual.propiedad.imagenUrl && (
              <img
                src={state.rondaActual.propiedad.imagenUrl}
                alt={state.rondaActual.propiedad.nombre}
                className="w-20 h-14 object-cover rounded border border-manila/20 shrink-0"
              />
            )}
            <p className="font-display text-lg">{state.rondaActual.propiedad.nombre}</p>
          </div>
          <p className="opacity-70 text-sm mb-3">
            ronda: {state.rondaActual.estado}
            {liveTick && liveTick.roundId === state.rondaActual.roundId && (
              <> · {Math.ceil(liveTick.remainingMs / 1000)}s · {liveTick.tapsTotales} taps totales</>
            )}
          </p>

          {liveTick && liveTick.roundId === state.rondaActual.roundId && liveTick.top.length > 0 && (
            <div className="flex flex-col gap-1 mb-4">
              {liveTick.top.map((p, i) => (
                <div
                  key={p.playerId}
                  className={`flex justify-between px-3 py-1.5 rounded text-sm ${
                    i === 0 ? "bg-oro text-archivo font-display" : "bg-manila/10"
                  }`}
                >
                  <span>
                    #{i + 1} {p.nickname}
                    {p.flagged ? " ⚠" : ""}
                  </span>
                  <span className="font-mono tabular">
                    {p.taps} taps · {p.valorPujado.toLocaleString("es-CO")} COP
                  </span>
                </div>
              ))}
            </div>
          )}

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
          <p className="opacity-70 mb-3">Elige el inmueble disponible para la siguiente ronda:</p>
          <div className="grid grid-cols-3 gap-3">
            {disponibles.map((p) => (
              <button
                key={p.id}
                className="bg-manila text-archivo rounded-lg p-4 text-left hover:bg-oro transition"
                onClick={() => send({ t: "host:arm", propertyId: p.id })}
              >
                <p className="font-display">{p.nombre}</p>
                <p className="text-sm opacity-70">
                  {p.ciudad} · {p.avaluo.toLocaleString("es-CO")} COP
                </p>
              </button>
            ))}
            {disponibles.length === 0 && <p className="opacity-50 text-sm">No hay inmuebles disponibles.</p>}
          </div>
        </div>
      )}

      <div className="flex gap-3 mb-8">
        <button className="bg-manila/20 px-4 py-2 rounded font-display" onClick={openCreateForm}>
          + Nuevo inmueble
        </button>
      </div>

      {/* ---------- Gestión de inmuebles ---------- */}
      <div className="mb-8">
        <p className="font-display mb-2">Inmuebles</p>

        {enSubasta.length > 0 && (
          <div className="mb-3">
            <p className="text-xs uppercase opacity-50 mb-1">En subasta</p>
            <div className="grid grid-cols-3 gap-3">
              {enSubasta.map((p) => (
                <div key={p.id} className="bg-manila/10 rounded-lg p-3">
                  <p className="font-display">{p.nombre}</p>
                  <p className="text-xs opacity-70">{p.ciudad}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3">
          <p className="text-xs uppercase opacity-50 mb-1">Disponibles</p>
          <div className="grid grid-cols-3 gap-3">
            {disponibles.map((p) => (
              <div key={p.id} className="bg-manila text-archivo rounded-lg p-3">
                <p className="font-display">{p.nombre}</p>
                <p className="text-xs opacity-70 mb-2">
                  {p.ciudad} · {p.tipo} · {p.areaM2} m²
                </p>
                <div className="flex gap-2 text-xs">
                  <button className="underline" onClick={() => openEditForm(p)}>
                    Editar
                  </button>
                  <button className="underline text-sello" onClick={() => eliminarPropiedad(p.id)}>
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
            {disponibles.length === 0 && <p className="opacity-50 text-sm">Ninguno.</p>}
          </div>
        </div>

        {adjudicadas.length > 0 && (
          <div>
            <p className="text-xs uppercase opacity-50 mb-1">Adjudicados</p>
            <div className="grid grid-cols-3 gap-3">
              {adjudicadas.map((p) => (
                <div key={p.id} className="bg-manila/10 rounded-lg p-3">
                  <p className="font-display">{p.nombre}</p>
                  <p className="text-xs opacity-70 mb-2">{p.ciudad}</p>
                  <div className="flex gap-2 text-xs">
                    <button className="underline" onClick={() => volverAPonerEnSubasta(p.id)}>
                      Volver a poner en subasta
                    </button>
                    <button className="underline" onClick={() => openEditForm(p)}>
                      Editar
                    </button>
                    <button className="underline text-sello" onClick={() => eliminarPropiedad(p.id)}>
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        className="bg-manila/20 px-4 py-2 rounded font-display"
        onClick={() => setShowJugadores(true)}
      >
        Ver participantes ({state?.jugadores.length ?? 0})
      </button>

      {/* ---------- Modal crear/editar inmueble ---------- */}
      {showForm && (
        <div className="fixed inset-0 bg-archivo/80 flex items-center justify-center p-4">
          <div className="bg-manila text-archivo rounded-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
            <h2 className="font-display text-xl mb-4">{editingId ? "Editar inmueble" : "Nuevo inmueble"}</h2>
            <div className="flex flex-col gap-3">
              <input
                className="px-3 py-2 rounded border border-archivo/30"
                placeholder="Nombre"
                value={form.nombre}
                onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              />
              <input
                className="px-3 py-2 rounded border border-archivo/30"
                placeholder="Ciudad"
                value={form.ciudad}
                onChange={(e) => setForm({ ...form, ciudad: e.target.value })}
              />
              <input
                className="px-3 py-2 rounded border border-archivo/30"
                placeholder="Tipo (apartamento, lote, local...)"
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
              />
              <input
                className="px-3 py-2 rounded border border-archivo/30"
                placeholder="Matrícula inmobiliaria"
                value={form.matriculaInmobiliaria}
                onChange={(e) => setForm({ ...form, matriculaInmobiliaria: e.target.value })}
              />
              <div className="flex gap-3">
                <input
                  className="px-3 py-2 rounded border border-archivo/30 flex-1"
                  type="number"
                  placeholder="Área (m²)"
                  value={form.areaM2 || ""}
                  onChange={(e) => setForm({ ...form, areaM2: Number(e.target.value) })}
                />
                <input
                  className="px-3 py-2 rounded border border-archivo/30 flex-1"
                  type="number"
                  placeholder="Avalúo (COP)"
                  value={form.avaluo || ""}
                  onChange={(e) => setForm({ ...form, avaluo: Number(e.target.value) })}
                />
              </div>
              <textarea
                className="px-3 py-2 rounded border border-archivo/30"
                placeholder="Descripción (opcional)"
                value={form.descripcion}
                onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              />
              <input
                className="px-3 py-2 rounded border border-archivo/30"
                placeholder="URL de imagen (opcional)"
                value={form.imagenUrl}
                onChange={(e) => setForm({ ...form, imagenUrl: e.target.value })}
              />
            </div>
            <div className="flex gap-2 mt-5">
              <button
                className="bg-sello text-manila px-4 py-2 rounded font-display flex-1 disabled:opacity-50"
                disabled={!form.nombre || !form.ciudad || !form.tipo || !form.matriculaInmobiliaria || !form.areaM2 || !form.avaluo}
                onClick={submitForm}
              >
                {editingId ? "Guardar cambios" : "Crear inmueble"}
              </button>
              <button className="bg-archivo/10 px-4 py-2 rounded font-display" onClick={closeForm}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modal lista de participantes ---------- */}
      {showJugadores && (
        <div className="fixed inset-0 bg-archivo/80 flex items-center justify-center p-4">
          <div className="bg-manila text-archivo rounded-xl p-6 w-full max-w-lg max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-xl">Participantes ({state?.jugadores.length ?? 0})</h2>
              <button className="text-sm underline" onClick={() => setShowJugadores(false)}>
                Cerrar
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {state?.jugadores.map((j) => (
                <div key={j.playerId} className="bg-archivo/5 rounded-lg p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-display">
                      {j.nickname}
                      {j.flagged ? " ⚠" : ""}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${j.conectado ? "bg-oro" : "bg-archivo/10"}`}>
                      {j.conectado ? "conectado" : "desconectado"}
                    </span>
                  </div>
                  <p className="text-sm opacity-70">{j.telefono || "sin celular"}</p>
                  <p className="text-sm opacity-70">{j.correo || "sin correo"}</p>
                </div>
              ))}
              {(state?.jugadores.length ?? 0) === 0 && (
                <p className="opacity-50 text-sm">Todavía no se ha registrado nadie.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ---------- Modal crear administrador ---------- */}
      {showAdminForm && (
        <div className="fixed inset-0 bg-archivo/80 flex items-center justify-center p-4">
          <div className="bg-manila text-archivo rounded-xl p-6 w-full max-w-sm">
            <h2 className="font-display text-xl mb-1">Nuevo administrador</h2>
            <p className="text-sm opacity-70 mb-4">
              Se crea directamente en Supabase Auth y puede entrar a esta consola de inmediato.
            </p>

            {adminMsg && (
              <p className={`text-sm mb-3 ${adminMsg.tipo === "ok" ? "text-green-700" : "text-sello"}`}>
                {adminMsg.texto}
              </p>
            )}

            <label className="block text-xs uppercase tracking-wide mb-1">Correo</label>
            <input
              className="w-full mb-3 px-3 py-2 rounded border border-archivo/30"
              type="email"
              value={nuevoAdminEmail}
              onChange={(e) => setNuevoAdminEmail(e.target.value)}
              placeholder="nuevo.admin@empresa.com"
            />

            <label className="block text-xs uppercase tracking-wide mb-1">Contraseña</label>
            <input
              className="w-full mb-1 px-3 py-2 rounded border border-archivo/30"
              type="password"
              value={nuevoAdminPassword}
              onChange={(e) => setNuevoAdminPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
            />
            <p className="text-xs opacity-50 mb-4">Mínimo 6 caracteres.</p>

            <div className="flex gap-2">
              <button
                className="bg-sello text-manila px-4 py-2 rounded font-display flex-1 disabled:opacity-50"
                disabled={!emailAdminValido || !passwordValida || creandoAdmin}
                onClick={crearAdmin}
              >
                {creandoAdmin ? "Creando..." : "Crear administrador"}
              </button>
              <button
                className="bg-archivo/10 px-4 py-2 rounded font-display"
                onClick={() => {
                  setShowAdminForm(false);
                  setAdminMsg(null);
                }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
