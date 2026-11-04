import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import { authenticate, requireRole } from "./auth/middleware.js";
import authRouter from "./routes/auth.js";
import insumosRouter from "./routes/insumos.js";
import recetasRouter from "./routes/recetas.js";
import recetarioInteligenteRouter from "./routes/recetario-inteligente.js";
import jornadasRouter from "./routes/jornadas.js";
import donacionesRouter from "./routes/donaciones.js";
import tareasRouter from "./routes/tareas.js";
import voluntariosRouter from "./routes/voluntarios.js";
import reportesRouter from "./routes/reportes.js";

const app = express();
const PORT = process.env.PORT || 3000;
const origenesPermitidos = (process.env.FRONTEND_ORIGIN || "http://localhost:5173").split(",").map((item) => item.trim());

app.use(cors({ origin: origenesPermitidos }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => res.json({ proyecto: "Vivir para Servir", mensaje: "API activa correctamente." }));
app.get("/api/salud", (_req, res) => res.status(200).json({ estado: "ok", mensaje: "El backend funciona correctamente." }));

// Diagnóstico de desarrollo; es de solo lectura. No expone credenciales.
app.get("/api/db/prueba", async (_req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT current_database() AS base_datos,
             current_user AS usuario,
             NOW() AS hora_servidor,
             (SELECT COUNT(*) FROM public.insumos)::INTEGER AS cantidad_insumos
    `);
    res.json({ estado: "ok", mensaje: "Conexión con PostgreSQL exitosa.", datos: resultado.rows[0] });
  } catch (error) {
    console.error("Error al consultar PostgreSQL:", error.message);
    res.status(500).json({ estado: "error", mensaje: "No se pudo consultar PostgreSQL." });
  }
});

// El login es público; /me valida el token dentro de authRouter.
app.use("/api/auth", authRouter);

// Solo el rol administrador puede consultar o modificar estos módulos.
app.use("/api/insumos", authenticate, requireRole("administrador"), insumosRouter);
app.use("/api/recetas", authenticate, requireRole("administrador"), recetasRouter);
app.use("/api/recetas", authenticate, requireRole("administrador"), recetarioInteligenteRouter);
app.use("/api/jornadas", authenticate, requireRole("administrador"), jornadasRouter);
app.use("/api/donaciones", authenticate, requireRole("administrador"), donacionesRouter);
app.use("/api/reportes", authenticate, requireRole("administrador"), reportesRouter);
app.use("/api/voluntarios", authenticate, requireRole("administrador"), voluntariosRouter);
// Las tareas requieren identidad; el router limita las consultas y cambios del voluntario a su asignación.
app.use("/api/tareas", authenticate, tareasRouter);

app.use((req, res) => res.status(404).json({ error: "Ruta no encontrada", ruta: req.originalUrl }));
app.listen(PORT, () => console.log(`Servidor de Vivir para Servir activo en http://localhost:${PORT}`));