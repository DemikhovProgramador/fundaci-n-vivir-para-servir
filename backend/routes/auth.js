import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { pool } from "../db.js";
import { authenticate, EMISOR_JWT_LOCAL } from "../auth/middleware.js";

const router = Router();
const limitadorLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Hubo demasiados intentos de ingreso. Esperá unos minutos e intentá nuevamente." },
});

function usuarioPublico(perfil) {
  return {
    id: perfil.id,
    nombre_completo: perfil.nombre_completo,
    correo_electronico: perfil.correo_electronico,
    rol: perfil.rol,
  };
}

router.post("/login", limitadorLogin, async (req, res) => {
  const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  if (!email || email.length > 254 || !password || password.length > 200) {
    return res.status(400).json({ error: "Ingresá un correo electrónico y una contraseña válidos." });
  }
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
    return res.status(503).json({ error: "La autenticación local no está configurada. Agregá un JWT_SECRET aleatorio de al menos 32 caracteres en backend/.env." });
  }

  try {
    const consulta = await pool.query(
      `SELECT p.id, p.nombre_completo, p.correo_electronico, p.rol, p.activo,
              c.id AS credencial_id, c.password_hash, c.intentos_fallidos, c.bloqueado_hasta
       FROM public.perfiles p
       JOIN public.credenciales_locales c ON c.perfil_id = p.id
       WHERE LOWER(p.correo_electronico) = $1
       LIMIT 2`,
      [email]
    );
    if (consulta.rowCount !== 1) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos, cuenta inactiva o credenciales todavía no configuradas." });
    }
    const perfil = consulta.rows[0];
    if (!perfil.activo) {
      return res.status(401).json({ error: "Correo o contraseña incorrectos, cuenta inactiva o credenciales todavía no configuradas." });
    }
    if (perfil.bloqueado_hasta && new Date(perfil.bloqueado_hasta).getTime() > Date.now()) {
      return res.status(429).json({ error: "La cuenta está bloqueada temporalmente por intentos fallidos. Volvé a intentar dentro de 15 minutos." });
    }

    const coincide = await bcrypt.compare(password, perfil.password_hash);
    if (!coincide) {
      await pool.query(
        `UPDATE public.credenciales_locales
         SET intentos_fallidos = intentos_fallidos + 1,
             bloqueado_hasta = CASE
               WHEN intentos_fallidos + 1 >= 5 THEN NOW() + INTERVAL '15 minutes'
               ELSE bloqueado_hasta
             END,
             actualizado_en = NOW()
         WHERE perfil_id = $1`,
        [perfil.id]
      );
      return res.status(401).json({ error: "Correo o contraseña incorrectos." });
    }

    await pool.query(
      `UPDATE public.credenciales_locales
       SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = NOW(), actualizado_en = NOW()
       WHERE perfil_id = $1`,
      [perfil.id]
    );
    const token = jwt.sign({}, process.env.JWT_SECRET, {
      subject: perfil.id,
      issuer: EMISOR_JWT_LOCAL,
      expiresIn: "8h",
    });
    return res.json({ mensaje: "Inicio de sesión correcto.", token, usuario: usuarioPublico(perfil) });
  } catch (error) {
    console.error("Error al iniciar sesión:", error.message);
    if (error.code === "42P01") {
      return res.status(500).json({ error: "Falta la tabla credenciales_locales. Ejecutá la migración SQL en vivir_para_servir_pruebas." });
    }
    return res.status(500).json({ error: "No se pudo verificar el ingreso. Revisá la terminal del backend." });
  }
});

router.get("/me", authenticate, (req, res) => {
  res.json({ usuario: usuarioPublico(req.user) });
});

export default router;