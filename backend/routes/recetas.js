import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

// Validar identificadores UUID antes de consultar la base.
const UUID_VALIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Consulta común para devolver cada receta con sus ingredientes.
const CONSULTA_RECETAS = `
  SELECT
    r.id,
    r.nombre,
    r.descripcion,
    r.categoria,
    r.minutos_preparacion,
    r.porciones_referencia,
    r.instrucciones,
    r.activo,
    r.creado_en,
    r.actualizado_en,
    COALESCE(
      json_agg(
        json_build_object(
          'id', ir.id,
          'insumo_id', i.id,
          'nombre', i.nombre,
          'unidad_medida', i.unidad_medida,
          'cantidad_por_porcion', ir.cantidad_por_porcion,
          'observaciones', ir.observaciones
        )
        ORDER BY i.nombre
      ) FILTER (WHERE ir.id IS NOT NULL),
      '[]'::json
    ) AS ingredientes
  FROM public.recetas AS r
  LEFT JOIN public.ingredientes_receta AS ir
    ON ir.receta_id = r.id
  LEFT JOIN public.insumos AS i
    ON i.id = ir.insumo_id
`;

// GET /api/recetas
// Consultar todas las recetas activas y sus ingredientes.
router.get("/", async (req, res) => {
  try {
    const resultado = await pool.query(`
      ${CONSULTA_RECETAS}
      WHERE r.activo = TRUE
      GROUP BY r.id
      ORDER BY r.nombre ASC
    `);

    res.json({
      cantidad: resultado.rowCount,
      recetas: resultado.rows,
    });
  } catch (error) {
    console.error("Error al consultar recetas:", error.message);

    res.status(500).json({
      error: "No se pudieron consultar las recetas.",
    });
  }
});

// GET /api/recetas/:id
// Consultar una receta específica.
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({
      error: "El identificador de la receta no es válido.",
    });
  }

  try {
    const resultado = await pool.query(
      `
        ${CONSULTA_RECETAS}
        WHERE r.id = $1
          AND r.activo = TRUE
        GROUP BY r.id
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        error: "No se encontró la receta.",
      });
    }

    res.json({ receta: resultado.rows[0] });
  } catch (error) {
    console.error("Error al consultar la receta:", error.message);

    res.status(500).json({
      error: "No se pudo consultar la receta.",
    });
  }
});

// POST /api/recetas
// Registrar una receta y todos sus ingredientes en una transacción.
router.post("/", async (req, res) => {
  const cuerpo = req.body ?? {};

  const nombre =
    typeof cuerpo.nombre === "string"
      ? cuerpo.nombre.trim()
      : "";

  const categoria =
    typeof cuerpo.categoria === "string" &&
    cuerpo.categoria.trim()
      ? cuerpo.categoria.trim()
      : "Plato principal";

  const descripcion =
    typeof cuerpo.descripcion === "string"
      ? cuerpo.descripcion.trim() || null
      : null;

  const instrucciones =
    typeof cuerpo.instrucciones === "string"
      ? cuerpo.instrucciones.trim() || null
      : null;

  const porciones = Number(cuerpo.porciones_referencia ?? 1);

  const minutos =
    cuerpo.minutos_preparacion === null ||
    cuerpo.minutos_preparacion === undefined ||
    cuerpo.minutos_preparacion === ""
      ? null
      : Number(cuerpo.minutos_preparacion);

  if (!nombre) {
    return res.status(400).json({
      error: "El nombre de la receta es obligatorio.",
    });
  }

  if (!Number.isInteger(porciones) || porciones < 1) {
    return res.status(400).json({
      error: "Las porciones de referencia deben ser un entero positivo.",
    });
  }

  if (
    minutos !== null &&
    (!Number.isInteger(minutos) || minutos < 1)
  ) {
    return res.status(400).json({
      error: "El tiempo de preparación debe ser un entero positivo.",
    });
  }

  if (
    !Array.isArray(cuerpo.ingredientes) ||
    cuerpo.ingredientes.length === 0
  ) {
    return res.status(400).json({
      error: "La receta debe contener al menos un ingrediente.",
    });
  }

  const ingredientes = cuerpo.ingredientes.map((ingrediente) => ({
    insumo_id:
      typeof ingrediente?.insumo_id === "string"
        ? ingrediente.insumo_id.trim()
        : "",
    cantidad_por_porcion: Number(
      ingrediente?.cantidad_por_porcion
    ),
    observaciones:
      typeof ingrediente?.observaciones === "string"
        ? ingrediente.observaciones.trim() || null
        : null,
  }));

  for (const ingrediente of ingredientes) {
    if (!UUID_VALIDO.test(ingrediente.insumo_id)) {
      return res.status(400).json({
        error: "Uno de los identificadores de insumo no es válido.",
      });
    }

    if (
      !Number.isFinite(ingrediente.cantidad_por_porcion) ||
      ingrediente.cantidad_por_porcion <= 0
    ) {
      return res.status(400).json({
        error: "Las cantidades por porción deben ser mayores que cero.",
      });
    }
  }

  const idsInsumos = ingredientes.map(
    (ingrediente) => ingrediente.insumo_id
  );

  if (new Set(idsInsumos).size !== idsInsumos.length) {
    return res.status(400).json({
      error: "No repitas el mismo insumo dentro de una receta.",
    });
  }

  let cliente;
  let transaccionActiva = false;

  try {
    cliente = await pool.connect();

    await cliente.query("BEGIN");
    transaccionActiva = true;

    // Comprobar que todos los insumos existen y están activos.
    const insumosValidos = await cliente.query(
      `
        SELECT id
        FROM public.insumos
        WHERE id = ANY($1::uuid[])
          AND activo = TRUE
      `,
      [idsInsumos]
    );

    if (insumosValidos.rowCount !== idsInsumos.length) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;

      return res.status(400).json({
        error: "Uno o más insumos no existen o están inactivos.",
      });
    }

    // Guardar primero la receta.
    const nuevaReceta = await cliente.query(
      `
        INSERT INTO public.recetas (
          nombre,
          descripcion,
          categoria,
          minutos_preparacion,
          porciones_referencia,
          instrucciones
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `,
      [
        nombre,
        descripcion,
        categoria,
        minutos,
        porciones,
        instrucciones,
      ]
    );

    const recetaId = nuevaReceta.rows[0].id;

    // Asociar sus ingredientes.
    for (const ingrediente of ingredientes) {
      await cliente.query(
        `
          INSERT INTO public.ingredientes_receta (
            receta_id,
            insumo_id,
            cantidad_por_porcion,
            observaciones
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          recetaId,
          ingrediente.insumo_id,
          ingrediente.cantidad_por_porcion,
          ingrediente.observaciones,
        ]
      );
    }

    // Recuperar la receta completa antes de confirmar.
    const recetaCompleta = await cliente.query(
      `
        ${CONSULTA_RECETAS}
        WHERE r.id = $1
        GROUP BY r.id
      `,
      [recetaId]
    );

    await cliente.query("COMMIT");
    transaccionActiva = false;

    res.status(201).json({
      mensaje: "Receta registrada correctamente.",
      receta: recetaCompleta.rows[0],
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try {
        await cliente.query("ROLLBACK");
      } catch (errorRollback) {
        console.error(
          "Error al revertir la operación:",
          errorRollback.message
        );
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Ya existe una receta con ese nombre.",
      });
    }

    if (error.code === "23503") {
      return res.status(400).json({
        error: "La receta contiene una referencia que no existe.",
      });
    }

    console.error("Error al registrar receta:", error.message);

    res.status(500).json({
      error: "No se pudo registrar la receta.",
    });
  } finally {
    if (cliente) {
      cliente.release();
    }
  }
});

