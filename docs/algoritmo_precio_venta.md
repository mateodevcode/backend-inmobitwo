# Algoritmo de precio sugerido — venta de vivienda en Colombia

> ⚠️ Alcance actual: **solo venta**. No aplica a arriendo ni a otras operaciones.
> Fuente de verdad: `backend-inmobitwo/src/lib/precios_referencia_colombia.js` + endpoints en `backend-inmobitwo/src/controllers/propiedades.controllers.js:3748-3853` (rutas `propiedades.routes.js:115-119`).

## 1. Idea general

El precio sugerido NO usa IA: es un cálculo determinístico en 10 pasos:

```
precio m² base (ciudad × estrato) × área privada
  × factor estado × factor antigüedad × factor piso
  × factor amenities × factor zona
  + valor fijo de parqueadero
  → rango ±10 % redondeado a números "limpios"
```

## 2. Precio base por m² privado

Tabla `PRECIOS_M2_PRIVADO` (precio medio del rango por m² privado, en COP). 15 ciudades + fallback `nacional`:

| Ciudad | E1 | E2 | E3 | E4 | E5 | E6 |
|---|---|---|---|---|---|---|
| Bogotá | 1.300.000 | 1.900.000 | 2.800.000 | 4.200.000 | 6.500.000 | 13.500.000 |
| Medellín | 950.000 | 1.400.000 | 2.100.000 | 3.200.000 | 5.200.000 | 8.500.000 |
| Cali | 750.000 | 1.150.000 | 1.700.000 | 2.600.000 | 3.800.000 | 5.500.000 |
| Barranquilla | 700.000 | 1.000.000 | 1.500.000 | 2.200.000 | 3.200.000 | 4.800.000 |
| Cartagena | 850.000 | 1.300.000 | 1.900.000 | 2.800.000 | 4.000.000 | 6.000.000 |
| Bucaramanga | 680.000 | 980.000 | 1.450.000 | 2.100.000 | 3.000.000 | 4.500.000 |
| Pereira | 580.000 | 850.000 | 1.250.000 | 1.800.000 | 2.600.000 | 3.800.000 |
| Manizales | 550.000 | 800.000 | 1.180.000 | 1.700.000 | 2.400.000 | 3.500.000 |
| Cúcuta | 450.000 | 650.000 | 950.000 | 1.350.000 | 1.900.000 | 2.800.000 |
| Ibagué | 500.000 | 730.000 | 1.080.000 | 1.550.000 | 2.200.000 | 3.200.000 |
| Villavicencio | 560.000 | 820.000 | 1.200.000 | 1.750.000 | 2.500.000 | 3.600.000 |
| Neiva | 480.000 | 700.000 | 1.020.000 | 1.480.000 | 2.100.000 | 3.000.000 |
| Santa Marta | 650.000 | 950.000 | 1.380.000 | 2.000.000 | 2.900.000 | 4.200.000 |
| Montería | 530.000 | 780.000 | 1.150.000 | 1.650.000 | 2.350.000 | 3.400.000 |
| Pasto | 410.000 | 600.000 | 880.000 | 1.260.000 | 1.800.000 | 2.600.000 |
| Nacional (fallback) | 900.000 | 1.320.000 | 1.950.000 | 2.900.000 | 4.200.000 | 6.500.000 |

- Fuente declarada en el código: Banco de la República (IPVU/IPVNBR), MetroCuadrado, La Galería Inmobiliaria y oferta de portales. **Se actualiza manualmente cada trimestre** (o se reemplaza por API real).
- Si la ciudad no está en la tabla → `nacional`. Si el estrato no existe → estrato 4 de esa ciudad.
- Área usada: privada; si es 0, construida; si ambas son 0 → error `"Se requiere área privada o construida para calcular el precio"`.

## 3. Multiplicadores (objeto `MULTIPLICADORES`)

