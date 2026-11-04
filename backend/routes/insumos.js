import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const UUID_VALIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FECHA_LOCAL_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Tucuman')::date";

const INVENTARIO_SELECT = `
  SELECT
    e.insumo_id,
    e.nombre,
    e.categoria,
    e.unidad_medida,
    e.stock_minimo,
    e.cantidad_total,
    e.proximo_vencimiento,
    e.stock_bajo,
    e.activo,
    i.actualizado_en,
    COALESCE(stock.cantidad_utilizable, 0) AS cantidad_utilizable,
    COALESCE(stock.cantidad_vencida, 0) AS cantidad_vencida,
    COALESCE(stock.cantidad_vence_hoy, 0) AS cantidad_vence_hoy,
    stock.proximo_vencimiento_utilizable,
    stock.proximo_vencimiento_lote
  FROM public.existencia_inventario AS e
  INNER JOIN public.insumos AS i ON i.id = e.insumo_id
  LEFT JOIN LATERAL (
    SELECT
      SUM(li.cantidad_disponible) FILTER (
        WHERE li.cantidad_disponible > 0
          AND (li.fecha_vencimiento IS NULL OR li.fecha_vencimiento >= ${FECHA_LOCAL_SQL})
      ) AS cantidad_utilizable,
      SUM(li.cantidad_disponible) FILTER (
        WHERE li.cantidad_disponible > 0 AND li.fecha_vencimiento < ${FECHA_LOCAL_SQL}
      ) AS cantidad_vencida,
      SUM(li.cantidad_disponible) FILTER (
        WHERE li.cantidad_disponible > 0 AND li.fecha_vencimiento = ${FECHA_LOCAL_SQL}
      ) AS cantidad_vence_hoy,
      (MIN(li.fecha_vencimiento) FILTER (
        WHERE li.cantidad_disponible > 0
          AND li.fecha_vencimiento IS NOT NULL
          AND li.fecha_vencimiento >= ${FECHA_LOCAL_SQL}
      ))::text AS proximo_vencimiento_utilizable,
      (MIN(li.fecha_vencimiento) FILTER (
        WHERE li.cantidad_disponible > 0 AND li.fecha_vencimiento IS NOT NULL
      ))::text AS proximo_vencimiento_lote
    FROM public.lotes_inventario AS li
    WHERE li.insumo_id = e.insumo_id
  ) AS stock ON TRUE
`;

function esNumeroValidoConHastaTresDecimales(valor) {
  return (
    Number.isFinite(valor) &&
    Math.abs(valor * 1000 - Math.round(valor * 1000)) < 0.000001
  );
}

function validarFecha(fecha) {
  if (fecha === null || fecha === undefined || fecha === "") return true;
  if (typeof fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return false;
  }
  const comprobacion = new Date(`${fecha}T12:00:00Z`);
  return !Number.isNaN(comprobacion.getTime()) &&
    comprobacion.toISOString().slice(0, 10) === fecha;
}

// GET /api/insumos
// Devuelve el catálogo activo con existencias agregadas por lote.
router.get("/", async (_req, res) => {
  try {
    const resultado = await pool.query(`
      ${INVENTARIO_SELECT}
      WHERE e.activo = TRUE
      ORDER BY e.nombre ASC
    `);

    res.json({ cantidad: resultado.rowCount, insumos: resultado.rows });
  } catch (error) {
    console.error("Error al consultar inventario:", error.message);
    res.status(500).json({ error: "No se pudo consultar el inventario." });
  }
});

