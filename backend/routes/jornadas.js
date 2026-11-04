import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const UUID_VALIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MOMENTOS_VALIDOS = new Set(["Desayuno", "Almuerzo", "Merienda", "Cena", "Otro"]);
const DESTINOS_SOBRANTES_VALIDOS = new Set(["conservacion_refrigerada", "redistribucion", "donacion", "consumo_interno", "descarte", "otro"]);
const FECHA_LOCAL_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Tucuman')::date";

function esNumeroConHastaTresDecimales(valor) {
  return Number.isFinite(valor) &&
    Math.abs(valor * 1000 - Math.round(valor * 1000)) < 0.000001;
}

// Regla única del sistema: cantidad por vianda × viandas planificadas, redondeada a 3 decimales.
function calcularCantidadPlanificada(cantidadPorPorcion, porciones) {
  return Math.round(Number(cantidadPorPorcion) * Number(porciones) * 1000) / 1000;
}

function fechaISOValida(fecha) {
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false;
  const valor = new Date(`${fecha}T12:00:00Z`);
  return !Number.isNaN(valor.getTime()) && valor.toISOString().slice(0, 10) === fecha;
}

const CONSULTA_JORNADAS = `
  SELECT
    j.id,
    j.receta_id,
    r.nombre AS nombre_receta,
    r.descripcion AS descripcion_receta,
    r.minutos_preparacion,
    j.fecha_planificada::text AS fecha_planificada,
    j.momento_comida,
    j.porciones_planificadas,
    j.porciones_preparadas,
    j.porciones_sobrantes,
    j.estado,
    j.observaciones,
    j.creado_en,
    j.cerrada_en,
    COALESCE((
      SELECT json_agg(
        json_build_object(
          'id', sv.id,
          'cantidad_porciones', sv.cantidad_porciones,
          'destino', sv.destino,
          'observaciones', sv.observaciones,
          'creado_en', sv.creado_en
        ) ORDER BY sv.creado_en, sv.id
      )
      FROM public.sobrantes_viandas AS sv
      WHERE sv.jornada_id = j.id
    ), '[]'::json) AS destinos_sobrantes,
    COALESCE(
      json_agg(
        json_build_object(
          'insumo_id', i.id,
          'nombre_insumo', i.nombre,
          'unidad_medida', i.unidad_medida,
          'cantidad_por_porcion_copiada', ij.cantidad_por_porcion_copiada,
          'cantidad_planificada', ij.cantidad_planificada,
          'cantidad_utilizada_real', ij.cantidad_utilizada_real,
          'cantidad_devuelta', ij.cantidad_devuelta,
          'observaciones', ij.observaciones
        ) ORDER BY i.nombre
      ) FILTER (WHERE ij.id IS NOT NULL),
      '[]'::json
    ) AS ingredientes
  FROM public.jornadas_cocina AS j
  INNER JOIN public.recetas AS r ON r.id = j.receta_id
  LEFT JOIN public.ingredientes_jornada AS ij ON ij.jornada_id = j.id
  LEFT JOIN public.insumos AS i ON i.id = ij.insumo_id
`;

// GET /api/jornadas
// Consulta las jornadas desde PostgreSQL con la copia de los ingredientes previstos.
router.get("/", async (_req, res) => {
  try {
    const resultado = await pool.query(`
      ${CONSULTA_JORNADAS}
      GROUP BY j.id, r.id
      ORDER BY j.fecha_planificada DESC, j.creado_en DESC
    `);
    res.json({ cantidad: resultado.rowCount, jornadas: resultado.rows });
  } catch (error) {
    console.error("Error al consultar jornadas:", error.message);
    res.status(500).json({ error: "No se pudieron consultar las jornadas." });
  }
});

