export const seedDatabase = {
  inventory: [
    { id: 'inv-1', name: 'Arroz', category: 'Cereales', quantity: 18.5, unit: 'kg', minimum: 5, expiration: '2027-02-18', updatedAt: '2026-10-15' },
    { id: 'inv-2', name: 'Lentejas', category: 'Legumbres', quantity: 12, unit: 'kg', minimum: 4, expiration: '2027-04-20', updatedAt: '2026-10-12' },
    { id: 'inv-3', name: 'Zanahoria', category: 'Verduras', quantity: 7.2, unit: 'kg', minimum: 3, expiration: '2026-10-24', updatedAt: '2026-10-15' },
    { id: 'inv-4', name: 'Carne vacuna', category: 'Proteínas', quantity: 9.5, unit: 'kg', minimum: 4, expiration: '2026-10-19', updatedAt: '2026-10-16' },
    { id: 'inv-5', name: 'Fideos', category: 'Cereales', quantity: 8, unit: 'kg', minimum: 3, expiration: '2027-01-30', updatedAt: '2026-10-11' },
    { id: 'inv-6', name: 'Salsa de tomate', category: 'Conservas', quantity: 5.5, unit: 'kg', minimum: 2, expiration: '2027-05-10', updatedAt: '2026-10-13' },
    { id: 'inv-7', name: 'Aceite', category: 'Almacén', quantity: 1.5, unit: 'L', minimum: 2, expiration: '2027-07-01', updatedAt: '2026-10-08' },
    { id: 'inv-8', name: 'Envases para viandas', category: 'Descartables', quantity: 165, unit: 'unid.', minimum: 50, expiration: '', updatedAt: '2026-10-16' },
    { id: 'inv-9', name: 'Cebolla', category: 'Verduras', quantity: 3.4, unit: 'kg', minimum: 3, expiration: '2026-10-22', updatedAt: '2026-10-14' },
  ],
  recipes: [
    {
      id: 'rec-1', name: 'Guiso de lentejas', category: 'Plato principal', description: 'Un plato abundante y rendidor para compartir en comunidad.', prepMinutes: 60,
      ingredients: [
        { inventoryId: 'inv-2', quantity: 0.09 }, { inventoryId: 'inv-4', quantity: 0.07 },
        { inventoryId: 'inv-3', quantity: 0.04 }, { inventoryId: 'inv-9', quantity: 0.025 }, { inventoryId: 'inv-7', quantity: 0.008 },
      ],
    },
    {
      id: 'rec-2', name: 'Arroz con pollo', category: 'Plato principal', description: 'Receta práctica para preparar muchas porciones.', prepMinutes: 50,
      ingredients: [
        { inventoryId: 'inv-1', quantity: 0.08 }, { inventoryId: 'inv-4', quantity: 0.08 },
        { inventoryId: 'inv-3', quantity: 0.035 }, { inventoryId: 'inv-9', quantity: 0.02 }, { inventoryId: 'inv-7', quantity: 0.008 },
      ],
    },
    {
      id: 'rec-3', name: 'Fideos con salsa', category: 'Plato principal', description: 'Opción simple, económica y fácil de organizar.', prepMinutes: 35,
      ingredients: [
        { inventoryId: 'inv-5', quantity: 0.12 }, { inventoryId: 'inv-6', quantity: 0.07 },
        { inventoryId: 'inv-9', quantity: 0.02 }, { inventoryId: 'inv-7', quantity: 0.006 },
      ],
    },
  ],
  volunteers: [
    { id: 'vol-1', name: 'María González', role: 'Cocina', phone: '381 555-0101', email: 'maria@ejemplo.org', active: true },
    { id: 'vol-2', name: 'Juan Pérez', role: 'Empaque', phone: '381 555-0102', email: 'juan@ejemplo.org', active: true },
    { id: 'vol-3', name: 'Lucía Herrera', role: 'Reparto', phone: '381 555-0103', email: 'lucia@ejemplo.org', active: true },
    { id: 'vol-4', name: 'Diego Ramírez', role: 'Apoyo general', phone: '381 555-0104', email: 'diego@ejemplo.org', active: true },
  ],
  tasks: [
    { id: 'task-1', title: 'Preparar verduras y legumbres', area: 'Cocina', date: '2026-10-17', time: '08:30', volunteerId: 'vol-1', status: 'pending', attendance: 'confirmed', priority: 'Alta', notes: 'Revisar y lavar los ingredientes antes de comenzar.' },
    { id: 'task-2', title: 'Organizar envases y cubiertos', area: 'Empaque', date: '2026-10-17', time: '10:30', volunteerId: 'vol-2', status: 'pending', attendance: 'pending', priority: 'Media', notes: '' },
    { id: 'task-3', title: 'Coordinar entrega de viandas', area: 'Reparto', date: '2026-10-17', time: '12:00', volunteerId: 'vol-3', status: 'pending', attendance: 'confirmed', priority: 'Alta', notes: 'Confirmar punto de entrega con el equipo.' },
    { id: 'task-4', title: 'Diseñar flyer de la jornada', area: 'Comunicación', date: '2026-10-18', time: '16:00', volunteerId: 'vol-4', status: 'done', attendance: 'confirmed', priority: 'Baja', notes: 'Publicación para redes sociales.' },
  ],
  plans: [
    { id: 'plan-1', recipeId: 'rec-1', portions: 100, date: '2026-10-17', mealTime: 'Almuerzo', status: 'planned', leftovers: 0, createdAt: '2026-10-15' },
    { id: 'plan-2', recipeId: 'rec-3', portions: 60, date: '2026-10-20', mealTime: 'Almuerzo', status: 'planned', leftovers: 0, createdAt: '2026-10-16' },
  ],
};