- **Estado** (`condition_type_code`): nuevo 1.15 · para_estrenar 1.12 · usado 1.00 · remodelado 1.08 · para_remodelar 0.85 · obra_negra 0.75 · obra_gris 0.80 · en_construccion 0.90. Desconocido → 1.00.
- **Antigüedad** (desde `construction_year`): 0-5 años 1.00 · 6-15 −1 %/año · 16-30 −1.5 %/año · >30 −2 %/año con piso −40 % (mínimo 0.60).
- **Piso** (`floor_type`, derivado de `floor` con `derivarFloorType`): ph 1.08 · alto_vista 1.05 · alto 1.02 · medio 1.00 · bajo 0.97 · bajo_sin_asc 0.93 · sótano 0.85.
- **Amenities** (acumulativo, tope 1.12): 4+ amenities +8 % · 2-3 +5 % · 1 +2 % · ascensor +2 % · sin ascensor −3 % · portería 24h/vigilancia +2 %. Amenities contados: piscina, gimnasio, salón social, BBQ, canchas, juegos infantiles, zonas verdes.
- **Zona** (`zona`): residencial 1.00 · comercial 1.05 · industrial 0.90 · mixta 1.02 · campestre 0.95 · rural 0.85.

## 4. Valores fijos (`VALORES_FIJOS`, en COP)

- **Parqueadero** (suma directa al precio): privado cubierto +50M · privado descubierto +30M · comunal cubierto +15M · comunal descubierto +5M · sin parqueadero +0.
- **Administración sugerida** (rango por estrato + 100k extra si hay piscina/gym): E6 600k · E5 450k · E4 350k · E3 250k · E2 150k · E1 80k (máx = base + extra + 50k).

## 5. Rango y redondeo

- Rango sugerido: promedio ±10 %, redondeado a números "limpios" (≥10M al millón, ≥1M a la centena de mil, etc.).
- Respuesta: `precio_sugerido_min/max/promedio`, `price_per_sqm_sugerido`, cada factor aplicado, `valor_parqueadero`, `administracion_sugerida {min,max}`, `nivel: 'calculado'`.

## 6. Validación del precio del usuario (`validarPrecioUsuario`)

Compara `precio_usuario` contra el promedio y devuelve `nivel`:

| Diferencia | Nivel | Mensaje |
|---|---|---|
| > +25 % | `sobrevalorado` | Ajustar para vender más rápido |
| +15 % a +25 % | `alto` | Aceptable con diferenciadores únicos |
| −15 % a +15 % | `optimo` | Dentro del rango de mercado |
| −25 % a −15 % | `bueno` | Competitivo |
| < −25 % | `oportunidad` | Muy atractivo para compradores |

## 7. Endpoints

- `POST /propiedades/calcular-precio-sugerido` — body con `city_id` (se resuelve a slug vía `cities.slug`), `estrato`, `private_area/constructed_area`, `condition_type_id` (→ `code`), `construction_year`, `floor`, `features[]`, `parqueadero_tipo/modo`, `zona`. Sin área → 400.
- `POST /propiedades/validar-precio` — body `{ precio_usuario, datos_propiedad }`. Responde `{ mensaje, nivel, diferencia_porcentaje, precio_sugerido_promedio }`.
- Ambos con `rateLimit`, públicos (sin `verificarToken`).

## 8. Ejemplo

Apartamento Bogotá, estrato 4, 78 m² privados, para estrenar (2024), piso 8 con vista, piscina+gym+ascensor+portería, parqueadero privado cubierto, residencial:

`calcularPrecioSugerido({ ciudad: 'bogota', estrato: 4, private_area: 78, condition_type_code: 'para_estrenar', construction_year: 2024, floor_type: 'alto_vista', features: ['piscina','gimnasio','ascensor','porteria_24h'], parqueadero_tipo: 'cubierto', parqueadero_modo: 'privado', zona: 'residencial' })` → rango esperado ≈ **$480M – $550M**.

## 9. Pendiente (fuera de alcance por ahora)

- Extender a **arriendo** (canon mensual, no precio total) y a otras operaciones.
- Automatizar la actualización trimestral de `PRECIOS_M2_PRIVADO` (hoy manual).
- Revisar `error.message` crudo en los 500 de ambos endpoints (ver N-09 de `AUDITORIA_TECNICA.md`).
