
import { Router } from "express";
import { pool } from "../db.js";

const router = Router();

const UUID_VALIDO =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/recetas/:id/calcular-insumos
// Calcula ingredientes y compara las cantidades con el stock disponible.
// Esta operación NO descuenta ni reserva inventario.
router.post("/:id/calcular-insumos", async (req, res) => {
  const { id } = req.params;
  const porciones = Number(req.body?.porciones);

  // Validar el identificador de la receta.
  if (!UUID_VALIDO.test(id)) {
    return res.status(400).json({
      error: "El identificador de la receta no es válido.",
    });
  }

  // La cantidad de viandas debe ser un entero positivo.
  if (!Number.isSafeInteger(porciones) || porciones <= 0) {
    return res.status(400).json({
      error: "La cantidad de viandas debe ser un entero positivo.",
    });
  }

  try {
    // Comprobar que la receta exista y esté activa.
    const resultadoReceta = await pool.query(
      `
        SELECT id, nombre, porciones_referencia
        FROM public.recetas
        WHERE id = $1
          AND activo = TRUE
      `,
      [id]
    );

    if (resultadoReceta.rowCount === 0) {
      return res.status(404).json({
        error: "No se encontró una receta activa con ese identificador.",
      });
    }

    const receta = resultadoReceta.rows[0];

    // Calcular lo necesario y consultar el stock real.
    const resultado = await pool.query(
      `
        SELECT
          i.id AS insumo_id,
          i.nombre AS insumo,
          i.unidad_medida,
          ir.cantidad_por_porcion,

          ROUND(
            ir.cantidad_por_porcion * $2::numeric,
            3
          ) AS cantidad_necesaria,

          COALESCE(
            e.cantidad_total,
            0
          ) AS cantidad_disponible,

          GREATEST(
            ROUND(
              ir.cantidad_por_porcion * $2::numeric,
              3
            ) - COALESCE(e.cantidad_total, 0),
            0
          ) AS cantidad_faltante,

          i.activo AS insumo_activo,
          e.proximo_vencimiento

        FROM public.ingredientes_receta AS ir

        INNER JOIN public.insumos AS i
          ON i.id = ir.insumo_id

        LEFT JOIN public.existencia_inventario AS e
          ON e.insumo_id = i.id

        WHERE ir.receta_id = $1

        ORDER BY i.nombre
      `,
      [id, porciones]
    );

    if (resultado.rowCount === 0) {
      return res.status(422).json({
        error: "La receta no tiene ingredientes registrados.",
      });
    }

    // Preparar el resultado para la API.
    const ingredientes = resultado.rows.map((fila) => {
      const necesaria = Number(fila.cantidad_necesaria);
      const disponible = Number(fila.cantidad_disponible);
      const faltante = Number(fila.cantidad_faltante);
      const activo = fila.insumo_activo === true;

      const alcanzaStock =
        activo && disponible >= necesaria;

      return {
        insumo_id: fila.insumo_id,
        insumo: fila.insumo,
        unidad_medida: fila.unidad_medida,
        cantidad_por_porcion:
          Number(fila.cantidad_por_porcion),
        cantidad_necesaria: necesaria,
        cantidad_disponible: disponible,
        cantidad_faltante: faltante,
        insumo_activo: activo,
        stock_suficiente: alcanzaStock,
        proximo_vencimiento: fila.proximo_vencimiento,
        motivo: !activo
          ? "El insumo está inactivo."
          : faltante > 0
            ? "Stock insuficiente."
            : null,
      };
    });

    const faltantes = ingredientes.filter(
      (ingrediente) => !ingrediente.stock_suficiente
    );

    // Devolver el cálculo, sin modificar la base de datos.
    return res.status(200).json({
      estado: "ok",
      receta: {
        id: receta.id,
        nombre: receta.nombre,
      },
      porciones_solicitadas: porciones,
      ingredientes_requeridos: ingredientes.length,
      stock_suficiente: faltantes.length === 0,
      cantidad_de_insumos_con_problemas: faltantes.length,
      ingredientes,
      faltantes,
      nota:
        "Cálculo informativo. Todavía no se reservó ni descontó inventario.",
    });
  } catch (error) {
    console.error(
      "Error al calcular los ingredientes:",
      error.message
    );

    return res.status(500).json({
      error: "No se pudieron calcular los ingredientes.",
    });
  }
});

export default router;