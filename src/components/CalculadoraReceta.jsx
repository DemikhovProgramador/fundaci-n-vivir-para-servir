
import { useEffect, useState } from "react";
import "./CalculadoraReceta.css";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3000";

function formatearNumero(valor) {
  return new Intl.NumberFormat("es-AR", {
    maximumFractionDigits: 3,
  }).format(Number(valor ?? 0));
}

function formatearFecha(fecha) {
  if (!fecha) return "Sin fecha registrada";

  const valor = new Date(fecha);

  if (Number.isNaN(valor.getTime())) {
    return "Fecha no disponible";
  }

  return valor.toLocaleDateString("es-AR", {
    timeZone: "UTC",
  });
}

export default function CalculadoraReceta() {
  const [recetas, setRecetas] = useState([]);
  const [recetaId, setRecetaId] = useState("");
  const [porciones, setPorciones] = useState("150");

  const [cargandoRecetas, setCargandoRecetas] = useState(true);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState("");
  const [resultado, setResultado] = useState(null);

  // Cargar las recetas desde el backend.
  useEffect(() => {
    let activo = true;

    async function cargarRecetas() {
      try {
        setError("");

        const respuesta = await fetch(`${API_URL}/api/recetas`);

        const datos = await respuesta.json().catch(() => null);

        if (!respuesta.ok) {
          throw new Error(
            datos?.mensaje ||
              datos?.error ||
              `Error HTTP ${respuesta.status}`
          );
        }

        const lista = Array.isArray(datos)
          ? datos
          : datos?.recetas ??
            datos?.datos?.recetas ??
            datos?.datos ??
            [];

        if (!Array.isArray(lista)) {
          throw new Error(
            "El backend no devolvió una lista válida de recetas."
          );
        }

        if (!activo) return;

        setRecetas(lista);

        if (lista.length > 0) {
          setRecetaId((actual) =>
            lista.some((receta) => String(receta.id) === actual)
              ? actual
              : String(lista[0].id)
          );
        } else {
          setError("No hay recetas registradas en el sistema.");
        }
      } catch (err) {
        if (activo) {
          setError(
            `No se pudieron cargar las recetas: ${err.message}`
          );
        }
      } finally {
        if (activo) setCargandoRecetas(false);
      }
    }

    cargarRecetas();

    return () => {
      activo = false;
    };
  }, []);

  // Solicitar al backend el cálculo de ingredientes.
  async function calcularIngredientes(evento) {
    evento.preventDefault();

    setError("");
    setResultado(null);

    const cantidad = Number(porciones);

    if (!recetaId) {
      setError("Seleccioná una receta.");
      return;
    }

    if (!Number.isSafeInteger(cantidad) || cantidad < 1) {
      setError(
        "Ingresá una cantidad de porciones que sea un entero positivo."
      );
      return;
    }

    setCalculando(true);

    try {
      const respuesta = await fetch(
        `${API_URL}/api/recetas/${recetaId}/calcular-insumos`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            porciones: cantidad,
          }),
        }
      );

      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(
          datos?.mensaje ||
            datos?.error ||
            `Error HTTP ${respuesta.status}`
        );
      }

      setResultado(datos);
    } catch (err) {
      setError(
        `No se pudo calcular la receta: ${err.message}`
      );
    } finally {
      setCalculando(false);
    }
  }

  const ingredientes = resultado?.ingredientes ?? [];
  const faltantes = resultado?.faltantes ?? [];

  return (
    <section className="calculadora-receta">
      <header className="calculadora-encabezado">
        <span className="calculadora-etiqueta">
          VIVIR PARA SERVIR
        </span>

        <h2>Recetario inteligente</h2>

        <p>
          Calculá las cantidades necesarias y comprobá
          si el inventario alcanza para preparar las viandas.
        </p>
      </header>

      <form
        className="calculadora-formulario"
        onSubmit={calcularIngredientes}
      >
        <div className="calculadora-campo">
          <label htmlFor="recetaId">
            Seleccioná una receta
          </label>

          <select
            id="recetaId"
            value={recetaId}
            onChange={(evento) => {
              setRecetaId(evento.target.value);
              setResultado(null);
              setError("");
            }}
            disabled={cargandoRecetas || recetas.length === 0}
          >
            {cargandoRecetas && (
              <option value="">Cargando recetas...</option>
            )}

            {!cargandoRecetas &&
              recetas.map((receta) => (
                <option key={receta.id} value={receta.id}>
                  {receta.nombre}
                </option>
              ))}
          </select>
        </div>

        <div className="calculadora-campo">
          <label htmlFor="porciones">
            Cantidad de viandas o porciones
          </label>

          <input
            id="porciones"
            type="number"
            min="1"
            step="1"
            value={porciones}
            onChange={(evento) => {
              setPorciones(evento.target.value);
              setResultado(null);
            }}
            required
          />
        </div>

        <button
          className="calculadora-boton"
          type="submit"
          disabled={
            cargandoRecetas ||
            calculando ||
            recetas.length === 0
          }
        >
          {calculando
            ? "Calculando ingredientes..."
            : "Calcular ingredientes"}
        </button>
      </form>

      {error && (
        <div className="calculadora-error" role="alert">
          {error}
        </div>
      )}

      {resultado && (
        <div className="calculadora-resultados">
          <div
            className={`calculadora-estado ${
              resultado.stock_suficiente
                ? "estado-correcto"
                : "estado-atencion"
            }`}
            role="status"
          >
            <h3>
              {resultado.stock_suficiente
                ? "Stock suficiente"
                : "Hay ingredientes faltantes"}
            </h3>

            <p>
              Receta: {resultado.receta?.nombre ?? "Receta"}
            </p>

            <p>
              Porciones solicitadas:{" "}
              {formatearNumero(resultado.porciones_solicitadas)}
            </p>

            <p>
              Ingredientes analizados: {ingredientes.length}
            </p>

            <p>
              Ingredientes con problemas: {faltantes.length}
            </p>
          </div>

          <h3>Ingredientes necesarios</h3>

          <div className="calculadora-tabla-contenedor">
            <table className="calculadora-tabla">
              <thead>
                <tr>
                  <th>Ingrediente</th>
                  <th>Necesario</th>
                  <th>Disponible</th>
                  <th>Faltante</th>
                  <th>Próximo vencimiento</th>
                </tr>
              </thead>

              <tbody>
                {ingredientes.map((ingrediente) => (
                  <tr key={ingrediente.insumo_id}>
                    <td>{ingrediente.insumo}</td>

                    <td>
                      {formatearNumero(
                        ingrediente.cantidad_necesaria
                      )}{" "}
                      {ingrediente.unidad_medida}
                    </td>

                    <td>
                      {formatearNumero(
                        ingrediente.cantidad_disponible
                      )}{" "}
                      {ingrediente.unidad_medida}
                    </td>

                    <td
                      className={
                        Number(ingrediente.cantidad_faltante) > 0
                          ? "calculadora-faltante"
                          : "calculadora-disponible"
                      }
                    >
                      {formatearNumero(
                        ingrediente.cantidad_faltante
                      )}{" "}
                      {ingrediente.unidad_medida}
                    </td>

                    <td>
                      {formatearFecha(
                        ingrediente.proximo_vencimiento
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {faltantes.length > 0 && (
            <div className="calculadora-lista-faltantes">
              <h3>Ingredientes que debemos conseguir</h3>

              <ul>
                {faltantes.map((ingrediente) => (
                  <li key={ingrediente.insumo_id}>
                    <strong>{ingrediente.insumo}:</strong>{" "}
                    faltan{" "}
                    {formatearNumero(
                      ingrediente.cantidad_faltante
                    )}{" "}
                    {ingrediente.unidad_medida}.
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="calculadora-nota">
            Cálculo informativo: esta consulta no reserva
            ni descuenta cantidades del inventario.
          </p>
        </div>
      )}
    </section>
  );
}