// GET /api/insumos/alertas
// Devuelve alertas por lote y stock utilizable para el tablero principal.
router.get("/alertas", async (_req, res) => {
  try {
    const lotesResult = await pool.query(
      `SELECT
         l.id AS lote_id,
         i.id AS insumo_id,
         i.nombre,
         i.unidad_medida,
         l.cantidad_disponible,
         l.fecha_vencimiento::text AS fecha_vencimiento,
         (${FECHA_LOCAL_SQL})::text AS fecha_referencia,
         CASE
           WHEN l.fecha_vencimiento < ${FECHA_LOCAL_SQL} THEN 'vencido'
           WHEN l.fecha_vencimiento = ${FECHA_LOCAL_SQL} THEN 'vence_hoy'
           WHEN l.fecha_vencimiento <= ${FECHA_LOCAL_SQL} + 7 THEN 'proximo'
           ELSE 'sin_alerta'
         END AS tipo_alerta
       FROM public.lotes_inventario AS l
       INNER JOIN public.insumos AS i ON i.id = l.insumo_id
       WHERE i.activo = TRUE
         AND l.cantidad_disponible > 0
         AND l.fecha_vencimiento IS NOT NULL
         AND l.fecha_vencimiento <= ${FECHA_LOCAL_SQL} + 7
       ORDER BY l.fecha_vencimiento ASC, i.nombre ASC, l.creado_en ASC`
    );

    const stockResult = await pool.query(
      `SELECT
         i.id AS insumo_id,
         i.nombre,
         i.unidad_medida,
         i.stock_minimo,
         COALESCE(stock.cantidad_total, 0) AS cantidad_total,
         COALESCE(stock.cantidad_utilizable, 0) AS cantidad_utilizable,
         COALESCE(stock.cantidad_vencida, 0) AS cantidad_vencida,
         CASE
           WHEN COALESCE(stock.cantidad_utilizable, 0) <= 0 THEN 'Sin stock utilizable'
           ELSE 'Stock bajo'
         END AS estado_stock
       FROM public.insumos AS i
       LEFT JOIN LATERAL (
         SELECT
           SUM(l.cantidad_disponible) FILTER (WHERE l.cantidad_disponible > 0) AS cantidad_total,
           SUM(l.cantidad_disponible) FILTER (
             WHERE l.cantidad_disponible > 0
               AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${FECHA_LOCAL_SQL})
           ) AS cantidad_utilizable,
           SUM(l.cantidad_disponible) FILTER (
             WHERE l.cantidad_disponible > 0 AND l.fecha_vencimiento < ${FECHA_LOCAL_SQL}
           ) AS cantidad_vencida
         FROM public.lotes_inventario AS l
         WHERE l.insumo_id = i.id
       ) AS stock ON TRUE
       WHERE i.activo = TRUE
         AND COALESCE(stock.cantidad_utilizable, 0) <= i.stock_minimo
       ORDER BY COALESCE(stock.cantidad_utilizable, 0) ASC, i.nombre ASC`
    );

    const lotes = lotesResult.rows.map((fila) => ({
      ...fila,
      cantidad_disponible: Number(fila.cantidad_disponible || 0),
    }));
    const vencidos = lotes.filter((fila) => fila.tipo_alerta === "vencido");
    const venceHoy = lotes.filter((fila) => fila.tipo_alerta === "vence_hoy");
    const proximos = lotes.filter((fila) => fila.tipo_alerta === "proximo");
    const stockBajo = stockResult.rows.map((fila) => ({
      ...fila,
      cantidad_total: Number(fila.cantidad_total || 0),
      cantidad_utilizable: Number(fila.cantidad_utilizable || 0),
      cantidad_vencida: Number(fila.cantidad_vencida || 0),
      stock_minimo: Number(fila.stock_minimo || 0),
    }));
    const fechaReferencia = lotesResult.rows[0]?.fecha_referencia ||
      (await pool.query(`SELECT (${FECHA_LOCAL_SQL})::text AS fecha_referencia`)).rows[0].fecha_referencia;

    res.json({
      fecha_referencia: String(fechaReferencia).slice(0, 10),
      resumen: {
        vencidos: vencidos.length,
        vence_hoy: venceHoy.length,
        proximos_a_vencer: proximos.length,
        stock_bajo_o_insuficiente: stockBajo.length,
      },
      vencidos,
      vence_hoy: venceHoy,
      proximos_a_vencer: proximos,
      stock_bajo_o_insuficiente: stockBajo,
    });
  } catch (error) {
    console.error("Error al consultar alertas del inventario:", error.message);
    res.status(500).json({ error: "No se pudieron consultar las alertas de inventario." });
  }
});

