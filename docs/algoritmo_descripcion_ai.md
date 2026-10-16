# MICRO-SERVICIO: Generador de Descripciones con IA (DeepSeek)
## Para el Wizard de Publicación — Bloque 8 (Título y Descripción)

---

## ARQUITECTURA

```
┌─────────────────────────────────────────────────────────────┐
│  FRONTEND (React)                                           │
│  • Boton "Generar con IA" en Bloque 8                       │
│  • Envia JSON estructurado con datos del anuncio          │
│  • NO tiene acceso a la API key                           │
│  • Recibe 3 descripciones + titulo sugerido               │
│  • Usuario elige 1 de las 3 y puede editar               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼ POST /api/ia/generar-descripcion
┌─────────────────────────────────────────────────────────────┐
│  BACKEND (Node.js/Express)                                  │
│  • Recibe JSON con datos del anuncio                      │
│  • Inyecta datos en PROMPT PREDEFINIDO (hardcodeado)      │
│  • Llama a API de DeepSeek via SDK de OpenAI             │
│  • Procesa respuesta: extrae titulo + 3 formatos          │
│  • Devuelve JSON limpio al frontend                       │
│  • API KEY nunca sale del servidor                        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PROVEEDOR DE IA: DeepSeek                                  │
│  • Modelo: deepseek-chat (v3) o deepseek-reasoner (r1)   │
│  • Endpoint compatible OpenAI: https://api.deepseek.com    │
│  • Genera texto en espanol colombiano profesional         │
│  • Sin emojis, sin cliches, tono ejecutivo                │
└─────────────────────────────────────────────────────────────┘
```

**Regla de oro:** La API key NUNCA toca el frontend. El prompt NUNCA lo escribe el usuario. Todo es controlado por el backend.

---

## ENDPOINT DEL BACKEND

```
POST /api/ia/generar-descripcion
```

**Headers:**
```
Authorization: Bearer <token_jwt_del_usuario>
Content-Type: application/json
```

**Body de entrada (JSON estructurado):**
```json
{
  "tipo_inmueble": "Apartamento",
  "operacion": "Venta",
  "ciudad": "Bogota",
  "barrio": "Chapinero",
  "estrato": 4,
  "private_area": 78,
  "constructed_area": 85,
  "bedroom_count": 3,
  "bathroom_count": 2,
  "social_bathroom_count": 1,
  "condition": "Para estrenar",
  "floor": "8",
  "interior": "801",
  "parqueadero": "Privado cubierto",
  "administracion": 420000,
  "features": [
    "Porteria 24h",
    "Piscina",
    "Gimnasio",
    "Salon social",
    "Zona BBQ",
    "Ascensor",
    "Vista panoramica",
    "Cocina integral",
    "Closets empotrados"
  ],
  "servicios": {
    "agua": true,
    "luz": true,
    "gas": true,
    "alcantarillado": true
  },
  "precio": 520000000,
  "price_per_sqm": 6666667,
  "zona": "Residencial"
}
```

