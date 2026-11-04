import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA_LOCAL_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Tucuman')::date";

function esFechaISOValida(valor) {
  if (typeof valor !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
  const fecha = new Date(`${valor}T00:00:00.000Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

function esCantidadValida(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 &&
    Math.abs(numero * 1000 - Math.round(numero * 1000)) < 0.000001;
}

function esCostoValido(valor) {
  if (valor === null || valor === undefined || valor === "") return true;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 &&
    Math.abs(numero * 100 - Math.round(numero * 100)) < 0.000001;
}

function esMontoDineroValido(valor) {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 && numero <= 9999999999.99 &&
    Math.abs(numero * 100 - Math.round(numero * 100)) < 0.000001;
}

const SELECT_DONACIONES = `
  SELECT
    d.id,
    d.nombre_donante,
    d.contacto_donante,
    d.fecha_recepcion::text AS fecha_recepcion,
    d.tipo_donacion,
    d.monto_dinero,
    d.moneda,
    d.estado,
    d.observaciones,
    d.registrado_por,
    d.creado_en,
    d.actualizado_en,
    COUNT(l.id)::int AS cantidad_lotes,
    COALESCE(
      JSONB_AGG(
        JSONB_BUILD_OBJECT(
          'lote_id', l.id,
          'insumo_id', i.id,
          'nombre_insumo', i.nombre,
          'unidad_medida', i.unidad_medida,
          'codigo_lote', l.codigo_lote,
          'fecha_recepcion', l.fecha_recepcion::text,
          'fecha_vencimiento', l.fecha_vencimiento::text,
          'cantidad_original', l.cantidad_original,
          'cantidad_disponible', l.cantidad_disponible,
          'costo_unitario', l.costo_unitario,
          'observaciones_lote', l.observaciones
        ) ORDER BY i.nombre, l.creado_en
      ) FILTER (WHERE l.id IS NOT NULL),
      '[]'::jsonb
    ) AS items
  FROM public.donaciones AS d
  LEFT JOIN public.lotes_inventario AS l ON l.donacion_id = d.id
  LEFT JOIN public.insumos AS i ON i.id = l.insumo_id
`;

// GET /api/donaciones — historial con los lotes asociados a cada recepción.
router.get("/", async (_req, res) => {
  try {
    const resultado = await pool.query(`
      ${SELECT_DONACIONES}
      GROUP BY d.id
      ORDER BY d.fecha_recepcion DESC, d.creado_en DESC
    `);
    res.json({ cantidad: resultado.rowCount, donaciones: resultado.rows });
  } catch (error) {
    console.error("Error al consultar donaciones:", error.message);
    res.status(500).json({ error: "No se pudo consultar el historial de donaciones." });
  }
});

// GET /api/donaciones/:id — consulta individual sin borrar ni alterar su historial.
router.get("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({ error: "El identificador de la donación no tiene un formato válido." });
  }
  try {
    const resultado = await pool.query(`
      ${SELECT_DONACIONES}
      WHERE d.id = $1
      GROUP BY d.id
    `, [id]);
    if (!resultado.rowCount) return res.status(404).json({ error: "No se encontró la donación solicitada." });
    return res.json({ donacion: resultado.rows[0] });
  } catch (error) {
    console.error("Error al consultar el detalle de una donación:", error.message);
    return res.status(500).json({ error: "No se pudo consultar el detalle de la donación." });
  }
});

// POST /api/donaciones — registra una recepción real y todos sus lotes/movimientos
// dentro de una única transacción. El disparador de PostgreSQL incrementa el lote
// cuando se inserta cada movimiento; por eso los lotes se crean con stock disponible 0.
router.post("/", async (req, res) => {
  const nombreDonante = typeof req.body?.nombre_donante === "string" ? req.body.nombre_donante.trim() : "";
  const contactoDonante = typeof req.body?.contacto_donante === "string" ? req.body.contacto_donante.trim() : "";
  const fechaRecepcion = req.body?.fecha_recepcion;
  const observaciones = typeof req.body?.observaciones === "string" ? req.body.observaciones.trim() : "";
  const tipoDonacion = typeof req.body?.tipo_donacion === "string" ? req.body.tipo_donacion : "alimentos";
  const montoBruto = req.body?.monto_dinero;
  const montoDinero = montoBruto === undefined || montoBruto === null || montoBruto === "" ? 0 : Number(montoBruto);
  const moneda = typeof req.body?.moneda === "string" && req.body.moneda.trim() ? req.body.moneda.trim().toUpperCase() : "ARS";
  if (req.body?.items !== undefined && !Array.isArray(req.body.items)) {
    return res.status(400).json({ error: "La lista de alimentos debe tener un formato válido." });
  }
  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  const tiposValidos = ["alimentos", "dinero", "mixta"];

  if (!nombreDonante || nombreDonante.length > 160) {
    return res.status(400).json({ error: "Ingresá el nombre del donante (máximo 160 caracteres)." });
  }
  if (contactoDonante.length > 160) {
    return res.status(400).json({ error: "El contacto del donante no puede superar los 160 caracteres." });
  }
  if (!esFechaISOValida(fechaRecepcion)) {
    return res.status(400).json({ error: "Ingresá una fecha de recepción válida." });
  }
  if (!tiposValidos.includes(tipoDonacion)) {
    return res.status(400).json({ error: "El tipo de donación debe ser alimentos, dinero o mixta." });
  }
  if (!esMontoDineroValido(montoDinero)) {
    return res.status(400).json({ error: "El importe monetario debe ser cero o mayor y tener hasta dos decimales." });
  }
  if (moneda !== "ARS") {
    return res.status(400).json({ error: "Por ahora, la moneda admitida para las donaciones monetarias es el peso argentino (ARS)." });
  }
  if (tipoDonacion === "alimentos" && montoDinero !== 0) {
    return res.status(400).json({ error: "Una donación solo de alimentos debe tener importe monetario cero." });
  }
  if (tipoDonacion === "dinero" && montoDinero <= 0) {
    return res.status(400).json({ error: "Ingresá un importe mayor que cero para la donación monetaria." });
  }
  if (tipoDonacion === "mixta" && montoDinero <= 0) {
    return res.status(400).json({ error: "Una donación mixta debe incluir un importe monetario mayor que cero." });
  }
  if (tipoDonacion === "alimentos" && (items.length < 1 || items.length > 50)) {
    return res.status(400).json({ error: "Una donación de alimentos debe incluir entre 1 y 50 alimentos." });
  }
  if (tipoDonacion === "dinero" && items.length !== 0) {
    return res.status(400).json({ error: "Una donación solo de dinero no debe incluir alimentos." });
  }
  if (tipoDonacion === "mixta" && (items.length < 1 || items.length > 50)) {
    return res.status(400).json({ error: "Una donación mixta debe incluir entre 1 y 50 alimentos, además del importe monetario." });
  }

  for (let indice = 0; indice < items.length; indice += 1) {
    const item = items[indice] || {};
    if (typeof item.insumo_id !== "string" || !UUID_VALIDO.test(item.insumo_id)) {
      return res.status(400).json({ error: `Elegí un insumo válido en el renglón ${indice + 1}.` });
    }
    if (!esCantidadValida(item.cantidad)) {
      return res.status(400).json({ error: `La cantidad del renglón ${indice + 1} debe ser mayor que cero y tener hasta tres decimales.` });
    }
    if (item.fecha_vencimiento && !esFechaISOValida(item.fecha_vencimiento)) {
      return res.status(400).json({ error: `La fecha de vencimiento del renglón ${indice + 1} no es válida.` });
    }
    if (item.fecha_vencimiento && item.fecha_vencimiento < fechaRecepcion) {
      return res.status(400).json({ error: `El vencimiento del renglón ${indice + 1} es anterior a la fecha de recepción. Revisá el alimento antes de ingresarlo como una recepción.` });
    }
    if (!esCostoValido(item.costo_unitario)) {
      return res.status(400).json({ error: `El costo unitario del renglón ${indice + 1} debe ser cero o mayor y tener hasta dos decimales.` });
    }
    if (item.codigo_lote != null && String(item.codigo_lote).trim().length > 80) {
      return res.status(400).json({ error: `El código de lote del renglón ${indice + 1} no puede superar los 80 caracteres.` });
    }
  }

  let client;
  let transaccionIniciada = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transaccionIniciada = true;

    const hoyResult = await client.query(`SELECT (${FECHA_LOCAL_SQL})::text AS hoy`);
    const hoyLocal = hoyResult.rows[0]?.hoy;
    if (fechaRecepcion > hoyLocal) {
      await client.query("ROLLBACK");
      transaccionIniciada = false;
      return res.status(400).json({ error: "La fecha de recepción no puede ser futura. Esta pantalla registra alimentos que la fundación ya recibió." });
    }

    const idsInsumos = [...new Set(items.map((item) => item.insumo_id))];
    const insumosResult = await client.query(`
      SELECT id, nombre, unidad_medida
      FROM public.insumos
      WHERE id = ANY($1::uuid[]) AND activo = TRUE
      FOR SHARE
    `, [idsInsumos]);
    const insumosPorId = new Map(insumosResult.rows.map((insumo) => [insumo.id, insumo]));
    const faltante = idsInsumos.find((id) => !insumosPorId.has(id));
    if (faltante) {
      await client.query("ROLLBACK");
      transaccionIniciada = false;
      return res.status(400).json({ error: "Uno de los alimentos seleccionados no existe o está inactivo en PostgreSQL. Actualizá el inventario y volvé a intentar." });
    }

    // La autenticación real todavía no está implementada. Se deja registrado_por en NULL
    // en lugar de atribuir la operación a un perfil ficticio o confiar en un UUID del cliente.
    const donacionResult = await client.query(`
      INSERT INTO public.donaciones
        (nombre_donante, contacto_donante, fecha_recepcion, estado, observaciones, registrado_por,
         tipo_donacion, monto_dinero, moneda)
      VALUES ($1, $2, $3::date, 'recibida', $4, NULL, $5, $6, $7)
      RETURNING id
    `, [nombreDonante, contactoDonante || null, fechaRecepcion, observaciones || null,
        tipoDonacion, montoDinero, moneda]);
    const donacionId = donacionResult.rows[0].id;

    for (let indice = 0; indice < items.length; indice += 1) {
      const item = items[indice];
      const insumo = insumosPorId.get(item.insumo_id);
      const cantidad = Number(item.cantidad);
      const codigoInformado = typeof item.codigo_lote === "string" ? item.codigo_lote.trim() : "";
      const codigoLote = codigoInformado || `DON-${donacionId.slice(0, 8).toUpperCase()}-${String(indice + 1).padStart(2, "0")}`;
      const costo = item.costo_unitario === "" || item.costo_unitario === null || item.costo_unitario === undefined
        ? null
        : Number(item.costo_unitario);
      const observacionLote = typeof item.observaciones === "string" ? item.observaciones.trim() : "";

      const loteResult = await client.query(`
        INSERT INTO public.lotes_inventario
          (insumo_id, donacion_id, codigo_lote, fecha_recepcion, fecha_vencimiento,
           cantidad_original, cantidad_disponible, costo_unitario, observaciones)
        VALUES ($1, $2, $3, $4::date, $5::date, $6, 0, $7, $8)
        RETURNING id
      `, [
        item.insumo_id,
        donacionId,
        codigoLote,
        fechaRecepcion,
        item.fecha_vencimiento || null,
        cantidad,
        costo,
        observacionLote || null,
      ]);
      const loteId = loteResult.rows[0].id;

      await client.query(`
        INSERT INTO public.movimientos_inventario
          (lote_id, tipo_movimiento, variacion_cantidad, donacion_id, observaciones, creado_por)
        VALUES ($1, 'donacion', $2, $3, $4, NULL)
      `, [
        loteId,
        cantidad,
        donacionId,
        `Recepción de donación de ${nombreDonante}. Insumo: ${insumo.nombre}. Unidad: ${insumo.unidad_medida}.`,
      ]);
    }

    const respuestaDonacion = await client.query(`
      ${SELECT_DONACIONES}
      WHERE d.id = $1
      GROUP BY d.id
    `, [donacionId]);

    await client.query("COMMIT");
    transaccionIniciada = false;
    return res.status(201).json({
      mensaje: items.length
        ? (tipoDonacion === "mixta"
          ? "Donación mixta registrada en PostgreSQL. Se guardó el aporte monetario y se registraron los lotes y movimientos de inventario de los alimentos."
          : "Donación de alimentos registrada en PostgreSQL. Se registraron sus lotes y movimientos de inventario.")
        : "Donación monetaria registrada en PostgreSQL. No se modificó el inventario.",
      donacion: respuestaDonacion.rows[0],
    });
  } catch (error) {
    if (transaccionIniciada) {
      try { await client.query("ROLLBACK"); } catch (errorRollback) {
        console.error("No se pudo completar el rollback de la donación:", errorRollback.message);
      }
    }
    console.error("Error al registrar donación:", error.message);
    return res.status(500).json({ error: "No se pudo registrar la donación. La operación se revirtió para evitar ingresos parciales al inventario." });
  } finally {
    if (client) client.release();
  }
});

export default router;