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
import organizacionMiembrosRoutes from "./routes/organizacion_miembros.routes.js";
import favoritosRoutes from "./routes/favoritos.routes.js";
import geoRoutes from "./routes/geo.routes.js";
import geocodeRoutes from "./routes/geocode.routes.js";
import trackingRoutes from "./routes/tracking.routes.js";
import leadsRoutes from "./routes/leads.routes.js";
import { corsOptions } from "./cors.config.js";

const app = express();

app.set("trust proxy", true);

app.use(cors(corsOptions));
app.use(cookieParser()); // ← necesario para leer req.cookies
if (process.env.NODE_ENV !== "production") {
  app.use(morgan("dev"));
}
app.use(express.json());

// Rutas
app.use(authRoutes);
app.use(usuariosRoutes);
app.use(propiedadesRoutes);
app.use(organizacionesRoutes);
app.use(organizacionMiembrosRoutes);
app.use(favoritosRoutes); // ← agregar esto
app.use(trackingRoutes);
app.use(leadsRoutes);
app.use("/api", geoRoutes);
app.use("/api", geocodeRoutes);

app.listen(PORT);
console.log("Server running on port", PORT);
