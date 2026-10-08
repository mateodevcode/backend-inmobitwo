// src/lib/ipReal.js
// IP real del visitante para medición de vistas (paso2 punto 2).
// nginx (inmobitwo-api.conf) SOBRESCRIBE X-Real-IP con $remote_addr, así que
// no la puede falsificar el cliente. En cambio req.ip con `trust proxy true`
// toma el extremo izquierdo de X-Forwarded-For, que SÍ puede traer un valor
// falsificado si la petición llega directo al puerto. Por eso se prefiere
// X-Real-IP y req.ip queda solo como respaldo (SOLO DNS, sin CDN delante).
export function ipReal(req) {
  const xr = req?.headers?.["x-real-ip"];
  if (typeof xr === "string" && xr.trim()) return xr.trim();
  return req?.ip ?? null;
}