// POST /api/insumos
// Crea un insumo y, si hay cantidad inicial, registra un lote y su movimiento.
router.post("/", async (req, res) => {
  const cuerpo = req.body ?? {};
  const nombre = typeof cuerpo.nombre === "string" ? cuerpo.nombre.trim() : "";
  const categoria = typeof cuerpo.categoria === "string" && cuerpo.categoria.trim()
    ? cuerpo.categoria.trim()
    : "General";
  const unidad = typeof cuerpo.unidad_medida === "string"
    ? cuerpo.unidad_medida.trim()
    : "";
  const stockMinimo = Number(cuerpo.stock_minimo ?? 0);
  const cantidadInicial = Number(cuerpo.cantidad_inicial ?? 0);
  const fechaVencimiento = cuerpo.fecha_vencimiento || null;
  const observaciones = typeof cuerpo.observaciones === "string"
    ? cuerpo.observaciones.trim() || null
    : null;

  if (!nombre || nombre.length > 120) {
    return res.status(400).json({ error: "El nombre es obligatorio y no puede superar los 120 caracteres." });
  }
  if (!categoria || categoria.length > 80) {
    return res.status(400).json({ error: "La categoría es obligatoria y no puede superar los 80 caracteres." });
  }
  if (!unidad || unidad.length > 20) {
    return res.status(400).json({ error: "La unidad de medida es obligatoria y no puede superar los 20 caracteres." });
  }
  if (!esNumeroValidoConHastaTresDecimales(stockMinimo) || stockMinimo < 0) {
    return res.status(400).json({ error: "El stock mínimo debe ser un número no negativo con hasta tres decimales." });
  }
  if (!esNumeroValidoConHastaTresDecimales(cantidadInicial) || cantidadInicial < 0) {
    return res.status(400).json({ error: "La cantidad inicial debe ser un número no negativo con hasta tres decimales." });
  }
  if (!validarFecha(fechaVencimiento)) {
    return res.status(400).json({ error: "La fecha de vencimiento no tiene un formato válido." });
  }
  if (cantidadInicial === 0 && fechaVencimiento) {
    return res.status(400).json({ error: "Para registrar un vencimiento, ingresá una cantidad inicial mayor que cero." });
  }

  let cliente;
  let transaccionActiva = false;

  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccionActiva = true;

    const nuevoInsumo = await cliente.query(
      `INSERT INTO public.insumos
         (nombre, categoria, unidad_medida, stock_minimo, observaciones)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [nombre, categoria, unidad, stockMinimo, observaciones]
    );

    const insumoId = nuevoInsumo.rows[0].id;

    if (cantidadInicial > 0) {
      // La existencia arranca en cero; el trigger suma el movimiento inicial.
      const lote = await cliente.query(
        `INSERT INTO public.lotes_inventario
           (insumo_id, fecha_recepcion, fecha_vencimiento,
            cantidad_original, cantidad_disponible, observaciones)
         VALUES ($1, ${FECHA_LOCAL_SQL}, $2, $3, 0, $4)
         RETURNING id`,
        [insumoId, fechaVencimiento, cantidadInicial, observaciones]
      );

      await cliente.query(
        `INSERT INTO public.movimientos_inventario
           (lote_id, tipo_movimiento, variacion_cantidad, observaciones)
         VALUES ($1, 'stock_inicial', $2, $3)`,
        [lote.rows[0].id, cantidadInicial, "Stock inicial registrado desde el módulo de inventario."]
      );
    }

    const inventarioActualizado = await cliente.query(
      `${INVENTARIO_SELECT} WHERE e.insumo_id = $1`,
      [insumoId]
    );

    await cliente.query("COMMIT");
    transaccionActiva = false;

    res.status(201).json({
      mensaje: "Insumo registrado correctamente en PostgreSQL.",
      insumo: inventarioActualizado.rows[0],
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try { await cliente.query("ROLLBACK"); } catch (errorRollback) {
        console.error("Error al revertir el alta del insumo:", errorRollback.message);
      }
    }

    if (error.code === "23505") {
      return res.status(409).json({ error: "Ya existe un insumo con ese nombre." });
    }
    console.error("Error al registrar insumo:", error.message);
    res.status(500).json({ error: "No se pudo registrar el insumo." });
  } finally {
    if (cliente) cliente.release();
  }
});

// GET /api/insumos/:id/movimientos
// Historial de entradas y salidas del insumo, ordenado del más reciente al más antiguo.
router.get("/:id/movimientos", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador del insumo no es válido." });
  }

  try {
    const existe = await pool.query(
      "SELECT id FROM public.insumos WHERE id = $1",
      [id]
    );
    if (existe.rowCount === 0) {
      return res.status(404).json({ error: "No se encontró el insumo." });
    }

    const resultado = await pool.query(
      `SELECT
         m.id,
         m.tipo_movimiento,
         m.variacion_cantidad,
         m.observaciones,
         m.creado_en,
         l.codigo_lote,
         l.fecha_vencimiento,
         i.unidad_medida
       FROM public.movimientos_inventario AS m
       INNER JOIN public.lotes_inventario AS l ON l.id = m.lote_id
       INNER JOIN public.insumos AS i ON i.id = l.insumo_id
       WHERE l.insumo_id = $1
       ORDER BY m.creado_en DESC, m.id DESC
       LIMIT 100`,
      [id]
    );

    res.json({ cantidad: resultado.rowCount, movimientos: resultado.rows });
  } catch (error) {
    console.error("Error al consultar movimientos de inventario:", error.message);
    res.status(500).json({ error: "No se pudo consultar el historial de movimientos." });
  }
});

// POST /api/insumos/:id/movimientos
// Registra un ajuste manual positivo o negativo sin editar el historial existente.
// Si se descuenta stock, se distribuye por lotes según próximo vencimiento (FEFO).
router.post("/:id/movimientos", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador del insumo no es válido." });
  }

  const cuerpo = req.body ?? {};
  const variacion = Number(cuerpo.variacion_cantidad);
  const fechaVencimiento = cuerpo.fecha_vencimiento || null;
  const observaciones = typeof cuerpo.observaciones === "string"
    ? cuerpo.observaciones.trim() || null
    : null;

  if (cuerpo.tipo_movimiento && cuerpo.tipo_movimiento !== "ajuste") {
    return res.status(400).json({ error: "Desde este formulario solo se permite el tipo de movimiento ajuste." });
  }
  if (!esNumeroValidoConHastaTresDecimales(variacion) || variacion === 0) {
    return res.status(400).json({ error: "La variación debe ser distinta de cero y tener como máximo tres decimales." });
  }
  if (!validarFecha(fechaVencimiento)) {
    return res.status(400).json({ error: "La fecha de vencimiento no tiene un formato válido." });
  }
  if (variacion < 0 && fechaVencimiento) {
    return res.status(400).json({ error: "La fecha de vencimiento solo se informa al ingresar un nuevo lote." });
  }

  let cliente;
  let transaccionActiva = false;
  const movimientosRegistrados = [];

  try {
    cliente = await pool.connect();
    await cliente.query("BEGIN");
    transaccionActiva = true;

    const insumo = await cliente.query(
      "SELECT id FROM public.insumos WHERE id = $1 AND activo = TRUE FOR UPDATE",
      [id]
    );
    if (insumo.rowCount === 0) {
      await cliente.query("ROLLBACK");
      transaccionActiva = false;
      return res.status(404).json({ error: "No se encontró el insumo activo." });
    }

    if (variacion > 0) {
      const lote = await cliente.query(
        `INSERT INTO public.lotes_inventario
           (insumo_id, fecha_recepcion, fecha_vencimiento,
            cantidad_original, cantidad_disponible, observaciones)
         VALUES ($1, ${FECHA_LOCAL_SQL}, $2, $3, 0, $4)
         RETURNING id`,
        [id, fechaVencimiento, variacion, observaciones]
      );

      const movimiento = await cliente.query(
        `INSERT INTO public.movimientos_inventario
           (lote_id, tipo_movimiento, variacion_cantidad, observaciones)
         VALUES ($1, 'ajuste', $2, $3)
         RETURNING id, lote_id, tipo_movimiento, variacion_cantidad, creado_en`,
        [lote.rows[0].id, variacion, observaciones || "Ajuste positivo desde el módulo de inventario."]
      );
      movimientosRegistrados.push(movimiento.rows[0]);
    } else {
      const cantidadADescontar = Math.abs(variacion);
      const lotes = await cliente.query(
        `SELECT id, cantidad_disponible
         FROM public.lotes_inventario
         WHERE insumo_id = $1 AND cantidad_disponible > 0
         ORDER BY fecha_vencimiento ASC NULLS LAST, fecha_recepcion ASC, creado_en ASC, id ASC
         FOR UPDATE`,
        [id]
      );

      const disponible = lotes.rows.reduce((total, lote) => total + Number(lote.cantidad_disponible), 0);
      if (disponible + 0.000001 < cantidadADescontar) {
        await cliente.query("ROLLBACK");
        transaccionActiva = false;
        return res.status(409).json({
          error: `Stock insuficiente. Disponible: ${disponible.toFixed(3)}; se intentó descontar ${cantidadADescontar.toFixed(3)}.`,
        });
      }

      let restante = cantidadADescontar;
      for (const lote of lotes.rows) {
        if (restante <= 0.000001) break;
        const disponibleLote = Number(lote.cantidad_disponible);
        const tomar = Math.min(disponibleLote, restante);
        const cantidadRedondeada = Number(tomar.toFixed(3));
        if (cantidadRedondeada <= 0) continue;

        const movimiento = await cliente.query(
          `INSERT INTO public.movimientos_inventario
             (lote_id, tipo_movimiento, variacion_cantidad, observaciones)
           VALUES ($1, 'ajuste', $2, $3)
           RETURNING id, lote_id, tipo_movimiento, variacion_cantidad, creado_en`,
          [lote.id, -cantidadRedondeada, observaciones || "Ajuste negativo desde el módulo de inventario."]
        );
        movimientosRegistrados.push(movimiento.rows[0]);
        restante = Number((restante - cantidadRedondeada).toFixed(3));
      }
    }

    const inventarioActualizado = await cliente.query(
      `${INVENTARIO_SELECT} WHERE e.insumo_id = $1`,
      [id]
    );

    await cliente.query("COMMIT");
    transaccionActiva = false;

    res.status(201).json({
      mensaje: "Movimiento de stock registrado correctamente.",
      insumo: inventarioActualizado.rows[0],
      movimientos: movimientosRegistrados,
    });
  } catch (error) {
    if (cliente && transaccionActiva) {
      try { await cliente.query("ROLLBACK"); } catch (errorRollback) {
        console.error("Error al revertir movimiento de inventario:", errorRollback.message);
      }
    }

    if (error.code === "23514") {
      return res.status(409).json({ error: "No se pudo aplicar el ajuste porque dejaría un lote con stock negativo." });
    }
    if (error.code === "23503") {
      return res.status(400).json({ error: "El movimiento referencia un registro inexistente." });
    }
    console.error("Error al registrar movimiento de inventario:", error.message);
    res.status(500).json({ error: "No se pudo registrar el movimiento de stock." });
  } finally {
    if (cliente) cliente.release();
  }
});

export default router;