**Response de salida:**
```json
{
  "success": true,
  "data": {
    "titulo_sugerido": "Apartamento para estrenar de 78m2, 3 alcobas en Chapinero - Estrato 4 con piscina y vista panoramica",
    "formatos": [
      {
        "id": "moderno",
        "nombre": "Moderno y Directo",
        "descripcion": "Apartamento para estrenar en el corazon de Chapinero. 78m2 privados distribuidos en 3 alcobas, 2 banos mas bano social. Estrato 4.\n\nEdificio con porteria 24h, piscina, gimnasio, salon social y zona BBQ. Parqueadero privado cubierto incluido.\n\nPiso 8 con vista panoramica. Cocina integral y closets empotrados. Todos los servicios publicos.\n\nPrecio: $520.000.000 | Administracion: $420.000\nUbicacion: Chapinero, Bogota",
        "caracteristicas": "Corto, escaneable, bullets limpios, ideal para profesionales y busquedas rapidas"
      },
      {
        "id": "narrativo",
        "nombre": "Narrativo y Emocional",
        "descripcion": "Imagina despertar cada manana con una vista panoramica de Bogota desde tu apartamento en el piso 8 de Chapinero. Este espacio de 78 metros cuadrados de area privada fue pensado para quienes buscan comenzar una nueva historia.\n\nTres alcobas acogedoras, dos banos completos y un bano social para recibir a quienes mas quieres. La cocina integral te invita a crear momentos inolvidables, mientras los closets empotrados mantienen todo en su lugar.\n\nEl conjunto cerrado te regala tranquilidad con porteria las 24 horas, piscina para los domingos en familia, gimnasio para tu rutina diaria y una zona BBQ para celebrar la vida. El parqueadero privado cubierto te espera cada vez que llegues a casa.\n\nUbicado en estrato 4, con todos los servicios publicos conectados y una administracion de $420.000 que vale cada peso por la calidad de vida que ofrece.\n\nPrecio: $520.000.000 COP.\nTu nuevo comienzo esta en Chapinero.",
        "caracteristicas": "Historia, sensaciones, emocional, ideal para familias o primer comprador"
      },
      {
        "id": "tecnico",
        "nombre": "Tecnico y Detallado",
        "descripcion": "APARTAMENTO EN VENTA - CHAPINERO, BOGOTA\n\nESPECIFICACIONES TECNICAS:\n- Area privada: 78m2 | Area construida: 85m2\n- Distribucion: 3 alcobas, 2 banos completos, 1 bano social, sala-comedor\n- Estado: Para estrenar (obra gris terminada, listo para estrenar)\n- Ubicacion: Piso 8, interior 801. Vista panoramica oriente.\n- Estrato: 4 | Zona: Residencial\n\nACABADOS Y TERMINACIONES:\n- Cocina integral con meson en granito\n- Closets empotrados en alcobas principales\n- Banos con divisiones en vidrio templado\n- Pisos en porcelanato importado\n\nAMENITIES DEL CONJUNTO:\n- Porteria 24 horas con control de acceso\n- Piscina semiolimpica climatizada\n- Gimnasio equipado con maquinas cardiovasculares y pesas\n- Salon social para 40 personas con cocina auxiliar\n- Zona BBQ con 4 puestos\n- 2 ascensores de ultima generacion\n- Parqueadero privado cubierto incluido en el precio\n\nSERVICIOS PUBLICOS:\n- Agua potable | Energia electrica | Gas natural domiciliario | Alcantarillado\n\nASPECTOS FINANCIEROS:\n- Precio de venta: $520.000.000 COP\n- Precio por m2: $6.666.667 COP/m2\n- Cuota de administracion: $420.000 COP/mes\n- Forma de pago: Negociable (credito hipotecario, leasing habitacional o contado)\n\nDOCUMENTACION:\n- Cedula catastral disponible\n- Matricula inmobiliaria al dia\n- Impuesto predial 2026 cancelado",
        "caracteristicas": "Especificaciones, medidas, financiero, ideal para inversionistas o compradores tecnicos"
      }
    ]
  }
}
```

---

## PROMPT PREDEFINIDO (BACKEND - NUNCA EXPUESTO AL FRONTEND)

Este es el prompt que el backend envia a la API de DeepSeek. Las `{{variables}}` se reemplazan con los datos del JSON recibido.

