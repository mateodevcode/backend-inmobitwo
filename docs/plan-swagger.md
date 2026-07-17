# Plan: Documentación Swagger/OpenAPI

## Objetivo

Agregar documentación interactiva tipo Swagger al backend usando `swagger-jsdoc` + `swagger-ui-express`.

---

## 1. Dependencias a instalar

```bash
npm install swagger-jsdoc swagger-ui-express
```

**¿Por qué estas dos?**

| Paquete | Rol |
|---|---|
| `swagger-jsdoc` | Escanea comentarios JSDoc en los archivos de rutas y genera el `swaggerSpec` (objeto OpenAPI 3.0) |
| `swagger-ui-express` | Sirve la UI de Swagger en un endpoint (ej. `/api-docs`) y consume el `swaggerSpec` |

---

## 2. Archivo de configuración Swagger

Crear: `src/swagger.config.js`

```js
import swaggerJsdoc from "swagger-jsdoc";

const options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "InmobiTwo API",
      version: "1.0.0",
      description: "API REST del backend de InmobiTwo - Plataforma inmobiliaria",
    },
    servers: [
      {
        url: "http://localhost:4000",
        description: "Desarrollo local",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      // Schemas reutilizables (se irán poblando por ruta)
      schemas: {},
    },
    security: [], // Por defecto sin auth; se habilita por endpoint
  },
  apis: ["./src/routes/*.routes.js"], // Escanea todos los archivos de rutas
};

export const swaggerSpec = swaggerJsdoc(options);
```

---

## 3. Integración en `src/index.js`

Agregar antes del `app.listen`:

```js
import swaggerUi from "swagger-ui-express";
import { swaggerSpec } from "./swagger.config.js";

app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
```

También se puede exponer el JSON raw:

```js
app.get("/api-docs.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.send(swaggerSpec);
});
```

---

## 4. Cómo anotar cada ruta

### Ejemplo real: `src/routes/favoritos.routes.js`

```js
import { Router } from "express";
import {
  toggleFavorito,
  getMisFavoritos,
} from "../controllers/favoritos.controllers.js";
import { verificarToken } from "../middleware/auth.middleware.js";
import { createRateLimitMiddleware, defaultLimiter } from "../lib/rateLimit.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const ruta = "/favoritos";

// ────────────────────────────────────────────────────────────────
// DOCUMENTACIÓN SWAGGER
// ────────────────────────────────────────────────────────────────

/**
 * @swagger
 * tags:
 *   name: Favoritos
 *   description: Gestión de propiedades favoritas del usuario
 */

/**
 * @swagger
 * /favoritos/toggle:
 *   post:
 *     summary: Agregar o quitar propiedad de favoritos (toggle)
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - propiedadId
 *             properties:
 *               propiedadId:
 *                 type: integer
 *                 description: ID de la propiedad
 *                 example: 42
 *     responses:
 *       200:
 *         description: Toggle exitoso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: Propiedad agregado de favoritos correctamente.
 *                 data:
 *                   type: object
 *                   properties:
 *                     propiedadId:
 *                       type: integer
 *                     action:
 *                       type: string
 *                       enum: [agregado, eliminado]
 *       400:
 *         description: Faltan campos requeridos
 *       401:
 *         description: No autenticado (token requerido)
 *       404:
 *         description: Propiedad no encontrada
 *       429:
 *         description: Demasiadas peticiones (rate limit)
 *       500:
 *         description: Error del servidor
 */
router.post(`${ruta}/toggle`, verificarToken, rateLimit, toggleFavorito);

/**
 * @swagger
 * /favoritos/mis-favoritos:
 *   get:
 *     summary: Obtener propiedades favoritas del usuario autenticado
 *     tags: [Favoritos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de favoritos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Propiedad'
 *                 total:
 *                   type: integer
 *       401:
 *         description: No autenticado
 *       429:
 *         description: Demasiadas peticiones
 *       500:
 *         description: Error del servidor
 */
router.get(`${ruta}/mis-favoritos`, verificarToken, rateLimit, getMisFavoritos);

export default router;
```

---

## 5. Template base para copiar/pegar en cada ruta

