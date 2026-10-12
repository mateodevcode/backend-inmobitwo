// src/routes/crm.routes.js — CRM fase 1
import { Router } from "express";
import { verificarToken } from "../middleware/auth.middleware.js";
import { resolverEspacioCrm } from "../middleware/crmEspacio.middleware.js";
import {
  createRateLimitMiddleware,
  defaultLimiter,
} from "../lib/rateLimit.js";
import {
  getCrmLeads,
  getCrmPropiedades,
  getDashboard,
} from "../controllers/crm.controllers.js";

const router = Router();
const rateLimit = createRateLimitMiddleware(defaultLimiter);
const conEspacio = [verificarToken, resolverEspacioCrm, rateLimit];

router.get("/crm/dashboard", ...conEspacio, getDashboard);
router.get("/crm/propiedades", ...conEspacio, getCrmPropiedades);
router.get("/crm/leads", ...conEspacio, getCrmLeads);

export default router;
