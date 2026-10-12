// scripts/verificar-crm-leads.mjs — verifica ownership de PATCH /leads/:id
// Uso (PowerShell):
//   $env:CRM_BASE_URL="http://localhost:3001"; $env:CRM_TOKEN_A="<jwt A>";
//   $env:CRM_TOKEN_B="<jwt B>"; $env:CRM_LEAD_ID="<id lead de A>"
//   node --env-file .env scripts/verificar-crm-leads.mjs
// No imprime tokens ni datos personales, solo IDs y estados.
const BASE = process.env.CRM_BASE_URL || "http://localhost:3001";
const { CRM_TOKEN_A, CRM_TOKEN_B, CRM_LEAD_ID } = process.env;

if (!CRM_TOKEN_A || !CRM_TOKEN_B || !CRM_LEAD_ID) {
  console.error("Faltan CRM_TOKEN_A, CRM_TOKEN_B o CRM_LEAD_ID.");
  process.exit(1);
}

const llamar = async (token, metodo, ruta, cuerpo) => {
  const res = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: cuerpo ? JSON.stringify(cuerpo) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let fallos = 0;
const afirmar = (cond, nombre) => {
  console.log(`${cond ? "OK  " : "FALLO"} ${nombre}`);
  if (!cond) fallos += 1;
};

// 1. Dueño puede cambiar estado (se deja en contactado y se devuelve a nuevo)
const r1 = await llamar(CRM_TOKEN_A, "PATCH", `/leads/${CRM_LEAD_ID}`, { estado: "contactado" });
afirmar(r1.status === 200 && r1.body?.success === true, "dueño cambia estado (200)");
await llamar(CRM_TOKEN_A, "PATCH", `/leads/${CRM_LEAD_ID}`, { estado: "nuevo" });

// 2. Otro usuario recibe 404 (no revela existencia)
const r2 = await llamar(CRM_TOKEN_B, "PATCH", `/leads/${CRM_LEAD_ID}`, { estado: "cerrado" });
afirmar(r2.status === 404, `ajeno recibe 404 (fue ${r2.status})`);

// 3. El lead ajeno no aparece en su GET /crm/leads
const r3 = await llamar(CRM_TOKEN_B, "GET", "/crm/leads?limite=100");
const ids = Array.isArray(r3.body?.data) ? r3.body.data.map((l) => l.id) : [];
afirmar(!ids.includes(Number(CRM_LEAD_ID)), "ajeno no lista el lead");

process.exit(fallos ? 1 : 0);
