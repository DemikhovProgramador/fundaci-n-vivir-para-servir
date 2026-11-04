import jwt from "jsonwebtoken";
import { pool } from "../db.js";

const EMISOR_TOKEN = "vivir-para-servir-local";

export async function authenticate(req, res, next) {
  const autorizacion = req.headers.authorization || "";
  const coincidencia = autorizacion.match(/^Bearer\s+(.+)$/i);
  if (!coincidencia) {
    return res.status(401).json({ error: "Necesitás iniciar sesión para acceder a este recurso." });
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    return res.status(503).json({ error: "La autenticación local no está configurada. Revisá JWT_SECRET en backend/.env." });
  }

  try {
    const contenido = jwt.verify(coincidencia[1], process.env.JWT_SECRET, { issuer: EMISOR_TOKEN });
    if (!contenido.sub) return res.status(401).json({ error: "La sesión no es válida." });

    // Consultamos el perfil en cada petición para respetar inmediatamente una baja o cambio de rol.
    const resultado = await pool.query(
      `SELECT id, nombre_completo, correo_electronico, rol, activo
       FROM public.perfiles WHERE id = $1 LIMIT 1`,
      [contenido.sub]
    );
    const perfil = resultado.rows[0];
    if (!perfil || perfil.activo !== true) {
      return res.status(401).json({ error: "La cuenta está inactiva o ya no existe. Ingresá nuevamente." });
    }
    req.user = perfil;
    return next();
  } catch (error) {
    if (error?.name === "TokenExpiredError" || error?.name === "JsonWebTokenError" || error?.name === "NotBeforeError") {
      return res.status(401).json({ error: "La sesión venció o no es válida. Ingresá nuevamente." });
    }
    console.error("Error al validar la sesión:", error.message);
    return res.status(500).json({ error: "No se pudo verificar la sesión." });
  }
}

export function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Necesitás iniciar sesión." });
    if (!rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ error: "No tenés permisos para realizar esta operación." });
    }
    return next();
  };
}

export const EMISOR_JWT_LOCAL = EMISOR_TOKEN;