import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const ESTADOS_TAREA = new Set(["pendiente", "en_progreso", "completada", "cancelada"]);
const PRIORIDADES = new Set(["baja", "media", "alta"]);
const ESTADOS_ASISTENCIA = new Set(["pendiente", "confirmada", "asistio", "ausente"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SQL_LISTAR_TAREAS = `
  SELECT
    t.id,
    t.titulo,
    t.area,
    t.observaciones,
    t.fecha_tarea,
    t.hora_tarea,
    t.prioridad,
    t.estado,
    t.jornada_id,
    t.creado_por,
    t.creado_en,
    t.actualizado_en,
    COALESCE(
      json_agg(
        json_build_object(
          'id', a.id,
          'perfil_id', p.id,
          'nombre_completo', p.nombre_completo,
          'correo_electronico', p.correo_electronico,
          'estado_asistencia', a.estado_asistencia,
          'observaciones', a.observaciones
        ) ORDER BY p.nombre_completo
      ) FILTER (WHERE a.id IS NOT NULL),
      '[]'::json
    ) AS asignaciones
  FROM public.tareas t
  LEFT JOIN public.asignaciones_tareas a ON a.tarea_id = t.id
  LEFT JOIN public.perfiles p ON p.id = a.perfil_id
`;

async function buscarTarea(client, id) {
  const resultado = await client.query(`${SQL_LISTAR_TAREAS} WHERE t.id = $1 GROUP BY t.id`, [id]);
  return resultado.rows[0] || null;
}

async function validarVoluntarioActivo(client, perfilId) {
  if (!UUID_RE.test(String(perfilId || ""))) {
    const error = new Error("El identificador del voluntario no es válido.");
    error.status = 400;
    throw error;
  }
  const resultado = await client.query(
    `SELECT id FROM public.perfiles WHERE id = $1 AND rol = 'voluntario' AND activo = TRUE`,
    [perfilId]
  );
  if (!resultado.rowCount) {
    const error = new Error("El voluntario seleccionado no existe o está inactivo.");
    error.status = 400;
    throw error;
  }
}

router.get("/", async (req, res) => {
  try {
    const esAdmin = req.user?.rol === "administrador";
    const filtro = esAdmin ? "" : "WHERE EXISTS (SELECT 1 FROM public.asignaciones_tareas propia WHERE propia.tarea_id = t.id AND propia.perfil_id = $1)";
    const parametros = esAdmin ? [] : [req.user.id];
    const resultado = await pool.query(`${SQL_LISTAR_TAREAS} ${filtro} GROUP BY t.id ORDER BY t.fecha_tarea, t.hora_tarea NULLS LAST, t.creado_en`, parametros);
    const tareas = esAdmin ? resultado.rows : resultado.rows.map((tarea) => ({
      ...tarea,
      asignaciones: (Array.isArray(tarea.asignaciones) ? tarea.asignaciones : []).filter((a) => String(a.perfil_id) === String(req.user.id)),
    }));
    res.json({ cantidad: tareas.length, tareas });
  } catch (error) {
    console.error("Error al consultar tareas:", error.message);
    res.status(500).json({ error: "No se pudieron consultar las tareas." });
  }
});

router.get("/:id", async (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "El identificador de la tarea no es válido." });
  try {
    const tarea = await buscarTarea(pool, req.params.id);
    if (!tarea) return res.status(404).json({ error: "No se encontró la tarea solicitada." });
    if (req.user?.rol !== "administrador") {
      const propias = (Array.isArray(tarea.asignaciones) ? tarea.asignaciones : []).filter((a) => String(a.perfil_id) === String(req.user.id));
      if (!propias.length) return res.status(404).json({ error: "No se encontró la tarea solicitada." });
      return res.json({ tarea: { ...tarea, asignaciones: propias } });
    }
    res.json({ tarea });
  } catch (error) {
    console.error("Error al consultar tarea:", error.message);
    res.status(500).json({ error: "No se pudo consultar la tarea." });
  }
});