```
Eres un redactor profesional de bienes raices en Colombia con 15 anos de experiencia.
Especialista en crear descripciones de anuncios inmobiliarios que venden rapidamente.
Tu estilo es ejecutivo, sobrio y premium. NUNCA usas emojis. NUNCA usas frases genericas de marketing.

Tu tarea: Generar UN titulo y TRES descripciones diferentes para un inmueble en Colombia.

---
DATOS DEL INMUEBLE ---
Tipo: {{tipo_inmueble}}
Operacion: {{operacion}}
Ciudad: {{ciudad}}
Barrio: {{barrio}}
Estrato: {{estrato}}
Area privada: {{private_area}} m2
Area construida: {{constructed_area}} m2
Alcobas: {{bedroom_count}}
Banos completos: {{bathroom_count}}
Bano social: {{social_bathroom_count}}
Estado: {{condition}}
Piso: {{floor}}
Interior/Apto: {{interior}}
Parqueadero: {{parqueadero}}
Administracion: ${{administracion}} COP
Caracteristicas adicionales: {{features}}
Servicios publicos: {{servicios}}
Precio: ${{precio}} COP
Precio por m2: ${{price_per_sqm}} COP/m2
Zona: {{zona}}

---
INSTRUCCIONES ---

1. TITULO (maximo 120 caracteres):
   - Debe incluir: tipo de inmueble, area, alcobas, barrio, estrato y 1-2 amenities clave.
   - Ejemplo: "Apartamento para estrenar de 78m2, 3 alcobas en Chapinero - Estrato 4 con piscina"
   - NO uses mayusculas en todo el titulo. Solo la primera letra de cada palabra clave.
   - NO uses signos de exclamacion.
   - NO uses emojis.
   - Usa guiones (-) o barras (|) como separadores, nunca pipes excesivos.

2. FORMATO 1 - "Moderno y Directo":
   - Estilo: Corto, escaneable, bullets con guiones (-).
   - Longitud: 150-200 palabras.
   - Publico objetivo: Profesionales, jovenes ejecutivos, busquedas rapidas en celular.
   - Estructura: Hook inicial -> bullets de specs -> bullets de amenities -> precio + ubicacion.
   - NO uses emojis. Usa solo texto, guiones y numeros.
   - Incluye el precio y la administracion al final.
   - Tono: Directo, informativo, sin adornos.

3. FORMATO 2 - "Narrativo y Emocional":
   - Estilo: Historia, segunda persona ("Imagina...", "Tu nuevo hogar..."), sensaciones.
   - Longitud: 200-250 palabras.
   - Publico objetivo: Familias, primer comprador, personas que compran con emocion.
   - Estructura: Escena de vida -> descripcion emotiva del espacio -> amenities como experiencias -> cierre inspirador con precio.
   - NO uses bullets. Parrafos fluidos.
   - NO uses emojis.
   - Menciona el barrio y la ciudad como parte de la experiencia de vida.
   - Tono: Calido pero sofisticado, nino cursi.

4. FORMATO 3 - "Tecnico y Detallado":
   - Estilo: Especificaciones, medidas, lista tecnica, datos financieros.
   - Longitud: 250-300 palabras.
   - Publico objetivo: Inversionistas, compradores tecnicos, personas que comparan especificaciones.
   - Estructura: Header tecnico -> specs con bullets -> amenities con bullets -> servicios -> aspectos financieros -> documentacion.
   - Incluye precio por m2 explicitamente.
   - Menciona formas de pago (credito hipotecario, leasing, contado).
   - Se preciso con numeros y medidas.
   - NO uses emojis.
   - Tono: Formal, preciso, de informe ejecutivo.

---
REGLAS ABSOLUTAS ---
- Idioma: Espanol de Colombia (usa "alcobas", "parqueadero", "administracion", "estrato", "m2").
- NO inventes datos que no esten en los datos del inmueble.
- NO uses frases genericas como "excelente oportunidad", "no deje pasar", "precio negociable", "unico en su clase", "imperdible".
- NO uses MAYUSCULAS en todo el texto. Solo para headers tecnicos cuando sea necesario.
- NO menciones otras ciudades o barrios que no sean los indicados.
- El precio debe aparecer en formato COP con puntos: $520.000.000
- NO uses emojis bajo ninguna circunstancia.
- NO uses asteriscos (*) para negritas ni markdown de formato.
- Si el inmueble es "Para estrenar", enfatiza eso como ventaja clave.
- Si tiene vista panoramica, terraza o balcon, describelo como experiencia sensorial.
- Tono general: Profesional, ejecutivo, inmobiliaria premium. Nada de marketplace barato.

---
FORMATO DE RESPUESTA (JSON estricto) ---
Devuelve SOLO un objeto JSON valido, sin markdown, sin explicaciones, sin texto adicional:

{
  "titulo": "...",
  "formato_moderno": "...",
  "formato_narrativo": "...",
  "formato_tecnico": "..."
}
```

---

## IMPLEMENTACION CON DEEPSEEK (SDK DE OPENAI)

