// scripts/mp-debug.mjs — Diagnóstico aislado de Mercado Pago (NO toca la BD, NO crea cobros).
// Uso: node scripts/mp-debug.mjs <sub> [args]
// Subs:
//   users-me                → GET /users/me (masked)
//   req GET <path>          → GET genérico (ej: req GET "v1/orders/ORD…")
//   req POST <path> <json>  → POST genérico
// Leer ~/.env del backend para MP_ACCESS_TOKEN / MP_PUBLIC_KEY.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
function loadEnv() {
  for (const line of readFileSync(join(HERE, "..", ".env"), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*'?([^'\n]+)'?$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
  }
}
loadEnv();
const TOKEN = process.env.MP_ACCESS_TOKEN || "";
const PUB = process.env.MP_PUBLIC_KEY || "";
// Enmascara secretos: deja solo los últimos 4 caracteres.
const mask = (s) =>
  String(s ?? "")
    .replace(/(APP_USR-[a-f0-9-]{10,}|TEST-[a-f0-9-]{10,})/gi, (m) => `***${m.slice(-6)}`)
    .replace(/("(?:token|public_key|access_token|card_token)"\s*:\s*")([^"]{8,})(")/gi, (_m, a, b, c) => `${a}***${b.slice(-4)}${c}`)
    .replace(/("authorization"\s*:\s*"Bearer\s*)([^"]{8,})(")/gi, (_m, a, b, c) => `${a}***${b.slice(-6)}${c}`);

const callMP = async (method, path, bodyObj) => {
  const url = path.startsWith("http") ? path : `https://api.mercadopago.com/${path.replace(/^\//, "")}`;
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` };
  if (bodyObj) headers["X-Idempotency-Key"] = `dbg-${Date.now()}-${Math.random().toFixed(8)}`;
  const res = await fetch(url, {
    method,
    headers,
    body: bodyObj ? JSON.stringify(bodyObj) : undefined,
  });
  const raw = await res.arrayBuffer();
  const text = new TextDecoder().decode(raw);
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  console.log(`→ ${method} ${url}`);
  console.log(`HTTP ${res.status}`);
  console.log(`x-request-id: ${res.headers.get("x-request-id") ?? "-"}`);
  console.log(`date: ${res.headers.get("date") ?? "-"}`);
  console.log(
    `content-type: ${res.headers.get("content-type") ?? "-"} | content-encoding: ${res.headers.get("content-encoding") ?? "-"} | content-length: ${res.headers.get("content-length") ?? "-"} | rawBytes: ${raw.byteLength}`,
  );
  console.log("body:");
  console.log(typeof body === "string" ? mask(body) : JSON.stringify(body, mask, 2));
};

const [sub, ...rest] = process.argv.slice(2);
if (sub === "users-me") {
  await callMP("GET", "users/me");
} else if (sub === "req") {
  const [, path, bodyJson] = rest;
  await callMP(rest[0] ?? "GET", path, bodyJson ? JSON.parse(bodyJson) : undefined);
} else {
  console.log("subs: users-me | req <METHOD> <path> [jsonBody]");
}