// PUT /api/recetas/:id
// Modificar una receta y actualizar/reemplazar sus ingredientes de forma transaccional.
router.put("/:id", async (req, res) => {
  const { id } = req.params;

  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({
      error: "El identificador de la receta no es válido.",
    });
  }

  const cuerpo = req.body ?? {};

  const nombre =
    typeof cuerpo.nombre === "string" ? cuerpo.nombre.trim() : "";
  const categoria =
    typeof cuerpo.categoria === "string" && cuerpo.categoria.trim()
      ? cuerpo.categoria.trim()
      : "Plato principal";
  const descripcion =
    typeof cuerpo.descripcion === "string"
      ? cuerpo.descripcion.trim() || null
      : null;
  const instrucciones =
    typeof cuerpo.instrucciones === "string"
      ? cuerpo.instrucciones.trim() || null
      : null;
  const porciones = Number(cuerpo.porciones_referencia ?? 1);
  const minutos =
    cuerpo.minutos_preparacion === null ||
    cuerpo.minutos_preparacion === undefined ||
    cuerpo.minutos_preparacion === ""
      ? null
      : Number(cuerpo.minutos_preparacion);

  if (!nombre) {
    return res.status(400).json({
      error: "El nombre de la receta es obligatorio.",
    });
  }

  if (!Number.isInteger(porciones) || porciones < 1) {
    return res.status(400).json({
      error: "Las porciones de referencia deben ser un entero positivo.",
    });
  }

  if (minutos !== null && (!Number.isInteger(minutos) || minutos < 1)) {
    return res.status(400).json({
      error: "El tiempo de preparación debe ser un entero positivo.",
    });
  }

  if (!Array.isArray(cuerpo.ingredientes) || cuerpo.ingredientes.length === 0) {
    return res.status(400).json({
      error: "La receta debe contener al menos un ingrediente.",
    });
  }

  const ingredientes = cuerpo.ingredientes.map((ingrediente) => ({
    insumo_id:
      typeof ingrediente?.insumo_id === "string"
        ? ingrediente.insumo_id.trim()
        : "",
    cantidad_por_porcion: Number(ingrediente?.cantidad_por_porcion),
    observaciones:
      typeof ingrediente?.observaciones === "string"
        ? ingrediente.observaciones.trim() || null
        : null,
  }));

  for (const ingrediente of ingredientes) {
    if (!UUID_VALIDO.test(ingrediente.insumo_id)) {
      return res.status(400).json({
        error: "Uno de los identificadores de insumo no es válido.",
      });
    }

    if (
      !Number.isFinite(ingrediente.cantidad_por_porcion) ||
      ingrediente.cantidad_por_porcion <= 0
    ) {
      return res.status(400).json({
        error: "Las cantidades por porción deben ser mayores que cero.",
      });
    }
  }

  const idsInsumos = ingredientes.map((i) => i.insumo_id);
  if (new Set(idsInsumos).size !== idsInsumos.length) {
    return res.status(400).json({
      error: "No repitas el mismo insumo dentro de una receta.",
    });
  }

  let cliente;
  let transaccionActiva = false;

  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccionActiva = true;

    // 1. Verificar si la receta existe
    const existe = await cliente.query(
      `SELECT id FROM public.recetas WHERE id = $1`,
      [id]
    );

    if (existe.rowCount === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(404).json({ error: "No se encontró la receta." });
    }

    // 2. Verificar que los insumos existan y estén activos
    const insumosValidos = await cliente.query(
      `
        SELECT id
        FROM public.insumos
        WHERE id = ANY($1::uuid[])
          AND activo = TRUE
      `,
      [idsInsumos]
    );

    if (insumosValidos.rowCount !== idsInsumos.length) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(400).json({
        error: "Uno o más insumos no existen o están inactivos.",
      });
    }

    // 3. Actualizar la cabecera de la receta
    await cliente.query(
      `
        UPDATE public.recetas
        SET nombre = $1,
            descripcion = $2,
            categoria = $3,
            minutos_preparacion = $4,
            porciones_referencia = $5,
            instrucciones = $6,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $7
      `,
      [nombre, descripcion, categoria, minutos, porciones, instrucciones, id]
    );

    // 4. Reemplazar los ingredientes: borrar anteriores y volver a insertar
    await cliente.query(
      `DELETE FROM public.ingredientes_receta WHERE receta_id = $1`,
      [id]
    );

    for (const ingrediente of ingredientes) {
      await cliente.query(
        `
          INSERT INTO public.ingredientes_receta (
            receta_id,
            insumo_id,
            cantidad_por_porcion,
            observaciones
          )
          VALUES ($1, $2, $3, $4)
        `,
        [
          id,
          ingrediente.insumo_id,
          ingrediente.cantidad_por_porcion,
          ingrediente.observaciones,
        ]
      );
    }

    // 5. Recuperar la receta actualizada para devolverla en la respuesta
    const recetaActualizada = await cliente.query(
      `
        ${CONSULTA_RECETAS}
        WHERE r.id = $1
        GROUP BY r.id
      `,
      [id]
    );

    await cliente.query("COMMIT");
    transaccionActiva = false;

    res.json({
      mensaje: "Receta actualizada correctamente.",
      receta: recetaActualizada.rows[0],
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try {
        await cliente.query("ROLLBACK");
      } catch (errRollback) {
        console.error("Error al hacer ROLLBACK:", errRollback.message);
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({
        error: "Ya existe otra receta con ese mismo nombre.",
      });
    }

    console.error("Error al actualizar receta:", error.message);
    res.status(500).json({ error: "No se pudo actualizar la receta." });
  } finally {
    if (cliente) cliente.release();
  }
});