### En el backend (`.env`):
```bash
# .env (NUNCA subir a git)
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

### Instalacion:
```bash
npm install openai
```

### En el codigo del endpoint:
```js
// controllers/ia.controllers.js
import OpenAI from 'openai';

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL, // https://api.deepseek.com
});

export const generarDescripcion = async (req, res) => {
  try {
    const datos = req.body; // JSON estructurado del frontend

    // 1. Validar datos minimos
    if (!datos.tipo_inmueble || !datos.ciudad || !datos.precio) {
      return res.status(400).json({ success: false, error: 'Datos incompletos' });
    }

    // 2. Construir el prompt inyectando datos (NUNCA dejamos que el usuario inyecte el prompt)
    const prompt = construirPrompt(datos); // Funcion que reemplaza {{variables}}

    // 3. Llamar a DeepSeek via SDK de OpenAI
    const response = await deepseek.chat.completions.create({
      model: 'deepseek-chat',        // Modelo V3 (chat general)
      // model: 'deepseek-reasoner', // Modelo R1 (razonamiento avanzado, mas lento)
      messages: [
        { role: 'system', content: 'Eres un redactor inmobiliario experto en Colombia. Espanol colombiano, tono profesional y ejecutivo. Nunca uses emojis.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.7,
      max_tokens: 2000,
      response_format: { type: 'json_object' }, // Forzar JSON si el modelo lo soporta
    });

    // 4. Parsear respuesta (la IA devuelve JSON)
    const contenido = response.choices[0].message.content;

    // DeepSeek a veces envuelve el JSON en markdown (```json), limpiamos:
    const jsonLimpio = contenido.replace(/```json\n?|```\n?/g, '').trim();
    const generado = JSON.parse(jsonLimpio);

    // 5. Responder al frontend
    res.json({
      success: true,
      data: {
        titulo_sugerido: generado.titulo,
        formatos: [
          { 
            id: 'moderno', 
            nombre: 'Moderno y Directo', 
            descripcion: generado.formato_moderno,
            caracteristicas: 'Corto, escaneable, bullets limpios, ideal para profesionales y busquedas rapidas'
          },
          { 
            id: 'narrativo', 
            nombre: 'Narrativo y Emocional', 
            descripcion: generado.formato_narrativo,
            caracteristicas: 'Historia, sensaciones, emocional, ideal para familias o primer comprador'
          },
          { 
            id: 'tecnico', 
            nombre: 'Tecnico y Detallado', 
            descripcion: generado.formato_tecnico,
            caracteristicas: 'Especificaciones, medidas, financiero, ideal para inversionistas o compradores tecnicos'
          }
        ]
      }
    });

  } catch (error) {
    console.error('Error generando descripcion:', error);
    res.status(500).json({ success: false, error: 'Error generando descripcion con IA' });
  }
};
```

### Funcion auxiliar para construir el prompt:
```js
// utils/promptBuilder.js

export const construirPrompt = (datos) => {
  const serviciosList = Object.entries(datos.servicios || {})
    .filter(([_, val]) => val)
    .map(([key, _]) => key)
    .join(', ');

  const featuresList = (datos.features || []).join(', ');

  let prompt = `Eres un redactor profesional de bienes raices en Colombia con 15 anos de experiencia...

---
DATOS DEL INMUEBLE ---
Tipo: ${datos.tipo_inmueble}
Operacion: ${datos.operacion}
Ciudad: ${datos.ciudad}
Barrio: ${datos.barrio}
Estrato: ${datos.estrato}
Area privada: ${datos.private_area} m2
Area construida: ${datos.constructed_area} m2
Alcobas: ${datos.bedroom_count}
Banos completos: ${datos.bathroom_count}
Bano social: ${datos.social_bathroom_count || 0}
Estado: ${datos.condition}
Piso: ${datos.floor}
Interior/Apto: ${datos.interior}
Parqueadero: ${datos.parqueadero}
Administracion: $${datos.administracion?.toLocaleString('es-CO')} COP
Caracteristicas adicionales: ${featuresList}
Servicios publicos: ${serviciosList}
Precio: $${datos.precio?.toLocaleString('es-CO')} COP
Precio por m2: $${datos.price_per_sqm?.toLocaleString('es-CO')} COP/m2
Zona: ${datos.zona}

---
INSTRUCCIONES ---

1. TITULO (maximo 120 caracteres):
   - Debe incluir: tipo de inmueble, area, alcobas, barrio, estrato y 1-2 amenities clave.
   - NO uses mayusculas en todo el titulo. Solo la primera letra de cada palabra clave.
   - NO uses signos de exclamacion.
   - NO uses emojis.

2. FORMATO 1 - "Moderno y Directo":
   - Estilo: Corto, escaneable, bullets con guiones (-).
   - Longitud: 150-200 palabras.
   - NO uses emojis. Tono directo y profesional.
   - Incluye precio y administracion al final.

3. FORMATO 2 - "Narrativo y Emocional":
   - Estilo: Historia, segunda persona, sensaciones.
   - Longitud: 200-250 palabras.
   - NO uses bullets. Parrafos fluidos.
   - NO uses emojis.

4. FORMATO 3 - "Tecnico y Detallado":
   - Estilo: Especificaciones, medidas, lista tecnica, datos financieros.
   - Longitud: 250-300 palabras.
   - NO uses emojis.
   - Incluye precio por m2 y formas de pago.

---
REGLAS ABSOLUTAS ---
- Idioma: Espanol de Colombia.
- NO inventes datos.
- NO uses frases genericas de marketing.
- NO uses MAYUSCULAS en todo el texto.
- NO uses emojis bajo ninguna circunstancia.
- NO uses asteriscos (*) para negritas.
- El precio en formato: $520.000.000
- Tono: Profesional, ejecutivo, premium.

---
FORMATO DE RESPUESTA (JSON estricto) ---
Devuelve SOLO un objeto JSON valido:

{
  "titulo": "...",
  "formato_moderno": "...",
  "formato_narrativo": "...",
  "formato_tecnico": "..."
}`;

  return prompt;
};
```

### Rate limiting:
```js
// routes/ia.routes.js
import { createRateLimitMiddleware } from '../lib/rateLimit.js';

const iaLimiter = createRateLimitMiddleware({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // Maximo 5 generaciones por minuto por usuario
  message: 'Has generado muchas descripciones. Espera un momento.'
});

router.post('/generar-descripcion', verificarToken, iaLimiter, generarDescripcion);
```

---

## FLUJO UX EN EL FRONTEND

### Estado inicial (Bloque 8):
```
┌─────────────────────────────────────────────────────────────┐
│  8. Titulo y descripcion                                    │
│                                                             │
│  Titulo del anuncio                                         │
│  [________________________________________]                 │
│                                                             │
│  Descripcion                                                │
│  [                                                        ] │
│  [                                                        ] │
│  [                                                        ] │
│                                                             │
│  [Generar con IA]  <- Boton principal                      │
└─────────────────────────────────────────────────────────────┘
```

### Despues de hacer clic en "Generar con IA":
```
┌─────────────────────────────────────────────────────────────┐
│  Descripciones generadas por IA                             │
│                                                             │
│  Titulo sugerido:                                           │
│  "Apartamento para estrenar de 78m2, 3 alcobas en          │
│   Chapinero - Estrato 4 con piscina y vista panoramica"   │
│  [Usar este titulo] [Editar]                              │
│                                                             │
│  ---------------------------------------------------------  │
│                                                             │
│  Formato 1: Moderno y Directo                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Apartamento para estrenar en el corazon de...      │   │
│  │ ... (texto completo) ...                            │   │
│  └─────────────────────────────────────────────────────┘   │
│  [Usar este formato]  [Vista previa]                       │
│                                                             │
│  ---------------------------------------------------------  │
│                                                             │
│  Formato 2: Narrativo y Emocional                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Imagina despertar cada manana con una vista...     │   │
│  │ ... (texto completo) ...                            │   │
│  └─────────────────────────────────────────────────────┘   │
│  [Usar este formato]  [Vista previa]                       │
│                                                             │
│  ---------------------------------------------------------  │
│                                                             │
│  Formato 3: Tecnico y Detallado                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ APARTAMENTO EN VENTA - CHAPINERO, BOGOTA           │   │
│  │ ... (texto completo) ...                            │   │
│  └─────────────────────────────────────────────────────┘   │
│  [Usar este formato]  [Vista previa]                       │
│                                                             │
│  [Regenerar]  <- Llama de nuevo con los mismos datos      │
└─────────────────────────────────────────────────────────────┘
```

### Despues de elegir un formato:
```
┌─────────────────────────────────────────────────────────────┐
│  Formato seleccionado: Moderno y Directo                    │
│                                                             │
│  [Editar descripcion]  [Cambiar formato]  [Guardar]        │
│                                                             │
│  El texto seleccionado se carga en el textarea editable.   │
│  El usuario puede editarlo libremente antes de guardar.    │
└─────────────────────────────────────────────────────────────┘
```

---

## COSTO ESTIMADO POR GENERACION (DeepSeek)

| Modelo | Tokens entrada | Tokens salida | Costo aprox. (USD) | Costo aprox. (COP) |
|--------|---------------|--------------|-------------------|-------------------|
| **deepseek-chat** (V3) | ~800 | ~1200 | ~$0.0005 | ~$2 COP |
| **deepseek-reasoner** (R1) | ~800 | ~1200 | ~$0.003 | ~$12 COP |

**Comparacion con otros proveedores:**
- DeepSeek V3: ~10x mas barato que GPT-4o-mini
- DeepSeek R1: ~3x mas barato que Claude 3.5 Sonnet

**Recomendacion:** Usar **deepseek-chat** (V3) para este caso. Es suficientemente bueno para redaccion inmobiliaria, rapido y extremadamente barato. El modelo R1 solo si necesitas razonamiento complejo (no aplica aqui).

**Con 1000 generaciones al mes:** ~$0.50 USD con deepseek-chat. ~$3 USD con deepseek-reasoner.

---

## CHECKLIST DE IMPLEMENTACION

### Backend
- [ ] Variable de entorno `DEEPSEEK_API_KEY` configurada.
- [ ] Variable de entorno `DEEPSEEK_BASE_URL=https://api.deepseek.com` configurada.
- [ ] Endpoint `POST /api/ia/generar-descripcion` creado.
- [ ] SDK de OpenAI instalado (`npm install openai`).
- [ ] Instancia de OpenAI configurada con `baseURL` apuntando a DeepSeek.
- [ ] Funcion `construirPrompt(datos)` que inyecta variables en el prompt predefinido.
- [ ] Validacion de datos de entrada (campos minimos obligatorios).
- [ ] Rate limiting: maximo 5 generaciones/minuto por usuario.
- [ ] Manejo de errores: si la IA devuelve JSON malformado, reintentar 1 vez o devolver error controlado.
- [ ] Limpieza de markdown (```json) antes de parsear la respuesta.
- [ ] La API key NUNCA se expone en logs ni en respuestas.

### Frontend
- [ ] Boton "Generar con IA" en el Bloque 8 del wizard.
- [ ] Loading state mientras se genera (spinner + "Creando descripciones con IA...").
- [ ] Vista de 3 tarjetas con los formatos generados.
- [ ] Boton "Usar este formato" que carga el texto en el textarea editable.
- [ ] Boton "Vista previa" que abre un modal con el texto formateado.
- [ ] Boton "Regenerar" que vuelve a llamar al endpoint.
- [ ] El titulo sugerido aparece arriba con opcion de "Usar este titulo" o "Editar".
- [ ] El usuario puede editar el texto seleccionado antes de guardar.

---

> **Nota para la IA implementadora:**
> Este es un micro-servicio aislado. No depende de que el wizard este 100% terminado. Puedes implementarlo en paralelo con las otras fases. Solo necesita que el frontend le envie un JSON estructurado con los datos del anuncio (puedes hardcodear un JSON de prueba mientras el formulario no este listo).
> 
> **Cambios clave respecto a la version anterior:**
> 1. Proveedor cambiado a DeepSeek usando SDK de OpenAI con baseURL.
> 2. Eliminados todos los emojis del prompt y respuestas.
> 3. Tono cambiado a profesional/executivo/premium.
> 4. Agregada limpieza de markdown (```json) en la respuesta.
> 5. Costos actualizados a tarifas reales de DeepSeek (mucho mas barato).
