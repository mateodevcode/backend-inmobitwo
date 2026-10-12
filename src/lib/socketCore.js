import {
  SOCKET_CORE_URL,
  SOCKET_CORE_API_KEY,
  SOCKET_CORE_ORIGIN,
  SOCKET_CORE_WS_PUBLIC_URL,
} from "../config.js";

// Cliente de socket-core (SOLO transporte en tiempo real).
// La API key nunca sale al navegador: todas las llamadas llevan X-Api-Key
// desde el backend. Nada de lo publicado incluye contenido en los logs.

const TIMEOUT_MS = 3000;

// uuid del canal por nombre (se invalida si socket-core responde "Channel not found").
const canalCache = new Map();

const baseHeaders = () => ({
  "Content-Type": "application/json",
  "X-Api-Key": SOCKET_CORE_API_KEY,
  Origin: SOCKET_CORE_ORIGIN,
});

async function postJson(path, body) {
  const res = await fetch(`${SOCKET_CORE_URL}${path}`, {
    method: "POST",
    headers: baseHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // cuerpo no-JSON: se trata como fallo abajo
  }
  return { status: res.status, data };
}

async function getJson(path) {
  const res = await fetch(`${SOCKET_CORE_URL}${path}`, {
    method: "GET",
    headers: baseHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    // cuerpo no-JSON: se trata como fallo abajo
  }
  return { status: res.status, data };
}

export const canalUsuario = (id) => `inmobitwo:user:${id}`;

// Crea el canal si no existe y devuelve su uuid.
// POST /channels no es idempotente (400 si ya existe): en ese caso se
// busca el id con GET /channels por nombre.
export const asegurarCanal = async (nombre) => {
  if (canalCache.has(nombre)) return canalCache.get(nombre);

  const creado = await postJson("/channels", { name: nombre });
  if (creado.status === 201 && creado.data?.data?.id) {
    canalCache.set(nombre, creado.data.data.id);
    return creado.data.data.id;
  }
  if (creado.status === 400) {
    const lista = await getJson("/channels");
    const canal = lista.data?.data?.find?.((c) => c.name === nombre);
    if (canal?.id) {
      canalCache.set(nombre, canal.id);
      return canal.id;
    }
  }
  console.warn("[socket-core] no se pudo asegurar el canal");
  return null;
};

export const invalidarCanal = (nombre) => {
  canalCache.delete(nombre);
};

// El canal DEBE existir antes de que el cliente conecte (si no, el WS
// cierra con "Channel not found"). El uuid cacheado puede morir si
// socket-core se reinicia (canales en memoria): se revalida siempre.
export const crearTokenUsuario = async (usuarioId) => {
  const nombre = canalUsuario(usuarioId);
  let uuid = canalCache.get(nombre);
  if (uuid) {
    const lista = await getJson("/channels").catch(() => null);
    const vigente = lista?.data?.data?.some?.(
      (c) => c.name === nombre && c.id === uuid,
    );
    if (!vigente) {
      invalidarCanal(nombre);
      uuid = null;
    }
  }
  if (!uuid) uuid = await asegurarCanal(nombre);
  if (!uuid) return null;

  const res = await postJson("/auth/token", {
    user_id: String(usuarioId),
    channel: nombre,
    role: "subscribe",
  });
  if (!res.data?.success || !res.data?.data?.token) {
    console.warn("[socket-core] no se pudo crear el token de chat");
    return null;
  }
  return {
    token: res.data.data.token,
    expiresIn: res.data.data.expires_in,
    channel: res.data.data.channel,
    wsUrl: SOCKET_CORE_WS_PUBLIC_URL,
  };
};

// Publica un evento al canal personal del usuario. Si el canal no existe,
// el usuario no está conectado: se sale en silencio (el mensaje ya está en BD).
// Nunca lanza: un fallo de publicación se registra y no rompe la petición.
export const publicarAUsuario = async (usuarioId, payload) => {
  try {
    const nombre = canalUsuario(usuarioId);
    let uuid = canalCache.get(nombre);
    if (!uuid) {
      const lista = await getJson("/channels");
      uuid = lista.data?.data?.find?.((c) => c.name === nombre)?.id;
      if (!uuid) return;
      canalCache.set(nombre, uuid);
    }
    const res = await postJson(`/channels/${uuid}/events`, {
      source: "inmobitwo-backend",
      targets: ["*"],
      payload,
    });
    if (res.status === 400) invalidarCanal(nombre);
  } catch (error) {
    console.warn("[socket-core] fallo publicando evento:", error?.message);
  }
};
