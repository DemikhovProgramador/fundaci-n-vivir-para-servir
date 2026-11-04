import { Router } from "express";
import { pool } from "../db.js";

const router = Router();
const FECHA_LOCAL_SQL = "(CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Tucuman')::date";

// GET /api/reportes/resumen
// Todos los indicadores provienen de PostgreSQL, no del almacenamiento local del navegador.
router.get("/resumen", async (_req, res) => {
  try {
    const [contexto, jornadas, tareas, voluntarios, donaciones, inventario, lotesVencidos, consumo, destinos, movimientos] = await Promise.all([
      pool.query(`
        SELECT current_database() AS base_datos,
               (CURRENT_TIMESTAMP AT TIME ZONE 'America/Argentina/Tucuman')::text AS generado_en
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE estado = 'planificada')::int AS planificadas,
          COUNT(*) FILTER (WHERE estado = 'en_preparacion')::int AS en_preparacion,
          COUNT(*) FILTER (WHERE estado = 'preparada')::int AS preparadas,
          COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas,
          COALESCE(SUM(porciones_planificadas) FILTER (WHERE estado IN ('planificada', 'en_preparacion')), 0)::int AS viandas_pendientes,
          COALESCE(SUM(porciones_preparadas) FILTER (WHERE estado = 'preparada'), 0)::int AS viandas_preparadas,
          COALESCE(SUM(porciones_sobrantes) FILTER (WHERE estado = 'preparada'), 0)::int AS viandas_sobrantes
        FROM public.jornadas_cocina
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE estado = 'pendiente')::int AS pendientes,
          COUNT(*) FILTER (WHERE estado = 'en_progreso')::int AS en_progreso,
          COUNT(*) FILTER (WHERE estado = 'completada')::int AS completadas,
          COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas
        FROM public.tareas
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE rol = 'voluntario')::int AS total,
          COUNT(*) FILTER (WHERE rol = 'voluntario' AND activo = TRUE)::int AS activos,
          COUNT(*) FILTER (WHERE rol = 'voluntario' AND activo = FALSE)::int AS inactivos
        FROM public.perfiles
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE estado = 'recibida')::int AS recibidas,
          COUNT(*) FILTER (WHERE estado = 'registrada')::int AS registradas,
          COUNT(*) FILTER (WHERE estado = 'cancelada')::int AS canceladas,
          COUNT(*) FILTER (WHERE estado = 'recibida' AND tipo_donacion = 'alimentos')::int AS de_alimentos,
          COUNT(*) FILTER (WHERE estado = 'recibida' AND tipo_donacion = 'dinero')::int AS de_dinero,
          COUNT(*) FILTER (WHERE estado = 'recibida' AND tipo_donacion = 'mixta')::int AS mixtas,
          COALESCE(SUM(monto_dinero) FILTER (WHERE estado = 'recibida' AND tipo_donacion IN ('dinero', 'mixta')), 0)::numeric(14,2) AS aporte_monetario_recibido
        FROM public.donaciones
      `),
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE activo = TRUE)::int AS insumos_activos,
          COUNT(*) FILTER (WHERE activo = TRUE AND cantidad_utilizable <= stock_minimo)::int AS stock_bajo_o_insuficiente
        FROM (
          SELECT
            i.id,
            i.activo,
            i.stock_minimo,
            COALESCE(SUM(l.cantidad_disponible), 0) AS cantidad_total,
            COALESCE(SUM(l.cantidad_disponible) FILTER (
              WHERE l.cantidad_disponible > 0
                AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${FECHA_LOCAL_SQL})
            ), 0) AS cantidad_utilizable
          FROM public.insumos i
          LEFT JOIN public.lotes_inventario l ON l.insumo_id = i.id
          GROUP BY i.id, i.activo, i.stock_minimo
        ) AS resumen_stock
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS lotes_vencidos_con_stock,
          COALESCE(SUM(l.cantidad_disponible), 0)::numeric(14,3) AS cantidad_vencida_total
        FROM public.lotes_inventario l
        JOIN public.insumos i ON i.id = l.insumo_id
        WHERE i.activo = TRUE
          AND l.cantidad_disponible > 0
          AND l.fecha_vencimiento < ${FECHA_LOCAL_SQL}
      `),
      pool.query(`
        SELECT
          i.nombre AS insumo,
          i.unidad_medida,
          COALESCE(SUM(ij.cantidad_utilizada_real), 0)::numeric(14,3) AS cantidad_total_utilizada,
          COUNT(DISTINCT j.id)::int AS jornadas
        FROM public.ingredientes_jornada ij
        JOIN public.jornadas_cocina j ON j.id = ij.jornada_id
        JOIN public.insumos i ON i.id = ij.insumo_id
        WHERE j.estado = 'preparada'
          AND ij.cantidad_utilizada_real IS NOT NULL
        GROUP BY i.id, i.nombre, i.unidad_medida
        HAVING COALESCE(SUM(ij.cantidad_utilizada_real), 0) > 0
        ORDER BY SUM(ij.cantidad_utilizada_real) DESC, i.nombre ASC
      `),
      pool.query(`
        SELECT
          sv.destino,
          COALESCE(SUM(sv.cantidad_porciones), 0)::int AS cantidad_viandas,
          COUNT(DISTINCT sv.jornada_id)::int AS jornadas
        FROM public.sobrantes_viandas sv
        JOIN public.jornadas_cocina j ON j.id = sv.jornada_id
        WHERE j.estado = 'preparada'
        GROUP BY sv.destino
        ORDER BY SUM(sv.cantidad_porciones) DESC, sv.destino ASC
      `),
      pool.query(`
        SELECT
          mi.id,
          mi.tipo_movimiento,
          mi.variacion_cantidad,
          mi.creado_en,
          mi.observaciones,
          i.nombre AS nombre_insumo,
          i.unidad_medida,
          l.codigo_lote,
          j.fecha_planificada::text AS fecha_jornada,
          r.nombre AS nombre_receta,
          d.nombre_donante
        FROM public.movimientos_inventario mi
        JOIN public.lotes_inventario l ON l.id = mi.lote_id
        JOIN public.insumos i ON i.id = l.insumo_id
        LEFT JOIN public.jornadas_cocina j ON j.id = mi.jornada_id
        LEFT JOIN public.recetas r ON r.id = j.receta_id
        LEFT JOIN public.donaciones d ON d.id = mi.donacion_id
        ORDER BY mi.creado_en DESC
        LIMIT 12
      `),
    ]);

    const stockBajo = await pool.query(`
      SELECT
        i.nombre,
        i.categoria,
        i.unidad_medida,
        i.stock_minimo,
        COALESCE(SUM(l.cantidad_disponible), 0)::numeric(14,3) AS cantidad_total,
        COALESCE(SUM(l.cantidad_disponible) FILTER (
          WHERE l.cantidad_disponible > 0
            AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${FECHA_LOCAL_SQL})
        ), 0)::numeric(14,3) AS cantidad_utilizable,
        COALESCE(SUM(l.cantidad_disponible) FILTER (
          WHERE l.cantidad_disponible > 0 AND l.fecha_vencimiento < ${FECHA_LOCAL_SQL}
        ), 0)::numeric(14,3) AS cantidad_vencida
      FROM public.insumos i
      LEFT JOIN public.lotes_inventario l ON l.insumo_id = i.id
      WHERE i.activo = TRUE
      GROUP BY i.id, i.nombre, i.categoria, i.unidad_medida, i.stock_minimo
      HAVING COALESCE(SUM(l.cantidad_disponible) FILTER (
        WHERE l.cantidad_disponible > 0
          AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${FECHA_LOCAL_SQL})
      ), 0) <= i.stock_minimo
      ORDER BY COALESCE(SUM(l.cantidad_disponible) FILTER (
        WHERE l.cantidad_disponible > 0
          AND (l.fecha_vencimiento IS NULL OR l.fecha_vencimiento >= ${FECHA_LOCAL_SQL})
      ), 0) ASC, i.nombre ASC
      LIMIT 15
    `);

    const resumen = {
      jornadas: jornadas.rows[0],
      tareas: tareas.rows[0],
      voluntarios: voluntarios.rows[0],
      donaciones: donaciones.rows[0],
      inventario: {
        ...inventario.rows[0],
        ...lotesVencidos.rows[0],
      },
    };

    res.json({
      estado: "ok",
      base_datos: contexto.rows[0]?.base_datos,
      generado_en: contexto.rows[0]?.generado_en,
      resumen,
      consumo_ingredientes: consumo.rows,
      destinos_sobrantes: destinos.rows,
      insumos_stock_bajo: stockBajo.rows,
      movimientos_recientes: movimientos.rows,
    });
  } catch (error) {
    console.error("Error al generar reportes desde PostgreSQL:", error.message);
    res.status(500).json({
      error: "No se pudieron generar los reportes desde PostgreSQL. Revisá la estructura de las tablas y la conexión de la base de datos.",
    });
  }
});

export default router;