router.post("/", async (req, res) => {
  if (req.user?.rol !== "administrador") return res.status(403).json({ error: "Solo un administrador puede crear tareas." });
  const {
    titulo,
    area = "Apoyo general",
    observaciones = null,
    fecha_tarea,
    hora_tarea = null,
    prioridad = "media",
    perfil_id = null,
    jornada_id = null,
  } = req.body || {};

  const tituloLimpio = typeof titulo === "string" ? titulo.trim() : "";
  const areaLimpia = typeof area === "string" ? area.trim() : "";
  const prioridadLimpia = String(prioridad || "media").toLowerCase();

  if (!tituloLimpio || tituloLimpio.length > 160) {
    return res.status(400).json({ error: "Ingresá un título de tarea de hasta 160 caracteres." });
  }
  if (!areaLimpia || areaLimpia.length > 80) {
    return res.status(400).json({ error: "Ingresá un área de hasta 80 caracteres." });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha_tarea || ""))) {
    return res.status(400).json({ error: "Ingresá una fecha válida para la tarea." });
  }
  if (hora_tarea && !/^\d{2}:\d{2}(:\d{2})?$/.test(String(hora_tarea))) {
    return res.status(400).json({ error: "La hora debe tener el formato HH:MM." });
  }
  if (!PRIORIDADES.has(prioridadLimpia)) {
    return res.status(400).json({ error: "La prioridad debe ser baja, media o alta." });
  }
  if (jornada_id && !UUID_RE.test(String(jornada_id))) {
    return res.status(400).json({ error: "El identificador de la jornada no es válido." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (perfil_id) await validarVoluntarioActivo(client, perfil_id);
    if (jornada_id) {
      const jornada = await client.query("SELECT id FROM public.jornadas_cocina WHERE id = $1", [jornada_id]);
      if (!jornada.rowCount) {
        const error = new Error("La jornada seleccionada no existe.");
        error.status = 400;
        throw error;
      }
    }

    const insertada = await client.query(
      `INSERT INTO public.tareas
        (titulo, area, observaciones, fecha_tarea, hora_tarea, prioridad, estado, jornada_id, creado_por)
       VALUES ($1, $2, $3, $4::date, $5::time, $6, 'pendiente', $7, NULL)
       RETURNING id`,
      [tituloLimpio, areaLimpia, observaciones ? String(observaciones).trim() : null, fecha_tarea, hora_tarea || null, prioridadLimpia, jornada_id || null]
    );
    const tareaId = insertada.rows[0].id;

    if (perfil_id) {
      await client.query(
        `INSERT INTO public.asignaciones_tareas (tarea_id, perfil_id, estado_asistencia)
         VALUES ($1, $2, 'pendiente')`,
        [tareaId, perfil_id]
      );
    }

    const tarea = await buscarTarea(client, tareaId);
    await client.query("COMMIT");
    res.status(201).json({ mensaje: "Tarea registrada en PostgreSQL.", tarea });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error al registrar tarea:", error.message);
    res.status(error.status || (error.code === "23505" ? 409 : 500)).json({
      error: error.status ? error.message : error.code === "23503" ? "La tarea hace referencia a un registro que no existe." : "No se pudo registrar la tarea.",
    });
  } finally {
    client.release();
  }
});