```js
/**
 * @swagger
 * /ruta/endpoint:
 *   metodo:
 *     summary: Descripción corta
 *     tags: [NombreDelTag]
 *     security:              // Solo si requiere token
 *       - bearerAuth: []
 *     parameters:            // Solo si hay query params o path params
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Número de página
 *     requestBody:           // Solo para POST/PUT/PATCH
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - campo1
 *             properties:
 *               campo1:
 *                 type: string
 *     responses:
 *       200:
 *         description: Éxito
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RespuestaExitosa'
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: No autenticado
 *       500:
 *         description: Error del servidor
 */
```

---

## 6. Orden de trabajo por archivo (prioridad)

| # | Archivo de rutas | Dificultad | Endpoints estimados |
|---|---|---|---|
| 1 | `auth.routes.js` | Media | ~5 (login, register, refresh, logout, forgot/reset password) |
| 2 | `usuarios.routes.js` | Media | ~5 (CRUD perfil, cambiar contraseña) |
| 3 | `propiedades.routes.js` | Alta | ~10+ (CRUD propiedades, búsqueda, filtros, publicación) |
| 4 | `organizaciones.routes.js` | Media | ~4 (CRUD organizaciones) |
| 5 | `organizacion_miembros.routes.js` | Media | ~4 (invitar, aceptar, rechazar, listar miembros) |
| 6 | `favoritos.routes.js` | Baja | 2 (toggle, listar) ✓ (ya documentado arriba) |
| 7 | `geo.routes.js` | Baja | ~3 (países, estados, ciudades) |
| 8 | `geocode.routes.js` | Baja | ~1 (geocodificación) |
| 9 | `tracking.routes.js` | Baja-Media | ~3 (registrar eventos, analytics) |
| 10 | `leads.routes.js` | Baja-Media | ~3 (crear lead, listar, asignar) |

---

## 7. Schemas reutilizables (`components.schemas`)

Conviene definir schemas en `swagger.config.js` para no repetir las mismas estructuras en cada endpoint. Ejemplos:

```js
components: {
  securitySchemes: { /* ... */ },
  schemas: {
    Error: {
      type: "object",
      properties: {
        success: { type: "boolean", example: false },
        error: { type: "string", example: "Mensaje de error" },
      },
    },
    Propiedad: {
      type: "object",
      properties: {
        id: { type: "integer" },
        titulo: { type: "string" },
        tipo: { type: "string" },
        operacion: { type: "string" },
        precio: { type: "number" },
        direccion: { type: "string" },
        estado: { type: "string", enum: ["publicado", "no_publicado"] },
        // ... resto de campos
      },
    },
  },
}
```

Luego en las rutas se referencia con `$ref: '#/components/schemas/Propiedad'`.

---

## 8. Notas importantes

- **Coexistencia**: Swagger se agrega sin modificar la lógica de rutas existente. Solo se añaden comentarios JSDoc encima de cada `router.VERB(...)`.
- **Rutas con prefijo `/api`**: En `index.js`, geo y geocode se montan con `app.use("/api", geoRoutes)`. En los comentarios JSDoc, la URL completa debe ser `/api/geo/...` (incluir el prefijo).
- **Middleware en cadena**: Las anotaciones JSDoc van justo antes de la línea `router.xxx(...)`, no antes de los middlewares sueltos.
- **Entorno**: Swagger UI solo debe exponerse en desarrollo. Se puede condicionar:
  ```js
  if (process.env.NODE_ENV !== "production") {
    app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  }
  ```
- **Rate limit**: Si la UI de Swagger hace muchas requests desde el navegador, podría disparar el rate limiter. Considerar excluir `/api-docs` del rate limit o configurar CORS para la UI.

---

## 9. Resultado final esperado

- `GET /api-docs` → UI interactiva de Swagger con todos los endpoints documentados
- `GET /api-docs.json` → Especificación OpenAPI 3.0 en JSON (para importar en Postman, generar clientes, etc.)

---

## 10. Comandos útiles post-implementación

```bash
# Validar que el spec se genera correctamente (sin necesidad de levantar el server)
node -e "import('./src/swagger.config.js').then(m => console.log(JSON.stringify(m.swaggerSpec, null, 2)))"

# Levantar el server y probar
npm run dev
# Abrir http://localhost:4000/api-docs
```