// POST /api/jornadas/verificar-disponibilidad
// Comprueba las cantidades necesarias contra lotes utilizables en la fecha de la jornada.
// No modifica ni reserva stock: es una verificación previa.
router.post("/verificar-disponibilidad", async (req, res) => {
  const cuerpo = req.body ?? {};
  const recetaId = typeof cuerpo.receta_id === "string" ? cuerpo.receta_id.trim() : "";
  const fecha = cuerpo.fecha_planificada;
  const porciones = Number(cuerpo.porciones_planificadas);

  if (!UUID_VALIDO.test(recetaId)) {
    return res.status(400).json({ error: "Seleccioná una receta válida para verificar el inventario." });
  }
  if (!fechaISOValida(fecha)) {
    return res.status(400).json({ error: "Indicá una fecha válida para la jornada." });
  }
  if (!Number.isSafeInteger(porciones) || porciones < 1) {
    return res.status(400).json({ error: "La cantidad de viandas debe ser un entero positivo." });
  }

  try {
    const receta = await pool.query(
      "SELECT id, nombre FROM public.recetas WHERE id = $1 AND activo = TRUE",
      [recetaId]
    );
    if (receta.rowCount === 0) {
      return res.status(404).json({ error: "No se encontró la receta activa seleccionada." });
    }

    const resultado = await pool.query(
      `SELECT
         ir.insumo_id,
         i.nombre AS nombre_insumo,
         i.unidad_medida,
         i.stock_minimo,
         i.activo,
         ir.cantidad_por_porcion,
         COALESCE(lotes.cantidad_total, 0) AS cantidad_total,
         COALESCE(lotes.cantidad_utilizable, 0) AS cantidad_utilizable,
         COALESCE(lotes.cantidad_vencida, 0) AS cantidad_vencida,
         lotes.proximo_vencimiento
       FROM public.ingredientes_receta AS ir
       LEFT JOIN public.insumos AS i ON i.id = ir.insumo_id
       LEFT JOIN LATERAL (
         SELECT
           SUM(li.cantidad_disponible) FILTER (WHERE li.cantidad_disponible > 0) AS cantidad_total,
           SUM(li.cantidad_disponible) FILTER (
             WHERE li.cantidad_disponible > 0
               AND (li.fecha_vencimiento IS NULL OR li.fecha_vencimiento >= $2::date)
           ) AS cantidad_utilizable,
           SUM(li.cantidad_disponible) FILTER (
             WHERE li.cantidad_disponible > 0 AND li.fecha_vencimiento < $2::date
           ) AS cantidad_vencida,
           (MIN(li.fecha_vencimiento) FILTER (
             WHERE li.cantidad_disponible > 0
               AND li.fecha_vencimiento IS NOT NULL
               AND li.fecha_vencimiento >= $2::date
           ))::text AS proximo_vencimiento
         FROM public.lotes_inventario AS li
         WHERE li.insumo_id = ir.insumo_id
       ) AS lotes ON TRUE
       WHERE ir.receta_id = $1
       ORDER BY i.nombre`,
      [recetaId, fecha]
    );

    if (resultado.rowCount === 0) {
      return res.status(422).json({ error: "La receta no tiene ingredientes asociados. Corregí la receta antes de planificar." });
    }
    if (resultado.rows.some((fila) => !fila.nombre_insumo || !fila.activo)) {
      return res.status(422).json({ error: "La receta contiene insumos inexistentes o inactivos. Corregí la receta antes de planificar." });
    }

    const ingredientes = resultado.rows.map((fila) => {
      const cantidadPorPorcion = Number(fila.cantidad_por_porcion);
      const necesaria = calcularCantidadPlanificada(cantidadPorPorcion, porciones);
      const total = Number(fila.cantidad_total || 0);
      const utilizable = Number(fila.cantidad_utilizable || 0);
      const vencida = Number(fila.cantidad_vencida || 0);
      const minimo = Number(fila.stock_minimo || 0);
      const faltante = Math.max(0, Math.round((necesaria - utilizable) * 1000) / 1000);
      const remanente = Math.round((utilizable - necesaria) * 1000) / 1000;
      const proximoVencimiento = fila.proximo_vencimiento ? String(fila.proximo_vencimiento).slice(0, 10) : null;
      return {
        insumo_id: fila.insumo_id,
        nombre_insumo: fila.nombre_insumo,
        unidad_medida: fila.unidad_medida,
        cantidad_por_porcion: cantidadPorPorcion,
        cantidad_necesaria: necesaria,
        cantidad_total: Math.round(total * 1000) / 1000,
        cantidad_utilizable: Math.round(utilizable * 1000) / 1000,
        cantidad_vencida_para_fecha: Math.round(vencida * 1000) / 1000,
        cantidad_faltante: faltante,
        cantidad_tras_preparacion: remanente,
        stock_minimo: minimo,
        stock_quedaria_bajo_minimo: remanente <= minimo,
        proximo_vencimiento: proximoVencimiento,
        insuficiente: faltante > 0.000001,
      };
    });

    res.json({
      receta_id: recetaId,
      nombre_receta: receta.rows[0].nombre,
      fecha_evaluada: fecha,
      porciones_planificadas: porciones,
      hay_faltantes: ingredientes.some((fila) => fila.insuficiente),
      hay_lotes_vencidos: ingredientes.some((fila) => fila.cantidad_vencida_para_fecha > 0),
      hay_stock_bajo_despues: ingredientes.some((fila) => fila.stock_quedaria_bajo_minimo),
      ingredientes,
    });
  } catch (error) {
    console.error("Error al verificar disponibilidad previa:", error.message);
    res.status(500).json({ error: "No se pudo verificar la disponibilidad de insumos." });
  }
});