// PATCH /api/recetas/:id/desactivar y DELETE /api/recetas/:id
// Ambos realizan una desactivación lógica (soft delete) para conservar
// el historial de jornadas y evitar borrar físicamente datos relacionados.
async function desactivarReceta(req, res) {
  const { id } = req.params;

  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({
      error: "El identificador de la receta no es válido.",
    });
  }

  try {
    const resultado = await pool.query(
      `
        UPDATE public.recetas
        SET activo = FALSE,
            actualizado_en = CURRENT_TIMESTAMP
        WHERE id = $1 AND activo = TRUE
        RETURNING id, nombre, activo
      `,
      [id]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({
        error: "No se encontró la receta o ya se encuentra inactiva.",
      });
    }

    return res.json({
      mensaje: "Receta desactivada correctamente. Se conserva en el historial.",
      receta: resultado.rows[0],
    });
  } catch (error) {
    console.error("Error al desactivar receta:", error.message);
    return res.status(500).json({
      error: "No se pudo desactivar la receta.",
    });
  }
}

// Mantener la ruta PATCH existente para no romper pruebas o clientes actuales.
router.patch("/:id/desactivar", desactivarReceta);

// Ruta DELETE solicitada por el frontend. Por seguridad histórica, no borra
// físicamente el registro: lo marca como inactivo igual que PATCH.
router.delete("/:id", desactivarReceta);

export default router;