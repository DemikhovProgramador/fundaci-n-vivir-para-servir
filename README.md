# Vivir para Servir — Prototipo local

Aplicación web para el **Sistema de Gestión Operativa, Recetario Inteligente y Voluntariado** de la Fundación Vivir para Servir (Propuesta 1 del Seminario Integrador).

## Tecnologías

- React para construir las pantallas y componentes.
- Vite como servidor de desarrollo y herramienta de compilación.
- CSS propio y diseño adaptable a computadora y celular.
- `localStorage` como persistencia temporal de demostración.

> Esta versión es un prototipo local. No está conectada a Supabase, no tiene autenticación segura y no debe utilizarse para guardar información personal real. Los dos accesos de la pantalla inicial sirven para recorrer la interfaz.

## Requisitos

1. Instalar Node.js. Para una instalación nueva, usar una versión LTS compatible con Vite; consultar https://nodejs.org/ y https://vite.dev/guide/.
2. Tener Visual Studio Code instalado.
3. Contar con Internet durante la primera instalación de los paquetes de npm.

Comprobar la instalación abriendo una terminal y ejecutando:

```bash
node -v
npm -v
```

## Cómo abrirlo en Visual Studio Code

1. Descargar y descomprimir la carpeta `vivir-para-servir`.
2. En Visual Studio Code, elegir **Archivo → Abrir carpeta...** y seleccionar la carpeta `vivir-para-servir`.
3. Abrir **Terminal → Nueva terminal**.
4. Verificar que la terminal esté situada en la carpeta del proyecto. Si no lo está, ingresar:

   ```bash
   cd vivir-para-servir
   ```

   Si abriste la carpeta desde VS Code, normalmente este paso no hace falta.

5. Instalar los paquetes (solo la primera vez):

   ```bash
   npm install
   ```

6. Iniciar el servidor local:

   ```bash
   npm run dev
   ```

7. La terminal mostrará una dirección local, normalmente `http://localhost:5173/`. Abrir esa dirección en Chrome o en otro navegador moderno.
8. En la pantalla inicial, elegir **Entrar como administrador** para mostrar todos los módulos o **Entrar como voluntario** para ver el panel y las tareas asignadas.
9. Para detener el servidor, volver a la terminal y presionar `Ctrl + C`.

## Funcionalidades disponibles en la demo

- **Panel principal:** indicadores de viandas, productos, tareas y personas del equipo.
- **Planificación:** crear una jornada con receta, fecha, momento y cantidad de viandas.
- **Cálculo de insumos:** calcular las cantidades de ingredientes según el número de porciones.
- **Cierre de jornada:** verificar existencias, descontar los ingredientes previstos y registrar el número de sobrantes.
- **Recetario:** crear, editar y eliminar recetas con ingredientes por porción.
- **Inventario:** registrar productos, ver stock mínimo y vencimientos, ajustar existencias y exportar una tabla CSV.
- **Tareas:** asignar actividades, responsables, fechas, prioridades y confirmación de asistencia.
- **Voluntarios:** registrar integrantes y activar/desactivar su participación.
- **Reportes:** ver indicadores y descargar una copia JSON de los datos.

## Dónde se guardan los datos

La capa de persistencia temporal está en `src/services/localDb.js`. Los datos se guardan en `localStorage` del navegador y se identifican con las claves `vivir-para-servir-local-db-v1` y `vivir-para-servir-session-v1`.

Los datos no se comparten entre computadoras, perfiles de navegador ni navegadores distintos. En Reportes se puede exportar un respaldo JSON y volver a los datos iniciales de la demo.

## Comprobar la compilación

```bash
npm run build
```

Vite genera la versión de producción dentro de la carpeta `dist/`.

## Próxima etapa: Supabase

El modelo preliminar de tablas está documentado en `docs/modelo-de-datos.md`. Antes de publicar la aplicación se deberá configurar Supabase, definir claves y relaciones, implementar acceso con Supabase Auth y políticas de Row Level Security (RLS). No colocar una `service_role key` en el código del navegador.
