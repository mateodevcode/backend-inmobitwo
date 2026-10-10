// src/index.js
process.env.TZ = "UTC";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { FRONTEND_URL, PORT } from "./config.js";
import authRoutes from "./routes/auth.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import roomSeekerRoutes from "./routes/room_seeker.routes.js";
import propiedadesRoutes from "./routes/propiedades.routes.js";
import organizacionesRoutes from "./routes/organizaciones.routes.js";
import organizacionMiembrosRoutes from "./routes/organizacion_miembros.routes.js";
import favoritosRoutes from "./routes/favoritos.routes.js";
import geoRoutes from "./routes/geo.routes.js";
import geocodeRoutes from "./routes/geocode.routes.js";
import trackingRoutes from "./routes/tracking.routes.js";
import leadsRoutes from "./routes/leads.routes.js";
import catalogosRoutes from "./routes/catalogos.routes.js";
import iaRoutes from "./routes/ia.routes.js";
import passwordRecoveryRoutes from "./routes/password.recovery.routes.js";
import busquedasGuardadasRoutes from "./routes/busquedas.guardadas.routes.js";
import { iniciarCronBusquedas } from "./jobs/busquedasGuardadas.job.js";
import { corsOptions } from "./cors.config.js";
import { errorHandler } from "./middleware/error.middleware.js";
import { validarSecretosArranque, vistasHabilitadas } from "./lib/validarSecretos.js";

// Secretos de vistas: si faltan, error MUY visible pero el resto arranca
// (punto 1). Solo las rutas de vistas responden 503 (ver requiereVistas).
try {
  validarSecretosArranque();
} catch (e) {
  console.error(`\n❌❌❌ ${e.message} — VISTAS DESHABILITADAS (view-token y /tracking/vista responden 503) ❌❌❌\n`);
}

// Depuración de IP (paso8 6d): advertencia explícita si está activa.
if (process.env.VISTA_DEBUG_IP === "1") {
  console.warn(
    "\n⚠️⚠️⚠️ VISTA_DEBUG_IP=1 ACTIVO: registrarVista imprime IPs en claro en el log. ¡Apágalo en producción! ⚠️⚠️⚠️\n",
  );
}

const app = express();

// Un solo salto (nginx). Con `true` se aceptaba X-Forwarded-For de cualquiera
// que llegara directo al puerto (lote 6 punto 6a + paso2).
app.set("trust proxy", 1);

// Salud: incluye si las vistas están habilitadas (punto 1).
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "backend-inmobitwo",
    vistas_habilitado: vistasHabilitadas(),
  });
});

app.use(cors(corsOptions));
app.use(cookieParser()); // ← necesario para leer req.cookies
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
app.use(express.json({ limit: "5mb" }));

// Rutas
app.use(authRoutes);
app.use(usuariosRoutes);
app.use(roomSeekerRoutes);
app.use(propiedadesRoutes);
app.use(organizacionesRoutes);
app.use(organizacionMiembrosRoutes);
app.use(favoritosRoutes); // ← agregar esto
app.use(trackingRoutes);
app.use(leadsRoutes);
app.use("/api", geoRoutes);
app.use("/api", geocodeRoutes);
app.use("/catalogos", catalogosRoutes);
app.use("/ia", iaRoutes);
app.use(passwordRecoveryRoutes);
app.use(busquedasGuardadasRoutes);

// Middleware de errores (debe ir después de todas las rutas)
app.use(errorHandler);

app.listen(PORT);
console.log("Server running on port", PORT);

// Cron de búsquedas guardadas (solo si CRON_BUSQUEDAS_ENABLED=true)
iniciarCronBusquedas();