router.patch("/:id", async (req, res) => {
  const tareaId = req.params.id;
  if (!UUID_RE.test(tareaId)) return res.status(400).json({ error: "El identificador de la tarea no es válido." });
  const bodyEntrada = req.body || {};
  let body = { ...bodyEntrada };
  if (req.user?.rol !== "administrador") {
    const camposPermitidos = new Set(["estado_asistencia", "perfil_id"]);
    if (Object.keys(bodyEntrada).some((campo) => !camposPermitidos.has(campo)) ||
        !Object.prototype.hasOwnProperty.call(bodyEntrada, "estado_asistencia") ||
        String(bodyEntrada.perfil_id || "") !== String(req.user.id) ||
        !["pendiente", "confirmada"].includes(String(bodyEntrada.estado_asistencia).toLowerCase())) {
      return res.status(403).json({ error: "El voluntario solo puede confirmar o retirar su propia asistencia." });
    }
    const asignacionPropia = await pool.query(
      "SELECT 1 FROM public.asignaciones_tareas WHERE tarea_id = $1 AND perfil_id = $2",
      [tareaId, req.user.id]
    );
    if (!asignacionPropia.rowCount) return res.status(404).json({ error: "No se encontró la asignación de esta tarea." });
    // No permitir que el usuario modifique asignaciones; la API usa su ID autenticado.
    delete body.perfil_id;
  }
  const mapaCampos = {
    titulo: "titulo",
    area: "area",
    observaciones: "observaciones",
    fecha_tarea: "fecha_tarea",
    hora_tarea: "hora_tarea",
    prioridad: "prioridad",
    estado: "estado",
  };
  const sets = [];
  const valores = [tareaId];

  for (const [campo, columna] of Object.entries(mapaCampos)) {
    if (!Object.prototype.hasOwnProperty.call(body, campo)) continue;
    let valor = body[campo];
    if (campo === "titulo") {
      valor = String(valor || "").trim();
      if (!valor || valor.length > 160) return res.status(400).json({ error: "El título es obligatorio y admite hasta 160 caracteres." });
    }
    if (campo === "area") {
      valor = String(valor || "").trim();
      if (!valor || valor.length > 80) return res.status(400).json({ error: "El área es obligatoria y admite hasta 80 caracteres." });
    }
    if (campo === "prioridad") {
      valor = String(valor || "").toLowerCase();
      if (!PRIORIDADES.has(valor)) return res.status(400).json({ error: "La prioridad debe ser baja, media o alta." });
    }
    if (campo === "estado") {
      valor = String(valor || "").toLowerCase();
      if (!ESTADOS_TAREA.has(valor)) return res.status(400).json({ error: "El estado de la tarea no es válido." });
    }
    if (campo === "fecha_tarea" && !/^\d{4}-\d{2}-\d{2}$/.test(String(valor || ""))) {
      return res.status(400).json({ error: "La fecha de la tarea no es válida." });
    }
    if (campo === "hora_tarea" && valor && !/^\d{2}:\d{2}(:\d{2})?$/.test(String(valor))) {
      return res.status(400).json({ error: "La hora debe tener el formato HH:MM." });
    }
    if (["observaciones", "hora_tarea"].includes(campo) && (valor === "" || valor === undefined)) valor = null;
    valores.push(valor);
    const cast = campo === "fecha_tarea" ? "::date" : campo === "hora_tarea" ? "::time" : "";
    sets.push(`${columna} = $${valores.length}${cast}`);
  }

  const bodyTienePerfil = Object.prototype.hasOwnProperty.call(body, "perfil_id");
  const perfilId = body.perfil_id ? String(body.perfil_id) : null;
  if (bodyTienePerfil && perfilId && !UUID_RE.test(perfilId)) {
    return res.status(400).json({ error: "El identificador del voluntario no es válido." });
  }
  const asistencia = body.estado_asistencia === undefined ? null : String(body.estado_asistencia).toLowerCase();
  if (asistencia !== null && !ESTADOS_ASISTENCIA.has(asistencia)) {
    return res.status(400).json({ error: "El estado de asistencia no es válido." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existe = await client.query("SELECT id FROM public.tareas WHERE id = $1 FOR UPDATE", [tareaId]);
    if (!existe.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "No se encontró la tarea solicitada." });
    }
    if (sets.length) {
      await client.query(`UPDATE public.tareas SET ${sets.join(", ")} WHERE id = $1`, valores);
    }

    if (bodyTienePerfil) {
      if (perfilId) {
        await validarVoluntarioActivo(client, perfilId);
        await client.query("DELETE FROM public.asignaciones_tareas WHERE tarea_id = $1 AND perfil_id <> $2", [tareaId, perfilId]);
        await client.query(
          `INSERT INTO public.asignaciones_tareas (tarea_id, perfil_id, estado_asistencia)
           VALUES ($1, $2, 'pendiente') ON CONFLICT (tarea_id, perfil_id) DO NOTHING`,
          [tareaId, perfilId]
        );
      } else {
        await client.query("DELETE FROM public.asignaciones_tareas WHERE tarea_id = $1", [tareaId]);
      }
    }

    if (asistencia !== null) {
      if (bodyTienePerfil && !perfilId) {
        const error = new Error("No se puede registrar asistencia para una tarea sin responsable.");
        error.status = 400;
        throw error;
      }
      const targetId = req.user?.rol === "administrador"
        ? (perfilId || (await client.query(
            "SELECT perfil_id FROM public.asignaciones_tareas WHERE tarea_id = $1 ORDER BY asignado_en LIMIT 1",
            [tareaId]
          )).rows[0]?.perfil_id)
        : req.user.id;
      if (!targetId) {
        const error = new Error("Asigná un voluntario antes de registrar la asistencia.");
        error.status = 400;
        throw error;
      }
      const actualizado = await client.query(
        "UPDATE public.asignaciones_tareas SET estado_asistencia = $3 WHERE tarea_id = $1 AND perfil_id = $2",
        [tareaId, targetId, asistencia]
      );
      if (!actualizado.rowCount) {
        const error = new Error("No se encontró la asignación para registrar la asistencia.");
        error.status = 400;
        throw error;
      }
    }

    let tarea = await buscarTarea(client, tareaId);
    if (req.user?.rol !== "administrador" && tarea) {
      const propias = (Array.isArray(tarea.asignaciones) ? tarea.asignaciones : []).filter((a) => String(a.perfil_id) === String(req.user.id));
      tarea = { ...tarea, asignaciones: propias };
    }
    await client.query("COMMIT");
    res.json({ mensaje: "Tarea actualizada en PostgreSQL.", tarea });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Error al actualizar tarea:", error.message);
    res.status(error.status || 500).json({ error: error.status ? error.message : "No se pudo actualizar la tarea." });
  } finally {
    client.release();
  }
});

export default router;