// GET /api/jornadas/:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador de la jornada no es válido." });
  }

  try {
    const resultado = await pool.query(`
      ${CONSULTA_JORNADAS}
      WHERE j.id = $1
      GROUP BY j.id, r.id
    `, [id]);

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: "No se encontró la jornada." });
    }
    res.json({ jornada: resultado.rows[0] });
  } catch (error) {
    console.error("Error al consultar jornada:", error.message);
    res.status(500).json({ error: "No se pudo consultar la jornada." });
  }
});

// POST /api/jornadas
// Crea la jornada y copia las cantidades de la receta en una sola transacción.
router.post("/", async (req, res) => {
  const cuerpo = req.body ?? {};
  const recetaId = typeof cuerpo.receta_id === "string" ? cuerpo.receta_id.trim() : "";
  const fecha = cuerpo.fecha_planificada;
  const momento = typeof cuerpo.momento_comida === "string" ? cuerpo.momento_comida : "";
  const porciones = Number(cuerpo.porciones_planificadas);
  const observaciones = typeof cuerpo.observaciones === "string"
    ? cuerpo.observaciones.trim() || null
    : null;

  if (!UUID_VALIDO.test(recetaId)) {
    return res.status(400).json({ error: "Seleccioná una receta válida." });
  }
  if (!fechaISOValida(fecha)) {
    return res.status(400).json({ error: "La fecha planificada no tiene un formato válido." });
  }
  if (!MOMENTOS_VALIDOS.has(momento)) {
    return res.status(400).json({ error: "Seleccioná un momento de comida válido." });
  }
  if (!Number.isSafeInteger(porciones) || porciones < 1) {
    return res.status(400).json({ error: "La cantidad de viandas debe ser un entero positivo." });
  }

  let cliente;
  let transaccionActiva = false;
  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccionActiva = true;

    const receta = await cliente.query(
      `SELECT id, nombre FROM public.recetas WHERE id = $1 AND activo = TRUE FOR SHARE`,
      [recetaId]
    );
    if (receta.rowCount === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(404).json({ error: "No se encontró la receta activa seleccionada." });
    }

    const ingredientes = await cliente.query(
      `SELECT
         ir.insumo_id,
         ir.cantidad_por_porcion,
         i.nombre AS nombre_insumo,
         i.unidad_medida,
         i.activo
       FROM public.ingredientes_receta AS ir
       LEFT JOIN public.insumos AS i ON i.id = ir.insumo_id
       WHERE ir.receta_id = $1
       ORDER BY ir.insumo_id`,
      [recetaId]
    );

    if (ingredientes.rowCount === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(422).json({ error: "La receta no tiene ingredientes registrados." });
    }
    if (ingredientes.rows.some((fila) => !fila.nombre_insumo || !fila.activo)) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(422).json({ error: "La receta contiene insumos inexistentes o inactivos. Corregí la receta antes de planificar." });
    }

    const cantidades = ingredientes.rows.map((fila) => ({
      ...fila,
      cantidad_por_porcion: Number(fila.cantidad_por_porcion),
      cantidad_planificada: calcularCantidadPlanificada(fila.cantidad_por_porcion, porciones),
    }));
    const cantidadInvalida = cantidades.find((fila) => !Number.isFinite(fila.cantidad_planificada) || fila.cantidad_planificada <= 0);
    if (cantidadInvalida) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(422).json({ error: `La cantidad calculada de ${cantidadInvalida.nombre_insumo} es menor que la precisión admitida. Revisá la receta o la cantidad de porciones.` });
    }

    const nuevaJornada = await cliente.query(
      `INSERT INTO public.jornadas_cocina
         (receta_id, fecha_planificada, momento_comida, porciones_planificadas, estado, observaciones)
       VALUES ($1, $2, $3, $4, 'planificada', $5)
       RETURNING id`,
      [recetaId, fecha, momento, porciones, observaciones]
    );
    const jornadaId = nuevaJornada.rows[0].id;

    for (const ingrediente of cantidades) {
      await cliente.query(
        `INSERT INTO public.ingredientes_jornada
           (jornada_id, insumo_id, cantidad_por_porcion_copiada, cantidad_planificada)
         VALUES ($1, $2, $3, $4)`,
        [jornadaId, ingrediente.insumo_id, ingrediente.cantidad_por_porcion, ingrediente.cantidad_planificada]
      );
    }

    const jornadaCompleta = await cliente.query(`
      ${CONSULTA_JORNADAS}
      WHERE j.id = $1
      GROUP BY j.id, r.id
    `, [jornadaId]);

    await cliente.query("COMMIT");
    transaccionActiva = false;
    res.status(201).json({
      mensaje: "Jornada planificada y copia de ingredientes guardadas en PostgreSQL.",
      porciones_planificadas: porciones,
      jornada: jornadaCompleta.rows[0],
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try { await cliente.query("ROLLBACK"); } catch (errorRollback) {
        console.error("Error al revertir el alta de jornada:", errorRollback.message);
      }
    }
    console.error("Error al crear jornada:", error.message);
    res.status(500).json({ error: "No se pudo guardar la jornada en PostgreSQL." });
  } finally {
    if (cliente) cliente.release();
  }
});

