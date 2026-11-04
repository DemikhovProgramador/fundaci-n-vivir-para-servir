# Modelo de datos preliminar — Vivir para Servir

Este modelo orienta la futura migración a Supabase/PostgreSQL. La versión actual usa `localStorage`, no ejecuta estas tablas y no se conecta a un servidor de base de datos.

## Entidades propuestas

### `profiles`
Perfil asociado a la identidad de Supabase Auth.
- `id`: UUID, clave primaria y referencia a `auth.users.id`.
- `full_name`: nombre para mostrar.
- `role`: `admin` o `volunteer`.
- `phone`, `active`, `created_at`.

### `inventory_items`
Catálogo de ingredientes e insumos.
- `id`: UUID, clave primaria.
- `name`, `category`, `unit`.
- `quantity`: cantidad disponible.
- `minimum_stock`: umbral de alerta.
- `expiration_date`: fecha opcional.
- `updated_at`.

### `recipes`
Recetas que se usan para planificar la producción.
- `id`: UUID, clave primaria.
- `name`, `description`, `category`, `prep_minutes`.
- `created_by`: referencia a `profiles.id`.
- `created_at`, `updated_at`.

### `recipe_ingredients`
Relación muchos-a-muchos entre recetas e insumos. La cantidad representa la necesidad para **una porción**.
- `id`: UUID, clave primaria.
- `recipe_id`: referencia a `recipes.id`.
- `inventory_item_id`: referencia a `inventory_items.id`.
- `quantity_per_portion`: cantidad de ese ingrediente por porción.

### `meal_plans`
Jornadas de cocina planificadas.
- `id`: UUID, clave primaria.
- `recipe_id`: referencia a `recipes.id`.
- `planned_date`, `meal_time`, `portions`.
- `status`: `planned` o `prepared`.
- `leftovers`: cantidad de viandas sobrantes.
- `created_by`, `closed_at`, `created_at`.

### `inventory_movements`
Historial auditable de entradas y salidas de insumos.
- `id`: UUID, clave primaria.
- `inventory_item_id`: referencia a `inventory_items.id`.
- `meal_plan_id`: referencia opcional a `meal_plans.id`.
- `movement_type`: `donation`, `usage`, `adjustment` o `leftover_return`.
- `quantity`: cantidad del movimiento, con signo o con tipo explícito según la decisión de implementación.
- `notes`, `created_by`, `created_at`.

### `tasks`
Tareas operativas y su asignación.
- `id`: UUID, clave primaria.
- `title`, `area`, `notes`, `task_date`, `task_time`, `priority`, `status`.
- `assigned_to`: referencia a `profiles.id`.
- `attendance_status`: `pending` o `confirmed`.
- `created_by`, `created_at`, `updated_at`.

## Reglas de negocio que se deben validar en el backend

1. No permitir cantidades ni mínimos negativos.
2. No cerrar una jornada si no hay stock suficiente para los ingredientes calculados.
3. Registrar cada descuento de insumos como un movimiento, además de actualizar la existencia.
4. No permitir que un voluntario se asigne tareas a sí mismo si esa acción es exclusiva del administrador.
5. Un voluntario solo debe ver o modificar los campos y tareas que sus políticas de RLS permitan.
6. Proteger la información de contacto de los voluntarios mediante autenticación y permisos apropiados.
7. Definir de forma consistente unidades para evitar convertir accidentalmente kg, gramos, litros y unidades.

## Decisiones aún pendientes

- Si los sobrantes son viandas terminadas o ingredientes sin usar. El prototipo registra sobrantes de viandas, pero no los vuelve a sumar al inventario de ingredientes.
- Si se permitirá editar una receta que ya tiene jornadas históricas. Para auditoría, conviene guardar una copia de ingredientes/cantidades en el momento de cerrar la jornada.
- Si el sistema administrará una sola sede o varias sedes.
