# Guía breve para mostrar el prototipo al profesor

## Recorrido sugerido (5–8 minutos)

1. Abrir `http://localhost:5173/` e ingresar como **administrador**.
2. Mostrar el panel principal: viandas planificadas, alimentos, tareas, equipo y alertas de inventario.
3. Entrar a **Recetario** y mostrar que cada ingrediente tiene una cantidad por porción.
4. Entrar a **Planificación** y abrir una jornada. El sistema calcula las cantidades estimadas para el número de viandas.
5. Usar **Cerrar jornada**. Registrar, si corresponde, cuántas viandas terminadas sobraron y cuántos ingredientes quedaron sin utilizar. Confirmar el cierre.
6. Volver a **Inventario** y mostrar que las existencias se actualizaron con el consumo neto: se descuentan las cantidades previstas y se devuelven los sobrantes sin usar.
7. Entrar a **Tareas y voluntariado**. Crear una actividad, asignar responsable y confirmar asistencia.
8. Cerrar sesión y entrar como **voluntario**. Mostrar que el perfil de voluntario tiene acceso al panel y a las tareas, no al inventario ni a la configuración de recetas.
9. En **Reportes**, mostrar los indicadores y, si hace falta, descargar un respaldo JSON o restaurar los datos iniciales.

## Qué aclarar durante la presentación

- Es un prototipo académico local: no es necesario tener una cuenta Supabase para mostrarlo.
- La persistencia temporal usa el almacenamiento local del navegador; el servidor Vite entrega la aplicación, pero todavía no existe un backend conectado ni autenticación real.
- Los datos de ejemplo son ficticios.
- Como siguiente etapa se implementarán las tablas y relaciones en Supabase, autenticación, permisos por rol y políticas RLS.
