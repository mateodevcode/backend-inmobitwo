// Funciones puras para interpretar filas importadas (CSV/Excel) del CRM.
// Sin BD: se prueban en test/importacion.test.js.

// "Bogotá, D.C." → "bogota dc"
export function claveTexto(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const vacio = (v) => v == null || String(v).trim() === "";

// Dinero en COP: "$ 350.000.000", "350000000", "350,000,000", 350000000.
// Los decimales no existen en COP: ",00" o ".00" finales se descartan.
export function parsearDinero(valor) {
  if (vacio(valor)) return null;
  if (typeof valor === "number") return Number.isFinite(valor) && valor >= 0 ? Math.round(valor) : NaN;
  let s = String(valor).replace(/\s|\$|cop/gi, "");
  s = s.replace(/[.,]00$/, "");
  if (!/^\d{1,3}([.,]\d{3})*$|^\d+$/.test(s)) return NaN;
  const n = Number(s.replace(/[.,]/g, ""));
  return Number.isSafeInteger(n) ? n : NaN;
}

// Entero pequeño (habitaciones, baños, estrato, área sin decimales).
export function parsearEntero(valor, { min = 0, max = 1_000_000 } = {}) {
  if (vacio(valor)) return null;
  const s = String(valor).trim().replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN;
  const r = Math.round(n);
  return r < min || r > max ? NaN : r;
}

const SI = new Set(["si", "s", "x", "true", "1", "yes"]);
const NO = new Set(["no", "n", "false", "0"]);
export function parsearBooleano(valor) {
  if (vacio(valor)) return null;
  if (typeof valor === "boolean") return valor;
  const k = claveTexto(valor);
  if (SI.has(k)) return true;
  if (NO.has(k)) return false;
  return undefined;
}

// Etiquetas: "vip, inversionista; referido" → ["vip", "inversionista", "referido"]
export function parsearEtiquetas(valor) {
  if (vacio(valor)) return [];
  return [
    ...new Set(
      String(valor)
        .split(/[,;|]/)
        .map((e) => e.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 20);
}

const TIPOS_CONTACTO = {
  comprador: "comprador",
  compradora: "comprador",
  vendedor: "vendedor",
  vendedora: "vendedor",
  propietario: "vendedor",
  propietaria: "vendedor",
  arrendatario: "arrendatario",
  arrendataria: "arrendatario",
  inquilino: "arrendatario",
  inquilina: "arrendatario",
  inversor: "inversor",
  inversora: "inversor",
  inversionista: "inversor",
  otro: "otro",
};
export function tipoContacto(valor) {
  if (vacio(valor)) return "otro";
  return TIPOS_CONTACTO[claveTexto(valor)] ?? null;
}

const OPERACIONES = {
  venta: "venta",
  vender: "venta",
  vendo: "venta",
  alquiler: "alquiler",
  arriendo: "alquiler",
  arrendamiento: "alquiler",
  renta: "alquiler",
};
export function operacionInmueble(valor) {
  return OPERACIONES[claveTexto(valor)] ?? null;
}

const SINONIMOS_TIPO = {
  apto: "apartamento",
  apartamentos: "apartamento",
  depto: "apartamento",
  local: "local",
  "local comercial": "local",
  lote: "lote",
  terreno: "lote",
  "lote terreno": "lote",
  estudio: "apartaestudio",
  "aparta estudio": "apartaestudio",
  "pent house": "penthouse",
  garaje: "parqueadero",
  deposito: "trastero",
  cuarto: "habitacion",
};
// tipos: [{ id, code, label_es }] del catálogo property_types.
export function resolverTipoInmueble(tipos, valor) {
  if (vacio(valor)) return null;
  const k = claveTexto(valor);
  const objetivo = SINONIMOS_TIPO[k] ?? k;
  const code = objetivo.replace(/ /g, "_");
  return tipos.find((t) => t.code === code) ?? tipos.find((t) => claveTexto(t.label_es) === objetivo) ?? null;
}

// Nombres que la gente escribe distinto al catálogo.
const ALIAS_CIUDAD = {
  bogota: "bogota d c",
  "bogota dc": "bogota d c",
  "santa fe de bogota": "bogota d c",
  cartagena: "cartagena de indias",
  "san andres": "san andres",
};
const ALIAS_DEPARTAMENTO = {
  bogota: "bogota d c",
  "bogota dc": "bogota d c",
  "san andres": "san andres providencia y santa catalina",
  "valle": "valle del cauca",
};

// ciudades: [{ id, name, state_id, state_name }] de Colombia.
// Devuelve { ciudad } o { error }.
export function resolverCiudad(ciudades, nombreCiudad, nombreDepartamento) {
  if (vacio(nombreCiudad)) return { error: "Falta la ciudad." };
  const k = claveTexto(nombreCiudad);
  const objetivo = ALIAS_CIUDAD[k] ?? k;
  let candidatas = ciudades.filter((c) => claveTexto(c.name) === objetivo);
  if (candidatas.length === 0) return { error: `No se encontró la ciudad "${String(nombreCiudad).trim()}".` };
  if (!vacio(nombreDepartamento)) {
    const kd = claveTexto(nombreDepartamento);
    const dep = ALIAS_DEPARTAMENTO[kd] ?? kd;
    const filtradas = candidatas.filter((c) => claveTexto(c.state_name) === dep);
    if (filtradas.length === 0) {
      return { error: `La ciudad "${String(nombreCiudad).trim()}" no está en "${String(nombreDepartamento).trim()}".` };
    }
    candidatas = filtradas;
  }
  if (candidatas.length > 1) {
    return {
      error: `Hay varias ciudades llamadas "${String(nombreCiudad).trim()}" (${candidatas
        .map((c) => c.state_name)
        .join(", ")}). Indica el departamento.`,
    };
  }
  return { ciudad: candidatas[0] };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
