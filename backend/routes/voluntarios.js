import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/", async (_req, res) => {
  try {
    const resultado = await pool.query(`
      SELECT
        p.id,
        p.nombre_completo,
        p.correo_electronico,
        p.telefono,
        p.area_principal,
        p.rol,
        p.activo,
        p.creado_en,
        p.actualizado_en,
        COUNT(DISTINCT t.id) FILTER (WHERE t.estado IN ('pendiente', 'en_progreso'))::INTEGER AS tareas_pendientes,
        COUNT(DISTINCT t.id)::INTEGER AS tareas_asignadas
      FROM public.perfiles p
      LEFT JOIN public.asignaciones_tareas a ON a.perfil_id = p.id
      LEFT JOIN public.tareas t ON t.id = a.tarea_id
      WHERE p.rol = 'voluntario'
      GROUP BY p.id
      ORDER BY p.activo DESC, p.nombre_completo
    `);
    res.json({ cantidad: resultado.rowCount, voluntarios: resultado.rows });
  } catch (error) {
    console.error("Error al consultar voluntarios:", error.message);
    res.status(500).json({ error: "No se pudieron consultar los voluntarios. Comprobá que se haya aplicado la migración de area_principal." });
  }
});

router.post("/", async (req, res) => {
  const body = req.body || {};
  const nombre = typeof body.nombre_completo === "string" ? body.nombre_completo.trim() : "";
  const area = typeof body.area_principal === "string" ? body.area_principal.trim() : "Apoyo general";
  const email = typeof body.correo_electronico === "string" ? body.correo_electronico.trim().toLowerCase() : "";
  const telefono = typeof body.telefono === "string" ? body.telefono.trim() : "";

  if (!nombre || nombre.length > 120) return res.status(400).json({ error: "Ingresá el nombre y apellido (hasta 120 caracteres)." });
  if (!area || area.length > 80) return res.status(400).json({ error: "Ingresá un área principal de hasta 80 caracteres." });
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return res.status(400).json({ error: "El correo electrónico no tiene un formato válido." });
  }
  if (telefono.length > 40) return res.status(400).json({ error: "El teléfono admite hasta 40 caracteres." });

  try {
    const resultado = await pool.query(
      `INSERT INTO public.perfiles
        (nombre_completo, correo_electronico, telefono, rol, area_principal, activo)
       VALUES ($1, $2, $3, 'voluntario', $4, TRUE)
       RETURNING id, nombre_completo, correo_electronico, telefono, area_principal, rol, activo, creado_en, actualizado_en`,
      [nombre, email || null, telefono || null, area]
    );
    res.status(201).json({ mensaje: "Voluntario registrado en PostgreSQL.", voluntario: { ...resultado.rows[0], tareas_pendientes: 0, tareas_asignadas: 0 } });
  } catch (error) {
    console.error("Error al registrar voluntario:", error.message);
    if (error.code === "23505") return res.status(409).json({ error: "Ya existe un perfil con ese correo electrónico." });
    res.status(500).json({ error: "No se pudo registrar el voluntario." });
  }
});

router.patch("/:id/estado", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "El identificador del voluntario no es válido." });
  if (typeof req.body?.activo !== "boolean") return res.status(400).json({ error: "Indicá activo como verdadero o falso." });
  try {
    const resultado = await pool.query(
      `UPDATE public.perfiles
       SET activo = $2
       WHERE id = $1 AND rol = 'voluntario'
       RETURNING id, nombre_completo, correo_electronico, telefono, area_principal, rol, activo, creado_en, actualizado_en`,
      [req.params.id, req.body.activo]
    );
    if (!resultado.rowCount) return res.status(404).json({ error: "No se encontró el voluntario." });
    res.json({ mensaje: req.body.activo ? "Voluntario activado." : "Voluntario marcado como inactivo.", voluntario: resultado.rows[0] });
  } catch (error) {
    console.error("Error al cambiar el estado del voluntario:", error.message);
    res.status(500).json({ error: "No se pudo actualizar el estado del voluntario." });
  }
});

export default router;