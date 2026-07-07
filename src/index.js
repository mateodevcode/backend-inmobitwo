// src/index.js
process.env.TZ = "UTC";

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import morgan from "morgan";
import { FRONTEND_URL, PORT } from "./config.js";
import authRoutes from "./routes/auth.routes.js";
import usuariosRoutes from "./routes/usuarios.routes.js";
import propiedadesRoutes from "./routes/propiedades.routes.js";
import organizacionesRoutes from "./routes/organizaciones.routes.js";
import geoRoutes from "./routes/geo.routes.js"; // ← NUEVO
import geocodeRoutes from "./routes/geocode.routes.js"; // ← NUEVO
import trackingRoutes from "./routes/tracking.routes.js"; // ← NUEVO
import leadsRoutes from "./routes/leads.routes.js"; // ← NUEVO

const app = express();

// Agrega esto justo debajo de instanciar Express:
// app.set('trust proxy', true); des comentar cuando suba a pro

console.log(FRONTEND_URL);

app.use(
  cors({
    origin: FRONTEND_URL?.split(","),
    credentials: true, // ← necesario para que las cookies funcionen cross-origin
  }),
);

app.use(cookieParser()); // ← necesario para leer req.cookies
app.use(morgan("dev"));
app.use(express.json());

// Rutas
app.use(authRoutes);
app.use(usuariosRoutes);
app.use(propiedadesRoutes);
app.use(organizacionesRoutes);
app.use(trackingRoutes); // ← NUEVO
app.use(leadsRoutes); // ← NUEVO
app.use("/api", geoRoutes); // ← NUEVO — expone /api/countries, /api/states, /api/cities
app.use("/api", geocodeRoutes); // ← NUEVO — expone /api/geocode

app.listen(PORT);
console.log("Server running on port", PORT);