// POST /api/jornadas/:id/iniciar
// Vuelve a comprobar el stock utilizable bajo bloqueo de lotes antes de permitir la preparación.
router.post("/:id/iniciar", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador de la jornada no es válido." });
  }

  let cliente;
  let transaccionActiva = false;
  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccionActiva = true;

    const jornadaResult = await cliente.query(
      `SELECT id, estado, porciones_planificadas
       FROM public.jornadas_cocina
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    if (jornadaResult.rowCount === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(404).json({ error: "No se encontró la jornada." });
    }
    const jornada = jornadaResult.rows[0];
    if (jornada.estado !== "planificada") {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(409).json({ error: jornada.estado === "en_preparacion" ? "La jornada ya está en preparación." : "Solo se puede iniciar una jornada planificada." });
    }

    const ingredientesResult = await cliente.query(
      `SELECT ij.insumo_id, i.nombre AS nombre_insumo, i.unidad_medida,
              ij.cantidad_por_porcion_copiada, ij.cantidad_planificada
       FROM public.ingredientes_jornada AS ij
       INNER JOIN public.insumos AS i ON i.id = ij.insumo_id
       WHERE ij.jornada_id = $1
       ORDER BY ij.insumo_id
       FOR UPDATE OF ij`,
      [id]
    );
    const ingredientes = ingredientesResult.rows;
    if (ingredientes.length === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(422).json({ error: "La jornada no tiene una copia de ingredientes. No se puede iniciar la preparación." });
    }

    const porcionesPlanificadas = Number(jornada.porciones_planificadas);
    const ingredienteInconsistente = ingredientes.find((fila) => {
      const esperado = calcularCantidadPlanificada(fila.cantidad_por_porcion_copiada, porcionesPlanificadas);
      return Math.abs(esperado - Number(fila.cantidad_planificada)) > 0.0005;
    });
    if (ingredienteInconsistente) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      const esperado = calcularCantidadPlanificada(ingredienteInconsistente.cantidad_por_porcion_copiada, porcionesPlanificadas);
      return res.status(409).json({
        error: `No se puede iniciar: la jornada está planificada para ${porcionesPlanificadas} viandas, pero la copia de ${ingredienteInconsistente.nombre_insumo} indica ${ingredienteInconsistente.cantidad_planificada} ${ingredienteInconsistente.unidad_medida}. Con ${ingredienteInconsistente.cantidad_por_porcion_copiada} ${ingredienteInconsistente.unidad_medida} por vianda deberían ser ${esperado} ${ingredienteInconsistente.unidad_medida}. No se modificó el inventario. Cancelá la jornada y volvé a planificarla.`,
      });
    }

    const idsInsumos = ingredientes.map((fila) => fila.insumo_id).sort();
    // Sincroniza con altas y ajustes de stock, que también bloquean la fila del insumo.
    await cliente.query(
      `SELECT id FROM public.insumos
       WHERE id = ANY($1::uuid[])
       ORDER BY id
       FOR UPDATE`,
      [idsInsumos]
    );
    const fechaResult = await cliente.query(`SELECT (${FECHA_LOCAL_SQL})::text AS fecha_hoy`);
    const hoy = String(fechaResult.rows[0].fecha_hoy).slice(0, 10);
    const lotesResult = await cliente.query(
      `SELECT id, insumo_id, cantidad_disponible,
              fecha_vencimiento::text AS fecha_vencimiento,
              fecha_recepcion, creado_en
       FROM public.lotes_inventario
       WHERE insumo_id = ANY($1::uuid[])
         AND cantidad_disponible > 0
       ORDER BY insumo_id, fecha_vencimiento ASC NULLS LAST,
                fecha_recepcion ASC, creado_en ASC, id ASC
       FOR UPDATE`,
      [idsInsumos]
    );

    const lotesPorInsumo = new Map();
    for (const lote of lotesResult.rows) {
      if (!lotesPorInsumo.has(lote.insumo_id)) lotesPorInsumo.set(lote.insumo_id, []);
      lotesPorInsumo.get(lote.insumo_id).push({
        ...lote,
        disponible: Number(lote.cantidad_disponible),
        vencimiento: lote.fecha_vencimiento ? String(lote.fecha_vencimiento).slice(0, 10) : null,
      });
    }

    const detalle = ingredientes.map((fila) => {
      const lotes = lotesPorInsumo.get(fila.insumo_id) ?? [];
      const total = lotes.reduce((suma, lote) => suma + lote.disponible, 0);
      const utilizable = lotes.reduce((suma, lote) => suma + (lote.vencimiento === null || lote.vencimiento >= hoy ? lote.disponible : 0), 0);
      const vencido = lotes.reduce((suma, lote) => suma + (lote.vencimiento !== null && lote.vencimiento < hoy ? lote.disponible : 0), 0);
      const necesaria = Number(fila.cantidad_planificada);
      return {
        insumo_id: fila.insumo_id,
        nombre_insumo: fila.nombre_insumo,
        unidad_medida: fila.unidad_medida,
        cantidad_necesaria: necesaria,
        cantidad_total: Math.round(total * 1000) / 1000,
        cantidad_utilizable: Math.round(utilizable * 1000) / 1000,
        cantidad_vencida: Math.round(vencido * 1000) / 1000,
        cantidad_faltante: Math.max(0, Math.round((necesaria - utilizable) * 1000) / 1000),
      };
    });

    const faltantes = detalle.filter((fila) => fila.cantidad_faltante > 0.000001);
    if (faltantes.length) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      const mensaje = faltantes.map((fila) => `${fila.nombre_insumo}: necesitás ${fila.cantidad_necesaria} ${fila.unidad_medida}, utilizable ${fila.cantidad_utilizable} ${fila.unidad_medida}, faltan ${fila.cantidad_faltante} ${fila.unidad_medida}`).join("; ");
      return res.status(409).json({
        error: `No se puede iniciar la preparación para ${porcionesPlanificadas} viandas: faltan insumos utilizables. ${mensaje}`,
        porciones_planificadas: porcionesPlanificadas,
        faltantes,
        ingredientes: detalle,
      });
    }

    // Entrega los insumos a cocina y descuenta el stock ahora, no al cerrar.
    // Los lotes se recorren por vencimiento más cercano (FEFO); los vencidos nunca se usan.
    for (const ingrediente of ingredientes) {
      let pendiente = Number(ingrediente.cantidad_planificada);
      const lotesValidos = (lotesPorInsumo.get(ingrediente.insumo_id) ?? [])
        .filter((lote) => lote.vencimiento === null || lote.vencimiento >= hoy);
      for (const lote of lotesValidos) {
        if (pendiente <= 0.000001) break;
        const cantidad = Math.round(Math.min(lote.disponible, pendiente) * 1000) / 1000;
        if (cantidad <= 0) continue;
        await cliente.query(
          `INSERT INTO public.movimientos_inventario
             (lote_id, tipo_movimiento, variacion_cantidad, jornada_id, observaciones)
           VALUES ($1, 'consumo', $2, $3, $4)`,
          [lote.id, -cantidad, id,
            `Entrega de ingrediente al iniciar la jornada. Cantidad planificada: ${ingrediente.cantidad_planificada} ${ingrediente.unidad_medida}.`]
        );
        lote.disponible = Math.round((lote.disponible - cantidad) * 1000) / 1000;
        pendiente = Math.round((pendiente - cantidad) * 1000) / 1000;
      }
      if (pendiente > 0.000001) {
        throw new Error(`El stock utilizable de ${ingrediente.nombre_insumo} cambió durante el inicio de la jornada.`);
      }
    }

    await cliente.query(
      `UPDATE public.jornadas_cocina
       SET estado = 'en_preparacion', actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id]
    );

    const advertencias = detalle
      .filter((fila) => fila.cantidad_vencida > 0)
      .map((fila) => `${fila.nombre_insumo}: hay ${fila.cantidad_vencida} ${fila.unidad_medida} de lotes vencidos que no cuentan como stock utilizable.`);

    await cliente.query("COMMIT");
    transaccionActiva = false;
    res.json({
      mensaje: "Disponibilidad verificada. La jornada pasó a estado en preparación.",
      porciones_planificadas: porcionesPlanificadas,
      advertencias,
      ingredientes: detalle,
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try { await cliente.query("ROLLBACK"); } catch (errorRollback) {
        console.error("Error al revertir el inicio de jornada:", errorRollback.message);
      }
    }
    if (error.code === "23514") {
      return res.status(409).json({ error: "El stock cambió durante la verificación. No se inició la preparación; volvé a verificar el inventario." });
    }
    console.error("Error al iniciar la preparación:", error.message);
    res.status(500).json({ error: "No se pudo iniciar la preparación." });
  } finally {
    if (cliente) cliente.release();
  }
});

// PATCH /api/jornadas/:id/cancelar
// Cancela una planificación pendiente sin borrar el historial.
router.patch("/:id/cancelar", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador de la jornada no es válido." });
  }

  try {
    const resultado = await pool.query(
      `UPDATE public.jornadas_cocina
       SET estado = 'cancelada', actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $1 AND estado = 'planificada'
       RETURNING id, estado`,
      [id]
    );
    if (resultado.rowCount === 0) {
      const existe = await pool.query("SELECT estado FROM public.jornadas_cocina WHERE id = $1", [id]);
      if (existe.rowCount === 0) return res.status(404).json({ error: "No se encontró la jornada." });
      return res.status(409).json({ error: "Solo se pueden cancelar jornadas que todavía están planificadas." });
    }
    res.json({ mensaje: "Jornada cancelada; se conservó el historial.", jornada: resultado.rows[0] });
  } catch (error) {
    console.error("Error al cancelar jornada:", error.message);
    res.status(500).json({ error: "No se pudo cancelar la jornada." });
  }
});

// PUT /api/jornadas/:id/cerrar
// Registra consumo real, devoluciones y sobrantes de viandas en una transacción.
// El stock sale al iniciar la preparación; al cerrar solo se reingresan los ingredientes devueltos.
router.put("/:id/cerrar", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador de la jornada no es válido." });
  }

  const cuerpo = req.body ?? {};
  const porcionesPreparadas = Number(cuerpo.porciones_preparadas);
  const porcionesSobrantes = Number(cuerpo.porciones_sobrantes);
  const ingredientesRecibidos = cuerpo.ingredientes;
  const destinosRecibidos = cuerpo.destinos_sobrantes ?? [];

  if (!Number.isSafeInteger(porcionesPreparadas) || porcionesPreparadas < 0) {
    return res.status(400).json({ error: "Las porciones preparadas deben ser un entero igual o mayor que cero." });
  }
  if (!Number.isSafeInteger(porcionesSobrantes) || porcionesSobrantes < 0) {
    return res.status(400).json({ error: "Las porciones sobrantes deben ser un entero igual o mayor que cero." });
  }
  if (!Array.isArray(ingredientesRecibidos)) {
    return res.status(400).json({ error: "Enviá los datos de consumo y devolución de cada ingrediente." });
  }
  if (!Array.isArray(destinosRecibidos)) {
    return res.status(400).json({ error: "Los destinos de las viandas sobrantes deben enviarse como una lista." });
  }
  if (porcionesSobrantes === 0 && destinosRecibidos.length > 0) {
    return res.status(400).json({ error: "No declares destinos si no hay viandas sobrantes." });
  }
  if (porcionesSobrantes > 0 && destinosRecibidos.length === 0) {
    return res.status(400).json({ error: "Indicá el destino de las viandas sobrantes antes de cerrar la jornada." });
  }
  let totalPorcionesConDestino = 0;
  for (const destino of destinosRecibidos) {
    const cantidad = Number(destino?.cantidad_porciones);
    const valorDestino = typeof destino?.destino === "string" ? destino.destino.trim() : "";
    const observaciones = typeof destino?.observaciones === "string" ? destino.observaciones.trim() : "";
    if (!Number.isSafeInteger(cantidad) || cantidad <= 0) {
      return res.status(400).json({ error: "Cada destino de sobrantes debe tener una cantidad entera mayor que cero." });
    }
    if (!DESTINOS_SOBRANTES_VALIDOS.has(valorDestino)) {
      return res.status(400).json({ error: "Seleccioná un destino válido para cada grupo de viandas sobrantes." });
    }
    if (observaciones.length > 1000) {
      return res.status(400).json({ error: "Las observaciones del destino no pueden superar los 1000 caracteres." });
    }
    if (valorDestino === "descarte" && !observaciones) {
      return res.status(400).json({ error: "Cuando se descarten viandas, registrá el motivo en las observaciones." });
    }
    totalPorcionesConDestino += cantidad;
  }
  if (totalPorcionesConDestino !== porcionesSobrantes) {
    return res.status(400).json({ error: `La suma de viandas asignadas a destinos (${totalPorcionesConDestino}) debe coincidir con las viandas sobrantes (${porcionesSobrantes}).` });
  }

  let cliente;
  let transaccionActiva = false;
  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccionActiva = true;

    const jornadaResult = await cliente.query(
      `SELECT id, estado, porciones_planificadas
       FROM public.jornadas_cocina
       WHERE id = $1
       FOR UPDATE`,
      [id]
    );
    if (jornadaResult.rowCount === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(404).json({ error: "No se encontró la jornada." });
    }
    const jornada = jornadaResult.rows[0];
    const porcionesPlanificadas = Number(jornada.porciones_planificadas);

    if (jornada.estado !== "en_preparacion") {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(409).json({ error: "Antes de cerrar la jornada, iniciá la preparación para que el sistema compruebe la disponibilidad de insumos." });
    }
    if (porcionesPreparadas > porcionesPlanificadas) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(400).json({ error: "Las porciones preparadas no pueden superar las porciones planificadas." });
    }
    if (porcionesSobrantes > porcionesPreparadas) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(400).json({ error: "Las viandas sobrantes no pueden superar las viandas preparadas." });
    }

    const snapshotResult = await cliente.query(
      `SELECT
         ij.id,
         ij.insumo_id,
         i.nombre AS nombre_insumo,
         i.unidad_medida,
         ij.cantidad_por_porcion_copiada,
         ij.cantidad_planificada,
         ij.cantidad_utilizada_real,
         ij.cantidad_devuelta
       FROM public.ingredientes_jornada AS ij
       INNER JOIN public.insumos AS i ON i.id = ij.insumo_id
       WHERE ij.jornada_id = $1
       ORDER BY ij.insumo_id
       FOR UPDATE OF ij`,
      [id]
    );
    const snapshot = snapshotResult.rows;
    if (snapshot.length === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(422).json({ error: "La jornada no tiene una copia de ingredientes para cerrar." });
    }
    const ingredienteInconsistente = snapshot.find((fila) => {
      const esperado = calcularCantidadPlanificada(fila.cantidad_por_porcion_copiada, porcionesPlanificadas);
      return Math.abs(esperado - Number(fila.cantidad_planificada)) > 0.0005;
    });
    if (ingredienteInconsistente) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      const esperado = calcularCantidadPlanificada(ingredienteInconsistente.cantidad_por_porcion_copiada, porcionesPlanificadas);
      return res.status(409).json({ error: `No se puede cerrar la jornada porque las cantidades no coinciden con las ${porcionesPlanificadas} viandas planificadas. ${ingredienteInconsistente.nombre_insumo}: se guardaron ${ingredienteInconsistente.cantidad_planificada} ${ingredienteInconsistente.unidad_medida}, pero deberían ser ${esperado} ${ingredienteInconsistente.unidad_medida}. No se registraron cambios.` });
    }

    const porInsumoRecibido = new Map();
    for (const dato of ingredientesRecibidos) {
      const insumoId = typeof dato?.insumo_id === "string" ? dato.insumo_id.trim() : "";
      const utilizada = Number(dato?.cantidad_utilizada_real);
      const devuelta = Number(dato?.cantidad_devuelta);
      if (!UUID_VALIDO.test(insumoId)) {
        await cliente.query("ROLLBACK");
        transaccionActiva = false;
        return res.status(400).json({ error: "Uno de los identificadores de ingrediente no es válido." });
      }
      if (porInsumoRecibido.has(insumoId)) {
        await cliente.query("ROLLBACK");
        transaccionActiva = false;
        return res.status(400).json({ error: "No repitas un ingrediente al cerrar la jornada." });
      }
      if (!esNumeroConHastaTresDecimales(utilizada) || utilizada < 0 ||
          !esNumeroConHastaTresDecimales(devuelta) || devuelta < 0) {
        await cliente.query("ROLLBACK");
        transaccionActiva = false;
        return res.status(400).json({ error: "Las cantidades utilizadas y devueltas deben ser no negativas y tener hasta tres decimales." });
      }
      porInsumoRecibido.set(insumoId, { utilizada, devuelta });
    }

    if (porInsumoRecibido.size !== snapshot.length || snapshot.some((fila) => !porInsumoRecibido.has(fila.insumo_id))) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(400).json({ error: "Debés informar el consumo real y la devolución de todos los ingredientes de la jornada." });
    }

    const detalleCierre = snapshot.map((fila) => {
      const dato = porInsumoRecibido.get(fila.insumo_id);
      const planificado = Number(fila.cantidad_planificada);
      const suma = Math.round((dato.utilizada + dato.devuelta) * 1000) / 1000;
      return {
        ...fila,
        planificado,
        utilizada: dato.utilizada,
        devuelta: dato.devuelta,
        diferencia: Math.round((planificado - suma) * 1000) / 1000,
      };
    });

    const cantidadInconsistente = detalleCierre.find((fila) => fila.utilizada + fila.devuelta > fila.planificado + 0.000001);
    if (cantidadInconsistente) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(400).json({
        error: `${cantidadInconsistente.nombre_insumo}: la cantidad utilizada más la devuelta no puede superar los ${cantidadInconsistente.planificado} ${cantidadInconsistente.unidad_medida} planificados.`,
      });
    }

    // La salida de stock ya se registró al iniciar la jornada. Recuperamos esos movimientos
    // para devolver sobrantes únicamente a los lotes que se entregaron originalmente.
    const movimientosSalida = await cliente.query(
      `SELECT m.lote_id, l.insumo_id, (-m.variacion_cantidad) AS cantidad_entregada,
              m.creado_en, m.id
       FROM public.movimientos_inventario AS m
       INNER JOIN public.lotes_inventario AS l ON l.id = m.lote_id
       WHERE m.jornada_id = $1
         AND m.tipo_movimiento = 'consumo'
         AND m.variacion_cantidad < 0
       ORDER BY m.creado_en ASC, m.id ASC`,
      [id]
    );
    const asignacionesPorInsumo = new Map();
    for (const movimiento of movimientosSalida.rows) {
      if (!asignacionesPorInsumo.has(movimiento.insumo_id)) asignacionesPorInsumo.set(movimiento.insumo_id, []);
      asignacionesPorInsumo.get(movimiento.insumo_id).push({
        lote_id: movimiento.lote_id,
        cantidad: Number(movimiento.cantidad_entregada),
      });
    }

    const salidaIncompleta = detalleCierre.find((fila) => {
      const asignaciones = asignacionesPorInsumo.get(fila.insumo_id) ?? [];
      const entregada = asignaciones.reduce((suma, asignacion) => suma + asignacion.cantidad, 0);
      return Math.abs(entregada - fila.planificado) > 0.001;
    });
    if (salidaIncompleta) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(409).json({ error: `No se encontró la salida completa de ${salidaIncompleta.nombre_insumo} al iniciar la jornada. No se registró el cierre; revisá el historial de movimientos.` });
    }

    for (const fila of detalleCierre) {
      // Los ingredientes ya fueron descontados al iniciar. Solo se reingresa lo devuelto.
      let porDevolver = fila.devuelta;
      const asignaciones = [...(asignacionesPorInsumo.get(fila.insumo_id) ?? [])].reverse();
      for (const asignacion of asignaciones) {
        if (porDevolver <= 0.000001) break;
        const cantidad = Math.round(Math.min(asignacion.cantidad, porDevolver) * 1000) / 1000;
        if (cantidad <= 0) continue;
        await cliente.query(
          `INSERT INTO public.movimientos_inventario
             (lote_id, tipo_movimiento, variacion_cantidad, jornada_id, observaciones)
           VALUES ($1, 'devolucion_sobrante', $2, $3, $4)`,
          [asignacion.lote_id, cantidad, id,
            `Devolución de ingrediente no utilizado al cerrar la jornada. Cantidad devuelta: ${cantidad} ${fila.unidad_medida}.`]
        );
        porDevolver = Math.round((porDevolver - cantidad) * 1000) / 1000;
      }
      if (porDevolver > 0.000001) {
        throw new Error(`No se pudo asignar la devolución de ${fila.nombre_insumo} a sus lotes de origen.`);
      }

      const observacionesIngrediente = fila.diferencia > 0
        ? `Diferencia no devuelta registrada al cierre: ${fila.diferencia} ${fila.unidad_medida}.`
        : null;
      await cliente.query(
        `UPDATE public.ingredientes_jornada
         SET cantidad_utilizada_real = $1,
             cantidad_devuelta = $2,
             observaciones = $3
         WHERE id = $4`,
        [fila.utilizada, fila.devuelta, observacionesIngrediente, fila.id]
      );
    }

    // Registrar el destino de cada grupo de viandas sobrantes en la misma transacción.
    // No altera el inventario de ingredientes: registra exclusivamente porciones preparadas.
    for (const destino of destinosRecibidos) {
      await cliente.query(
        `INSERT INTO public.sobrantes_viandas
           (jornada_id, cantidad_porciones, destino, observaciones)
         VALUES ($1, $2, $3, $4)`,
        [id, Number(destino.cantidad_porciones), destino.destino,
          typeof destino.observaciones === "string" ? destino.observaciones.trim() || null : null]
      );
    }

    await cliente.query(
      `UPDATE public.jornadas_cocina
       SET porciones_preparadas = $1,
           porciones_sobrantes = $2,
           estado = 'preparada',
           cerrada_en = CURRENT_TIMESTAMP,
           actualizado_en = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [porcionesPreparadas, porcionesSobrantes, id]
    );

    const jornadaCompleta = await cliente.query(`
      ${CONSULTA_JORNADAS}
      WHERE j.id = $1
      GROUP BY j.id, r.id
    `, [id]);

    await cliente.query("COMMIT");
    transaccionActiva = false;
    res.json({
      mensaje: "Jornada cerrada. Se registraron el consumo, las devoluciones y las porciones sobrantes.",
      jornada: jornadaCompleta.rows[0],
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try { await cliente.query("ROLLBACK"); } catch (errorRollback) {
        console.error("Error al revertir el cierre de jornada:", errorRollback.message);
      }
    }
    if (error.code === "23514") {
      return res.status(409).json({ error: "El stock cambió durante la operación o no alcanza en uno de los lotes. No se cerró la jornada." });
    }
    console.error("Error al cerrar jornada:", error.message);
    res.status(500).json({ error: error.message || "No se pudo cerrar la jornada; la operación se revirtió." });
  } finally {
    if (cliente) cliente.release();
  }
});

export default router;