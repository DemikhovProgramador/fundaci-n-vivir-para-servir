import { useEffect, useMemo, useState, useRef } from 'react';
import {
  HeartHandshake, LayoutDashboard, ChefHat, Package, CalendarDays, ClipboardList,
  Users, ChartNoAxesCombined, Search, Bell, ChevronDown, ChevronRight, Plus,
  ArrowUpRight, ArrowDownRight, Clock3, CheckCircle2, AlertTriangle, CalendarCheck,
  Utensils, CookingPot, Boxes, ClipboardCheck, HandHeart, LogOut, ShieldCheck,
  Leaf, Menu, X, SearchX, CircleHelp, MoreHorizontal, Pencil, Trash2, Check,
  PackagePlus, UserRoundPlus, ClipboardPenLine, Sparkles, RotateCcw, Download,
  Mail, Phone, MapPin, Sprout, ArrowRight, CalendarClock, CircleCheck, CircleAlert,
} from 'lucide-react';
import { loadDatabase, saveDatabase, resetDatabase, createId } from './services/localDb.js';
import CalculadoraReceta from './components/CalculadoraReceta.jsx';
import { jsPDF } from 'jspdf';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Panel principal', icon: LayoutDashboard },
  { id: 'planning', label: 'Planificación', icon: CalendarDays },
  { id: 'recipes', label: 'Recetario', icon: ChefHat },
  { id: 'inventory', label: 'Inventario', icon: Package },
  { id: 'donations', label: 'Donaciones', icon: HandHeart },
  { id: 'tasks', label: 'Tareas', icon: ClipboardList },
  { id: 'volunteers', label: 'Voluntarios', icon: Users },
  { id: 'reports', label: 'Reportes', icon: ChartNoAxesCombined },
];

const todayISO = () => { const now = new Date(); return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const formatNumber = (value) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 }).format(Number(value) || 0);
const formatearCantidad = (value) => new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(value) || 0);
const formatearPesos = (value) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
// Un costo vacío, nulo, no numérico o igual a cero se muestra como no informado.
// En este módulo, cero no se usa para indicar que un alimento tiene valor de referencia cero.
const tieneCostoUnitarioInformado = (item) => {
  if (item?.costo_unitario === null || item?.costo_unitario === undefined || item?.costo_unitario === '') return false;
  const costo = Number(item.costo_unitario);
  return Number.isFinite(costo) && costo > 0;
};
const calcularValorReferencialLote = (item) => tieneCostoUnitarioInformado(item) && Number.isFinite(Number(item.cantidad_original))
  ? Number(item.cantidad_original) * Number(item.costo_unitario)
  : null;

// Acepta importes escritos con la convención argentina:
// 1500, 1.500, 1500,50, 1.500,50 o 1500.50.
// Si hay coma, se considera separador decimal; puntos previos son miles.
function parseNumeroArgentino(valor) {
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : NaN;
  const texto = String(valor ?? '').trim().replace(/\s+/g, '');
  if (!texto || !/^\d+(?:[.,]\d+)*$/.test(texto)) return NaN;

  if (texto.includes(',')) {
    if ((texto.match(/,/g) || []).length !== 1) return NaN;
    const [enteroOriginal, decimales] = texto.split(',');
    const entero = enteroOriginal.replace(/\./g, '');
    if (!/^\d+$/.test(entero) || !/^\d{1,2}$/.test(decimales)) return NaN;
    return Number(`${entero}.${decimales}`);
  }

  // 1.500, 12.000, 1.500.000 se interpretan como separadores de miles.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(texto)) {
    return Number(texto.replace(/\./g, ''));
  }

  // También permite punto decimal sin separador de miles: 1500.50 o 1.5.
  if (/^\d+(?:\.\d{1,2})?$/.test(texto)) return Number(texto);
  return NaN;
}

const formatDate = (value) => value ? new Intl.DateTimeFormat('es-AR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Sin fecha';
const daysUntil = (value) => value ? Math.ceil((new Date(`${value}T12:00:00Z`).getTime() - new Date(`${todayISO()}T12:00:00Z`).getTime()) / 86400000) : Infinity;
const personName = (db, id) => db.volunteers.find((v) => v.id === id)?.name || 'Sin asignar';
const recipeName = (db, id) => db.recipes.find((r) => r.id === id)?.name || 'Receta eliminada';
const isLowStock = (item) => Number(item.usableQuantity ?? item.quantity) <= Number(item.minimum);
const isExpiringSoon = (item) => item.expiration && daysUntil(item.expiration) <= 7 && daysUntil(item.expiration) >= 0;

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';
const AUTH_TOKEN_KEY = 'vps_auth_token';

// Capa de compatibilidad: agrega el token a todas las llamadas a nuestra API,
// incluidas las que realiza CalculadoraReceta.jsx, que es un componente separado.
// La autorización real se verifica siempre en Express; ocultar botones no alcanza.
if (typeof window !== 'undefined' && !window.__vpsAuthFetchInstalled) {
  const fetchOriginal = window.fetch.bind(window);
  window.__vpsAuthFetchInstalled = true;
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || String(input);
    if (!url.startsWith(API_URL)) return fetchOriginal(input, init);

    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init.headers || {}).forEach((value, key) => headers.set(key, value));
    const token = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
    if (token) headers.set('Authorization', `Bearer ${token}`);

    return fetchOriginal(input, { ...init, headers }).then((response) => {
      if (response.status === 401 &&
          !url.includes('/api/auth/login') &&
          !url.includes('/api/auth/me')) {
        window.dispatchEvent(new Event('vps-auth-expired'));
      }
      return response;
    });
  };
}

const DESTINOS_SOBRANTES = [
  { value: 'conservacion_refrigerada', label: 'Conservación refrigerada' },
  { value: 'redistribucion', label: 'Redistribución / entrega' },
  { value: 'donacion', label: 'Donación a otra organización' },
  { value: 'consumo_interno', label: 'Consumo interno (equipo/voluntarios)' },
  { value: 'descarte', label: 'Descarte' },
  { value: 'otro', label: 'Otro destino' },
];
const etiquetaDestinoSobrantes = (valor) =>
  DESTINOS_SOBRANTES.find((item) => item.value === valor)?.label || 'Destino no identificado';

function normalizarJornadaAPI(jornada) {
  const estado = {
    planificada: 'planned',
    en_preparacion: 'in_progress',
    preparada: 'prepared',
    cancelada: 'cancelled',
  }[jornada.estado] || jornada.estado;
  const porcionesPlanificadas = Number(jornada.porciones_planificadas || 0);

  return {
    id: String(jornada.id),
    recipeId: String(jornada.receta_id),
    recipeName: jornada.nombre_receta || 'Receta no disponible',
    description: jornada.descripcion_receta || '',
    prepMinutes: Number(jornada.minutos_preparacion || 0),
    portions: porcionesPlanificadas,
    preparedPortions: jornada.porciones_preparadas === null || jornada.porciones_preparadas === undefined
      ? null
      : Number(jornada.porciones_preparadas),
    leftovers: Number(jornada.porciones_sobrantes || 0),
    leftoverDestinations: (Array.isArray(jornada.destinos_sobrantes) ? jornada.destinos_sobrantes : []).map((item) => ({
      id: String(item.id || ''),
      portions: Number(item.cantidad_porciones || 0),
      destination: item.destino || '',
      observations: item.observaciones || '',
      createdAt: item.creado_en || null,
    })),
    date: String(jornada.fecha_planificada || '').slice(0, 10),
    mealTime: jornada.momento_comida || 'Almuerzo',
    status: estado,
    notes: jornada.observaciones || '',
    createdAt: jornada.creado_en || null,
    closedAt: jornada.cerrada_en || null,
    ingredients: (Array.isArray(jornada.ingredientes) ? jornada.ingredientes : []).map((ingredient) => {
      const quantityPerPortion = Number(ingredient.cantidad_por_porcion_copiada || 0);
      const quantity = Number(ingredient.cantidad_planificada || 0);
      const expectedQuantity = Math.round(quantityPerPortion * porcionesPlanificadas * 1000) / 1000;
      return {
        inventoryId: String(ingredient.insumo_id),
        name: ingredient.nombre_insumo || 'Insumo no disponible',
        unit: ingredient.unidad_medida || '',
        quantityPerPortion,
        quantity,
        expectedQuantity,
        quantityMismatch: Math.abs(expectedQuantity - quantity) > 0.0005,
        quantityUsed: ingredient.cantidad_utilizada_real === null || ingredient.cantidad_utilizada_real === undefined
          ? null
          : Number(ingredient.cantidad_utilizada_real),
        quantityReturned: Number(ingredient.cantidad_devuelta || 0),
        notes: ingredient.observaciones || null,
      };
    }),
  };
}


function normalizarTareaAPI(tarea) {
  const estados = {
    pendiente: 'pending',
    en_progreso: 'in_progress',
    completada: 'done',
    cancelada: 'cancelled',
  };
  const asistencias = {
    pendiente: 'pending',
    confirmada: 'confirmed',
    asistio: 'attended',
    ausente: 'absent',
  };
  const asignaciones = Array.isArray(tarea.asignaciones) ? tarea.asignaciones : [];
  const asignacion = asignaciones[0] || null;
  const prioridad = String(tarea.prioridad || 'media');
  return {
    id: String(tarea.id),
    title: tarea.titulo || 'Tarea sin título',
    area: tarea.area || 'Apoyo general',
    notes: tarea.observaciones || '',
    date: String(tarea.fecha_tarea || '').slice(0, 10),
    time: String(tarea.hora_tarea || '').slice(0, 5),
    priority: prioridad.charAt(0).toUpperCase() + prioridad.slice(1),
    status: estados[tarea.estado] || 'pending',
    volunteerId: asignacion?.perfil_id ? String(asignacion.perfil_id) : '',
    volunteerName: asignacion?.nombre_completo || 'Sin asignar',
    attendance: asistencias[asignacion?.estado_asistencia] || 'pending',
    assignmentId: asignacion?.id || null,
    jornadaId: tarea.jornada_id || null,
    createdAt: tarea.creado_en || null,
    updatedAt: tarea.actualizado_en || null,
  };
}

function normalizarVoluntarioAPI(perfil) {
  return {
    id: String(perfil.id),
    name: perfil.nombre_completo || 'Sin nombre',
    role: perfil.area_principal || 'Apoyo general',
    phone: perfil.telefono || '',
    email: perfil.correo_electronico || '',
    active: perfil.activo === true,
    databaseRole: perfil.rol || 'voluntario',
    pendingTasks: Number(perfil.tareas_pendientes || 0),
    assignedTasks: Number(perfil.tareas_asignadas || 0),
  };
}


function normalizarInsumoAPI(item) {
  const vencimiento = item.proximo_vencimiento_utilizable ?? item.proximo_vencimiento_lote ?? item.proximo_vencimiento ?? item.fecha_vencimiento ?? item.expiration ?? null;
  const actualizado = item.actualizado_en ?? item.updatedAt ?? null;
  return {
    id: String(item.insumo_id ?? item.id ?? ''),
    name: item.nombre ?? item.name ?? '',
    category: item.categoria ?? item.category ?? 'General',
    unit: item.unidad_medida ?? item.unit ?? '',
    quantity: Number(item.cantidad_total ?? item.quantity ?? 0),
    usableQuantity: Number(item.cantidad_utilizable ?? item.usableQuantity ?? item.cantidad_total ?? item.quantity ?? 0),
    expiredQuantity: Number(item.cantidad_vencida ?? item.expiredQuantity ?? 0),
    expiringTodayQuantity: Number(item.cantidad_vence_hoy ?? 0),
    minimum: Number(item.stock_minimo ?? item.minimum ?? 0),
    expiration: vencimiento ? String(vencimiento).slice(0, 10) : '',
    updatedAt: actualizado ? String(actualizado).slice(0, 10) : '',
    active: item.activo ?? true,
  };
}

async function leerRespuestaAPI(respuesta) {
  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error(datos?.error || datos?.mensaje || `Error HTTP ${respuesta.status}`);
  }
  return datos;
}

function IconButton({ icon: Icon, label, onClick, subtle = false, danger = false, disabled = false }) {
  return <button type="button" className={`icon-button ${subtle ? 'subtle' : ''} ${danger ? 'danger' : ''}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}><Icon size={17} /></button>;
}

function Button({ children, onClick, type = 'button', variant = 'primary', icon: Icon, disabled = false, className = '' }) {
  return <button type={type} className={`button ${variant} ${className}`} onClick={onClick} disabled={disabled}>{Icon && <Icon size={16} />}{children}</button>;
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`status-pill ${tone}`}><span className="status-dot" />{children}</span>;
}

function Modal({ title, description, onClose, children, size = 'medium' }) {
  useEffect(() => {
    const onKeyDown = (event) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`modal-card ${size}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-header"><div><h2>{title}</h2>{description && <p>{description}</p>}</div><IconButton icon={X} label="Cerrar" onClick={onClose} subtle /></div>
      {children}
    </section>
  </div>;
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const ingresar = async (event) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const respuesta = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        throw new Error(datos?.error || 'No se pudo iniciar sesión. Revisá el correo y la contraseña.');
      }
      if (!datos?.token || !datos?.usuario) {
        throw new Error('El backend no devolvió una sesión válida.');
      }
      onLogin(datos);
    } catch (err) {
      setError(err.message || 'No se pudo conectar con el servidor de autenticación.');
    } finally {
      setSubmitting(false);
    }
  };

  return <main className="login-screen">
    <section className="login-visual">
      <div className="login-brand"><span className="brand-symbol"><HeartHandshake size={28} /></span><span>Vivir para Servir</span></div>
      <div className="login-message">
        <span className="eyebrow light"><span className="eyebrow-line" /> JUNTOS, CADA JORNADA CUENTA</span>
        <h1>Servir con amor.<br /><em>Organizar para llegar más lejos.</em></h1>
        <p>Una herramienta para coordinar cada alimento, cada tarea y cada persona que hace posible ayudar.</p>
        <div className="login-quote"><span className="quote-mark">“</span><div><strong>Pequeñas acciones, grandes cambios.</strong><span>Gestión solidaria de la Fundación Vivir para Servir</span></div></div>
      </div>
      <div className="login-visual-footer"><span><Leaf size={15} /> Compromiso · Comunidad · Servicio</span><span>Autenticación local</span></div>
      <div className="decor-circle decor-one" /><div className="decor-circle decor-two" />
    </section>
    <section className="login-panel">
      <div className="login-form-wrap">
        <div className="mobile-login-brand"><span className="brand-symbol"><HeartHandshake size={25} /></span><span>Vivir para Servir</span></div>
        <div className="login-intro"><span className="eyebrow">ACCESO SEGURO</span><h2>Ingresá al sistema</h2><p>Ingresá el correo y la contraseña asociados a tu perfil. El sistema validará tu identidad y tu rol en PostgreSQL.</p></div>
        <form className="form-grid" onSubmit={ingresar}>
          <label className="field wide"><span>Correo electrónico</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nombre@ejemplo.com" required maxLength={254} /></label>
          <label className="field wide"><span>Contraseña</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={1} maxLength={200} /></label>
          {error && <div className="calculadora-error wide" role="alert" aria-live="polite"><strong>No se pudo ingresar:</strong> {error}</div>}
          <div className="form-actions wide"><Button type="submit" icon={ShieldCheck} disabled={submitting}>{submitting ? 'Validando credenciales...' : 'Ingresar'}</Button></div>
        </form>
        <div className="demo-info"><ShieldCheck size={16} /><p><strong>Acceso protegido:</strong> el backend comprueba las credenciales, el estado de la cuenta y los permisos en cada operación. Si aún no configuraste una cuenta, seguí las instrucciones de creación de credenciales locales.</p></div>
        <div className="login-bottom"><span>Fundación Vivir para Servir</span><span>Seminario Integrador · Sistema académico</span></div>
      </div>
    </section>
  </main>;
}
function Sidebar({ page, setPage, user, onLogout, mobileOpen, setMobileOpen }) {
  const navItems = user.role === 'admin' ? NAV_ITEMS : NAV_ITEMS.filter((item) => ['dashboard', 'tasks'].includes(item.id));
  return <>
    {mobileOpen && <button className="mobile-scrim" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
      <div className="sidebar-brand"><span className="brand-symbol"><HeartHandshake size={24} /></span><div><strong>Vivir para Servir</strong><small>Gestión solidaria</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><X size={20} /></button></div>
      <div className="workspace-label">ESPACIO DE TRABAJO</div>
      <nav className="main-nav" aria-label="Navegación principal">
        {navItems.map(({ id, label, icon: Icon }) => <button key={id} className={`nav-link ${page === id ? 'active' : ''}`} onClick={() => { setPage(id); setMobileOpen(false); }}><Icon size={19} /><span>{label}</span>{id === 'inventory' && <span className="nav-count">!</span>}{page === id && <span className="nav-active-mark" />}</button>)}
      </nav>
      {user.role === 'admin' && <div className="sidebar-help"><div className="help-art"><HeartHandshake size={23} /></div><strong>Una misión compartida</strong><p>Cada persona y cada alimento suma.</p><button onClick={() => setPage('reports')}>Ver resumen <ArrowRight size={14} /></button></div>}
      <div className="sidebar-bottom"><span className="local-indicator"><span /> Sistema local activo</span><button className="sidebar-user" onClick={onLogout}><span className="avatar avatar-green">{inicialesUsuarioVisible(user)}</span><span className="sidebar-user-info"><strong>{etiquetaUsuarioVisible(user)}</strong></span><LogOut size={16} /></button></div>
    </aside>
  </>;
}

function Topbar({ title, subtitle, user, onToggleMenu, search, setSearch }) {
  return <header className="topbar">
    <button className="mobile-menu-button" onClick={onToggleMenu} aria-label="Abrir menú"><Menu size={22} /></button>
    <div className="topbar-heading"><div className="breadcrumb">Fundación <ChevronRight size={13} /> <span>{title}</span></div><h1>{title}</h1><p>{subtitle}</p></div>
    <div className="topbar-actions"><label className="search-field"><Search size={17} /><input aria-label="Buscar en el módulo" placeholder="Buscar en el módulo..." value={search} onChange={(event) => setSearch(event.target.value)} /><kbd>⌘ K</kbd></label><button className="top-icon-button" title="Avisos" onClick={() => window.alert('No hay nuevos avisos.')}><Bell size={19} /><span className="notification-dot" /></button><div className="topbar-user"><span className="avatar avatar-green">{inicialesUsuarioVisible(user)}</span><div><strong>{etiquetaUsuarioVisible(user)}</strong></div><ChevronDown size={15} /></div></div>
  </header>;
}

function PageHeader({ eyebrow, title, description, action }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action}</div>;
}

function MetricCard({ title, value, note, icon: Icon, tone = 'green', trend }) {
  return <article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={21} /></div><div className="metric-label">{title}</div><div className="metric-value-row"><strong>{value}</strong>{trend && <span className={`metric-trend ${trend.positive ? 'positive' : 'warning'}`}>{trend.positive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{trend.text}</span>}</div><p>{note}</p></article>;
}

function EmptyState({ icon: Icon = SearchX, title, description, action }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={24} /></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}

function Dashboard({ db, user, setPage, setToast, search, inventory, plans, inventoryAlerts, inventoryAlertsError }) {
  const inventarioActual = inventory ?? db.inventory;
  const planesActuales = plans ?? db.plans;
  const nombrePlan = (plan) => plan.recipeName || recipeName(db, plan.recipeId);
  const alertGroups = inventoryAlerts ? [
    { key: 'vencidos', title: 'Insumos vencidos', tone: 'rose', icon: AlertTriangle, rows: inventoryAlerts.vencidos || [] },
    { key: 'vence_hoy', title: 'Vence hoy', tone: 'amber', icon: CalendarClock, rows: inventoryAlerts.vence_hoy || [] },
    { key: 'proximos_a_vencer', title: 'Próximos a vencer (7 días)', tone: 'amber', icon: Clock3, rows: inventoryAlerts.proximos_a_vencer || [] },
    { key: 'stock_bajo_o_insuficiente', title: 'Stock bajo o insuficiente', tone: 'blue', icon: Boxes, rows: inventoryAlerts.stock_bajo_o_insuficiente || [] },
  ] : [];
  const upcomingPlans = [...planesActuales].filter((plan) => plan.status === 'planned' || plan.status === 'in_progress').sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
  const tasks = db.tasks.filter((task) => user.role === 'admin' || task.volunteerId === user.volunteerId).filter((task) => task.status !== 'done').sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)).slice(0, 4);
  const plannedPortions = planesActuales.filter((plan) => plan.status === 'planned' || plan.status === 'in_progress').reduce((sum, plan) => sum + Number(plan.portions), 0);
  const doneTasks = db.tasks.filter((task) => task.status === 'done').length;
  const displayPlans = upcomingPlans.filter((plan) => `${nombrePlan(plan)} ${plan.date} ${plan.mealTime}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="dashboard-page page-content">
    <div className="welcome-banner"><div className="welcome-copy"><span className="eyebrow light"><Sparkles size={13} /> RESUMEN DE LA FUNDACIÓN</span><h2>Hola, {user?.name?.trim() || 'Usuario'} <span className="wave">✳</span></h2><p>Lo que organizamos hoy se transforma en ayuda para muchas familias.</p><div className="welcome-meta"><span><CalendarDays size={15} /> {new Intl.DateTimeFormat('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</span><span><span className="welcome-dot" /> Jornada en preparación</span></div></div><div className="welcome-art"><div className="welcome-art-circle"><CookingPot size={50} strokeWidth={1.3} /></div><div className="floating-leaf leaf-a"><Leaf size={24} /></div><div className="floating-leaf leaf-b"><Sprout size={20} /></div><div className="welcome-art-caption">Cocinar <span>·</span> Compartir <span>·</span> Servir</div></div></div>
    <div className="section-heading"><div><h3>La fundación en números</h3><p>Una vista rápida para organizar la próxima jornada.</p></div><span className="section-date"><span className="live-dot" /> Jornadas sincronizadas</span></div>
    <div className="metrics-grid"><MetricCard title="Viandas planificadas" value={formatNumber(plannedPortions)} note="Porciones aún por preparar" icon={Utensils} tone="green" trend={{ positive: true, text: `${planesActuales.filter((p) => p.status === 'planned' || p.status === 'in_progress').length} jornadas` }} /><MetricCard title="Ingredientes registrados" value={inventarioActual.length} note="Productos en PostgreSQL" icon={Boxes} tone="blue" trend={{ positive: true, text: 'Stock local' }} /><MetricCard title="Tareas completadas" value={`${doneTasks}/${db.tasks.length}`} note="Actividades registradas" icon={ClipboardCheck} tone="orange" trend={{ positive: doneTasks > 0, text: `${db.tasks.length ? Math.round(doneTasks / db.tasks.length * 100) : 0}%` }} /><MetricCard title="Voluntarios activos" value={db.volunteers.filter((v) => v.active).length} note="Personas disponibles en el equipo" icon={HandHeart} tone="purple" trend={{ positive: true, text: 'En equipo' }} /></div>
    <div className="dashboard-grid">
      <section className="surface-card plans-widget"><div className="card-heading"><div><span className="eyebrow">COCINA Y PRODUCCIÓN</span><h3>Próximas jornadas</h3></div>{user.role === 'admin' && <button className="text-link" onClick={() => setPage('planning')}>Ver planificación <ArrowRight size={15} /></button>}</div>
        {displayPlans.length ? <div className="plan-list">{displayPlans.map((plan, index) => <div className="mini-plan" key={plan.id}><span className={`plan-date ${index === 0 ? 'highlight' : ''}`}><strong>{new Date(`${plan.date}T12:00:00Z`).getUTCDate()}</strong><small>{new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${plan.date}T12:00:00Z`)).replace('.', '')}</small></span><div className="mini-plan-info"><strong>{nombrePlan(plan)}</strong><small><Clock3 size={13} /> {plan.mealTime} · {plan.portions} porciones</small></div><StatusPill tone={plan.status === 'planned' ? 'blue' : plan.status === 'in_progress' ? 'amber' : plan.status === 'cancelled' ? 'rose' : 'green'}>{plan.status === 'planned' ? 'Planificada' : plan.status === 'in_progress' ? 'En preparación' : plan.status === 'cancelled' ? 'Cancelada' : 'Preparada'}</StatusPill><ChevronRight className="mini-chevron" size={17} /></div>)}</div> : <EmptyState
          title={user.role === 'admin' ? 'No hay jornadas próximas' : 'La planificación está a cargo de administración'}
          description={user.role === 'admin' ? 'Creá una planificación para organizar la próxima cocina.' : 'Desde tu perfil de voluntario podés consultar y confirmar las tareas que te asignaron.'}
          action={user.role === 'admin' ? <Button onClick={() => setPage('planning')} icon={Plus}>Planificar jornada</Button> : null}
        />}
        {user.role === 'admin' && <button className="widget-footer" onClick={() => setPage('planning')}><span><Plus size={15} /> Crear nueva jornada</span><ArrowRight size={15} /></button>}
      </section>
      <section className="surface-card task-widget"><div className="card-heading"><div><span className="eyebrow">EQUIPO Y COLABORACIÓN</span><h3>Tareas pendientes</h3></div><button className="circle-action" onClick={() => setPage('tasks')} aria-label="Ir a tareas"><ArrowUpRight size={17} /></button></div>
        {tasks.length ? <div className="task-list">{tasks.map((task) => <div className="mini-task" key={task.id}><span className={`task-check ${task.status === 'done' ? 'checked' : ''}`}><Check size={13} /></span><div className="mini-task-copy"><strong>{task.title}</strong><small><CalendarClock size={13} /> {formatDate(task.date)} · {task.time} <span className="task-divider">|</span> {user.role === 'admin' ? personName(db, task.volunteerId) : 'Asignada a vos'}</small></div><span className={`priority-dot ${task.priority?.toLowerCase() || 'media'}`} title={`Prioridad ${task.priority || 'media'}`} /></div>)}</div> : <EmptyState icon={ClipboardList} title="Todo al día" description="No tenés tareas pendientes en este momento." />}
        <button className="widget-footer" onClick={() => setPage('tasks')}><span>Administrar tareas</span><ArrowRight size={15} /></button>
      </section>
    </div>
    <div className="dashboard-grid lower-grid">
      {user.role === 'admin' && <section className="surface-card stock-widget"><div className="card-heading"><div><span className="eyebrow">ALMACÉN</span><h3>Tablero de alertas de inventario</h3><p className="muted-text">Lotes y stock utilizable consultados en PostgreSQL · Referencia: {inventoryAlerts?.fecha_referencia ? formatDate(inventoryAlerts.fecha_referencia) : '—'}</p></div><button className="text-link" onClick={() => setPage('inventory')}>Ver inventario <ArrowRight size={15} /></button></div>
        {!inventoryAlerts ? <div className="muted-text">{inventoryAlertsError || 'Cargando alertas de inventario...'}</div> : <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '14px' }}>
          {alertGroups.map((grupo) => <section key={grupo.key} style={{ border: '1px solid var(--border, #e5e7eb)', borderRadius: '12px', padding: '14px', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}><span className={`alert-icon ${grupo.tone}`}><grupo.icon size={16} /></span><strong style={{ flex: 1, fontSize: '0.92rem' }}>{grupo.title}</strong><StatusPill tone={grupo.rows.length ? grupo.tone : 'green'}>{grupo.rows.length}</StatusPill></div>
            {grupo.rows.length ? <div className="alert-list">{grupo.rows.slice(0, 4).map((item, indice) => {
              const nombre = item.nombre || 'Insumo';
              const esStock = grupo.key === 'stock_bajo_o_insuficiente';
              const detalle = esStock
                ? `${item.estado_stock} · Utilizable: ${formatNumber(item.cantidad_utilizable)} ${item.unidad_medida} · Total: ${formatNumber(item.cantidad_total)} ${item.unidad_medida} · Mínimo: ${formatNumber(item.stock_minimo)} ${item.unidad_medida}`
                : `${formatNumber(item.cantidad_disponible)} ${item.unidad_medida} · Vencimiento: ${formatDate(item.fecha_vencimiento)}`;
              return <div className="stock-alert" key={item.lote_id || `${item.insumo_id}-${indice}`}><div style={{ minWidth: 0 }}><strong>{nombre}</strong><small>{detalle}</small></div></div>;
            })}{grupo.rows.length > 4 && <small className="muted-text">Y {grupo.rows.length - 4} alertas más.</small>}</div> : <p className="muted-text" style={{ margin: 0 }}>Sin alertas en esta categoría.</p>}
          </section>)}
        </div>}
        {inventoryAlerts && alertGroups.every((grupo) => grupo.rows.length === 0) && <div className="all-clear"><CircleCheck size={19} /><span>Sin alertas de vencimiento ni de stock utilizable.</span></div>}
      </section>}
      <section className="quote-card"><span className="quote-icon"><HeartHandshake size={22} /></span><span className="eyebrow light">NUESTRO PROPÓSITO</span><h3>El servicio se organiza, el amor se multiplica.</h3><p>Cada tarea coordinada libera tiempo para lo que más importa: estar cerca de quienes lo necesitan.</p><div className="quote-card-footer"><span>Fundación Vivir para Servir</span><Sprout size={22} /></div></section>
    </div>
  </div>;
}

function PlanningPage({ jornadas, loading, error, onReload, inventory, inventoryLoading, onReloadInventory, setToast, search }) {
  const [formOpen, setFormOpen] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipesError, setRecipesError] = useState('');
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityCheck, setAvailabilityCheck] = useState(null);
  const [startingId, setStartingId] = useState('');
  const [form, setForm] = useState({ recipeId: '', portions: '', date: todayISO(), mealTime: 'Almuerzo', notes: '' });
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [cancellingId, setCancellingId] = useState('');
  const [closeTarget, setCloseTarget] = useState(null);
  const [closeForm, setCloseForm] = useState({ preparedPortions: '', leftoverPortions: '0', ingredients: {}, leftoverDestinations: [] });
  const formRef = useRef(null);

  useEffect(() => {
    let vigente = true;
    async function cargarRecetas() {
      setRecipesLoading(true);
      setRecipesError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/recetas`);
        const datos = await leerRespuestaAPI(respuesta);
        const filas = Array.isArray(datos) ? datos : datos?.recetas ?? datos?.datos?.recetas ?? [];
        if (!Array.isArray(filas)) throw new Error('El backend no devolvió una lista válida de recetas.');
        const activas = filas.map((receta) => ({
          id: String(receta.id),
          name: receta.nombre,
          description: receta.descripcion || '',
          category: receta.categoria || 'Plato principal',
          prepMinutes: Number(receta.minutos_preparacion || 0),
          ingredients: (Array.isArray(receta.ingredientes) ? receta.ingredientes : []).map((ingrediente) => ({
            inventoryId: String(ingrediente.insumo_id),
            name: ingrediente.nombre,
            unit: ingrediente.unidad_medida,
            quantity: Number(ingrediente.cantidad_por_porcion),
          })),
        }));
        if (vigente) {
          setRecipes(activas);
          setForm((actual) => ({
            ...actual,
            recipeId: activas.some((receta) => receta.id === actual.recipeId)
              ? actual.recipeId
              : (activas[0]?.id || ''),
          }));
        }
      } catch (err) {
        if (vigente) setRecipesError(err.message || 'No se pudieron cargar las recetas.');
      } finally {
        if (vigente) setRecipesLoading(false);
      }
    }
    cargarRecetas();
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    if (formOpen && formRef.current) formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [formOpen]);

  // Verifica automáticamente receta, porciones y fecha contra los lotes de PostgreSQL.
  useEffect(() => {
    const cantidad = Number(form.portions);
    if (!formOpen || !form.recipeId || !form.date || !Number.isSafeInteger(cantidad) || cantidad < 1) {
      setAvailabilityCheck(null);
      setAvailabilityError('');
      setCheckingAvailability(false);
      return undefined;
    }
    let vigente = true;
    const temporizador = window.setTimeout(async () => {
      setCheckingAvailability(true);
      setAvailabilityError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/jornadas/verificar-disponibilidad`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ receta_id: form.recipeId, fecha_planificada: form.date, porciones_planificadas: cantidad }),
        });
        const datos = await leerRespuestaAPI(respuesta);
        if (vigente) setAvailabilityCheck(datos);
      } catch (err) {
        if (vigente) {
          setAvailabilityCheck(null);
          setAvailabilityError(err.message || 'No se pudo verificar el inventario.');
        }
      } finally {
        if (vigente) setCheckingAvailability(false);
      }
    }, 350);
    return () => { vigente = false; window.clearTimeout(temporizador); };
  }, [formOpen, form.recipeId, form.portions, form.date]);

  const portions = Number(form.portions);
  const disponibilidadActual = Boolean(availabilityCheck && availabilityCheck.receta_id === form.recipeId &&
    Number(availabilityCheck.porciones_planificadas) === portions && availabilityCheck.fecha_evaluada === form.date);
  // No mostrar cálculos locales potencialmente desactualizados: todas las cantidades visibles
  // salen de PostgreSQL y corresponden a la misma receta, fecha y número de viandas del formulario.
  const ingredientPreview = disponibilidadActual
    ? availabilityCheck.ingredientes.map((ingrediente) => ({
      inventoryId: String(ingrediente.insumo_id),
      name: ingrediente.nombre_insumo,
      unit: ingrediente.unidad_medida,
      quantity: Number(ingrediente.cantidad_por_porcion || 0),
      planned: Number(ingrediente.cantidad_necesaria || 0),
      available: Number(ingrediente.cantidad_utilizable || 0),
      totalAvailable: Number(ingrediente.cantidad_total || 0),
      expired: Number(ingrediente.cantidad_vencida_para_fecha || 0),
      shortage: Math.max(0, Number(ingrediente.cantidad_faltante || 0)),
    }))
    : [];

  const filteredJornadas = jornadas
    .filter((jornada) => filter === 'all' || jornada.status === filter)
    .filter((jornada) => `${jornada.recipeName} ${jornada.date} ${jornada.mealTime} ${jornada.status}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

  const submitPlan = async (event) => {
    event.preventDefault();
    const cantidad = Number(form.portions);
    if (!form.recipeId) { setToast({ type: 'error', message: 'Seleccioná una receta.' }); return; }
    if (!Number.isSafeInteger(cantidad) || cantidad < 1) {
      setToast({ type: 'error', message: 'Ingresá una cantidad de viandas que sea un entero positivo.' });
      return;
    }
    if (!form.date) { setToast({ type: 'error', message: 'Indicá la fecha de la jornada.' }); return; }
    if (checkingAvailability || !disponibilidadActual || availabilityError) {
      setToast({ type: 'error', message: availabilityError || 'Esperá a que termine la verificación de stock antes de guardar la jornada.' });
      return;
    }
    if (availabilityCheck.hay_faltantes || availabilityCheck.hay_lotes_vencidos || availabilityCheck.hay_stock_bajo_despues) {
      const motivos = [];
      if (availabilityCheck.hay_faltantes) motivos.push('faltan insumos utilizables');
      if (availabilityCheck.hay_lotes_vencidos) motivos.push('hay lotes vencidos que se excluirán del stock utilizable');
      if (availabilityCheck.hay_stock_bajo_despues) motivos.push('algún insumo quedaría en el nivel mínimo o por debajo');
      const continuar = window.confirm(`La verificación detectó: ${motivos.join('; ')}. Podés guardar la planificación, pero no se permitirá iniciar la preparación si falta stock utilizable. ¿Guardar igual como planificación pendiente?`);
      if (!continuar) return;
    }
    setSaving(true);
    try {
      const respuesta = await fetch(`${API_URL}/api/jornadas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receta_id: form.recipeId,
          fecha_planificada: form.date,
          momento_comida: form.mealTime,
          porciones_planificadas: cantidad,
          observaciones: form.notes.trim() || null,
        }),
      });
      await leerRespuestaAPI(respuesta);
      setFormOpen(false);
      setForm((actual) => ({ ...actual, portions: '', date: todayISO(), notes: '' }));
      setToast({ type: 'success', message: 'Jornada e ingredientes previstos guardados en PostgreSQL.' });
      onReload();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo guardar la jornada.' });
    } finally {
      setSaving(false);
    }
  };

  const abrirCierre = (jornada) => {
    setCloseTarget(jornada);
    setCloseForm({
      preparedPortions: String(jornada.portions),
      leftoverPortions: '0',
      ingredients: Object.fromEntries(jornada.ingredients.map((ingrediente) => [ingrediente.inventoryId, {
        used: String(ingrediente.quantity),
        returned: '0',
      }])),
      leftoverDestinations: [],
    });
  };

  const actualizarCantidadSobrantesViandas = (valor) => {
    setCloseForm((actual) => {
      const cantidad = Number(valor);
      let destinos = Array.isArray(actual.leftoverDestinations) ? actual.leftoverDestinations : [];
      if (Number.isSafeInteger(cantidad) && cantidad <= 0) {
        destinos = [];
      } else if (Number.isSafeInteger(cantidad) && cantidad > 0) {
        if (destinos.length === 0) {
          destinos = [{ portions: String(cantidad), destination: '', observations: '' }];
        } else if (destinos.length === 1) {
          destinos = [{ ...destinos[0], portions: String(cantidad) }];
        }
      }
      return { ...actual, leftoverPortions: valor, leftoverDestinations: destinos };
    });
  };

  const actualizarDestinoSobrante = (indice, campo, valor) => {
    setCloseForm((actual) => ({
      ...actual,
      leftoverDestinations: (actual.leftoverDestinations || []).map((item, index) =>
        index === indice ? { ...item, [campo]: valor } : item
      ),
    }));
  };

  const agregarDestinoSobrante = () => {
    setCloseForm((actual) => ({
      ...actual,
      leftoverDestinations: [
        ...(actual.leftoverDestinations || []),
        { portions: '0', destination: '', observations: '' },
      ],
    }));
  };

  const quitarDestinoSobrante = (indice) => {
    setCloseForm((actual) => {
      let destinos = (actual.leftoverDestinations || []).filter((_, index) => index !== indice);
      const sobrantes = Number(actual.leftoverPortions);
      if (destinos.length === 1 && Number.isSafeInteger(sobrantes) && sobrantes > 0) {
        destinos = [{ ...destinos[0], portions: String(sobrantes) }];
      }
      return { ...actual, leftoverDestinations: destinos };
    });
  };

  const actualizarIngredienteCierre = (insumoId, campo, valor) => {
    setCloseForm((actual) => ({
      ...actual,
      ingredients: {
        ...actual.ingredients,
        [insumoId]: { ...(actual.ingredients[insumoId] || {}), [campo]: valor },
      },
    }));
  };

  const confirmarCierre = async () => {
    if (!closeTarget) return;
    const preparadas = Number(closeForm.preparedPortions);
    const sobrantesViandas = Number(closeForm.leftoverPortions);
    if (!Number.isSafeInteger(preparadas) || preparadas < 0 || preparadas > closeTarget.portions) {
      setToast({ type: 'error', message: `Las porciones preparadas deben ser un entero entre 0 y ${closeTarget.portions}.` });
      return;
    }
    if (!Number.isSafeInteger(sobrantesViandas) || sobrantesViandas < 0 || sobrantesViandas > preparadas) {
      setToast({ type: 'error', message: 'Las viandas sobrantes deben ser un entero entre 0 y las viandas preparadas.' });
      return;
    }

    const destinosSobrantes = (closeForm.leftoverDestinations || []).map((item) => ({
      cantidad_porciones: Number(item.portions),
      destino: String(item.destination || '').trim(),
      observaciones: String(item.observations || '').trim() || null,
    }));
    if (sobrantesViandas === 0 && destinosSobrantes.length > 0) {
      setToast({ type: 'error', message: 'Si no hay viandas sobrantes, eliminá los destinos de sobrantes.' });
      return;
    }
    if (sobrantesViandas > 0 && destinosSobrantes.length === 0) {
      setToast({ type: 'error', message: 'Indicá el destino de las viandas sobrantes antes de cerrar la jornada.' });
      return;
    }
    if (destinosSobrantes.some((item) => !Number.isSafeInteger(item.cantidad_porciones) || item.cantidad_porciones <= 0)) {
      setToast({ type: 'error', message: 'Cada destino debe tener una cantidad de viandas enteras mayor que cero.' });
      return;
    }
    if (destinosSobrantes.some((item) => !DESTINOS_SOBRANTES.some((destino) => destino.value === item.destino))) {
      setToast({ type: 'error', message: 'Seleccioná un destino válido para cada grupo de viandas sobrantes.' });
      return;
    }
    if (destinosSobrantes.some((item) => item.destino === 'descarte' && !item.observaciones)) {
      setToast({ type: 'error', message: 'Cuando se descarten viandas, registrá el motivo en las observaciones.' });
      return;
    }
    const totalDestinosSobrantes = destinosSobrantes.reduce((total, item) => total + item.cantidad_porciones, 0);
    if (totalDestinosSobrantes !== sobrantesViandas) {
      setToast({ type: 'error', message: `Distribuí exactamente las ${sobrantesViandas} viandas sobrantes entre los destinos. Actualmente asignaste ${totalDestinosSobrantes}.` });
      return;
    }

    const ingredientes = closeTarget.ingredients.map((ingrediente) => {
      const valor = closeForm.ingredients[ingrediente.inventoryId] || {};
      return {
        insumo_id: ingrediente.inventoryId,
        cantidad_utilizada_real: Number(valor.used),
        cantidad_devuelta: Number(valor.returned),
      };
    });
    for (const ingrediente of ingredientes) {
      if (!Number.isFinite(ingrediente.cantidad_utilizada_real) || ingrediente.cantidad_utilizada_real < 0 ||
          !Number.isFinite(ingrediente.cantidad_devuelta) || ingrediente.cantidad_devuelta < 0 ||
          Math.abs(ingrediente.cantidad_utilizada_real * 1000 - Math.round(ingrediente.cantidad_utilizada_real * 1000)) > 0.000001 ||
          Math.abs(ingrediente.cantidad_devuelta * 1000 - Math.round(ingrediente.cantidad_devuelta * 1000)) > 0.000001) {
        setToast({ type: 'error', message: 'Las cantidades utilizadas y devueltas deben ser no negativas y tener como máximo tres decimales.' });
        return;
      }
      if (ingrediente.cantidad_utilizada_real + ingrediente.cantidad_devuelta > closeTarget.ingredients.find((item) => item.inventoryId === ingrediente.insumo_id).quantity + 0.000001) {
        const fila = closeTarget.ingredients.find((item) => item.inventoryId === ingrediente.insumo_id);
        setToast({ type: 'error', message: `${fila.name}: lo utilizado más lo devuelto no puede superar lo planificado (${formatearCantidad(fila.quantity)} ${fila.unit}).` });
        return;
      }
    }

    setClosing(true);
    try {
      const respuesta = await fetch(`${API_URL}/api/jornadas/${encodeURIComponent(closeTarget.id)}/cerrar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          porciones_preparadas: preparadas,
          porciones_sobrantes: sobrantesViandas,
          destinos_sobrantes: destinosSobrantes,
          ingredientes,
        }),
      });
      await leerRespuestaAPI(respuesta);
      setCloseTarget(null);
      setToast({ type: 'success', message: 'Jornada cerrada. Se guardaron consumos, devoluciones y sobrantes en PostgreSQL.' });
      onReload();
      onReloadInventory();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo cerrar la jornada.' });
    } finally {
      setClosing(false);
    }
  };

  const iniciarJornada = async (jornada) => {
    setStartingId(jornada.id);
    try {
      const respuesta = await fetch(`${API_URL}/api/jornadas/${encodeURIComponent(jornada.id)}/iniciar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const datos = await leerRespuestaAPI(respuesta);
      const advertencias = Array.isArray(datos.advertencias) ? datos.advertencias : [];
      setToast({
        type: 'success',
        message: advertencias.length
          ? `Preparación iniciada para ${formatearCantidad(Number(datos.porciones_planificadas ?? jornada.portions))} viandas. Atención: ${advertencias.join(' ')}`
          : `Preparación iniciada para ${formatearCantidad(Number(datos.porciones_planificadas ?? jornada.portions))} viandas. PostgreSQL verificó que alcanza el stock utilizable.`,
      });
      onReload();
      onReloadInventory();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo iniciar la preparación.' });
    } finally {
      setStartingId('');
    }
  };

  const cancelarJornada = async (jornada) => {
    if (!window.confirm(`¿Cancelar la jornada de ${jornada.recipeName} del ${formatDate(jornada.date)}? El registro se conservará en PostgreSQL.`)) return;
    setCancellingId(jornada.id);
    try {
      const respuesta = await fetch(`${API_URL}/api/jornadas/${encodeURIComponent(jornada.id)}/cancelar`, { method: 'PATCH' });
      await leerRespuestaAPI(respuesta);
      setToast({ type: 'success', message: 'Jornada cancelada; se conservó el historial.' });
      onReload();
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo cancelar la jornada.' });
    } finally {
      setCancellingId('');
    }
  };

  const estadoEtiqueta = (estado) => ({
    planned: 'Planificada',
    in_progress: 'En preparación',
    prepared: 'Preparada',
    cancelled: 'Cancelada',
  }[estado] || estado);
  const estadoColor = (estado) => estado === 'prepared' ? 'green' : estado === 'cancelled' ? 'rose' : estado === 'in_progress' ? 'amber' : 'blue';

  return <div className="page-content">
    <PageHeader eyebrow="COCINA Y PRODUCCIÓN" title="Planificación de viandas" description="Planificá jornadas con recetas de PostgreSQL, guardá una copia de los ingredientes previstos y registrá el consumo real al cerrar." action={<Button icon={Plus} onClick={() => setFormOpen((actual) => !actual)}>{formOpen ? 'Cerrar formulario' : 'Nueva jornada'}</Button>} />

    {(error || recipesError) && <div className="calculadora-error" role="alert">{error || recipesError}</div>}
    {formOpen && <section className="surface-card form-card" ref={formRef}>
      <div className="form-card-heading"><div><span className="eyebrow">NUEVA PLANIFICACIÓN</span><h3>¿Qué vamos a preparar?</h3></div><IconButton icon={X} label="Cerrar formulario" onClick={() => setFormOpen(false)} subtle /></div>
      <form className="form-grid" onSubmit={submitPlan}>
        <label className="field wide"><span>Receta</span><select value={form.recipeId} onChange={(e) => setForm({ ...form, recipeId: e.target.value })} required disabled={recipesLoading || recipes.length === 0}>
          {recipesLoading && <option value="">Cargando recetas...</option>}
          {!recipesLoading && recipes.length === 0 && <option value="">Primero registrá una receta activa</option>}
          {recipes.map((receta) => <option value={receta.id} key={receta.id}>{receta.name}</option>)}
        </select></label>
        <label className="field"><span>Cantidad de viandas</span><input type="number" min="1" step="1" placeholder="Ej. 40" value={form.portions} onChange={(e) => setForm({ ...form, portions: e.target.value })} required /></label>
        <label className="field"><span>Fecha de la jornada</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label>
        <label className="field"><span>Momento</span><select value={form.mealTime} onChange={(e) => setForm({ ...form, mealTime: e.target.value })}><option>Desayuno</option><option>Almuerzo</option><option>Merienda</option><option>Cena</option><option>Otro</option></select></label>
        <label className="field wide"><span>Observaciones (opcional)</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Indicaciones para la jornada" /></label>

        <div className="ingredient-builder wide">
          <div className="ingredient-builder-title"><strong>Vista previa de ingredientes</strong><small>{Number.isSafeInteger(portions) && portions > 0 ? `Cantidades para ${formatearCantidad(portions)} viandas. El mismo número se usa en el cálculo, las alertas y la jornada.` : 'Ingresá la cantidad de viandas para calcular ingredientes y alertas.'}</small></div>
          {recipesLoading || inventoryLoading ? <p className="muted-text">Cargando receta e inventario...</p> : !disponibilidadActual ? <p className="muted-text">{checkingAvailability ? 'Esperando el cálculo confirmado por PostgreSQL; todavía no se muestran cantidades para evitar diferencias.' : availabilityError ? 'No se pudo confirmar el cálculo. Revisá el mensaje de error de la verificación.' : 'Ingresá la cantidad de viandas y esperá la verificación de PostgreSQL para ver las cantidades exactas.'}</p> : ingredientPreview.length ? <div className="builder-ingredient-list">
            {ingredientPreview.map((ingrediente) => <div className="builder-ingredient" key={ingrediente.inventoryId}>
              <span>{ingrediente.name} <small>· Utilizable hoy: {formatearCantidad(ingrediente.available)} {ingrediente.unit} · Stock total: {formatearCantidad(ingrediente.totalAvailable)} {ingrediente.unit}</small></span>
              <strong>{formatearCantidad(ingrediente.planned)} {ingrediente.unit}</strong>
              {ingrediente.shortage > 0 && <span className="number-warning">Faltan {formatearCantidad(ingrediente.shortage)} {ingrediente.unit}</span>}
              {ingrediente.expired > 0 && <span className="number-warning">Stock vencido excluido: {formatearCantidad(ingrediente.expired)} {ingrediente.unit}</span>}
            </div>)}
            <p className="form-help"><CircleHelp size={15} /> El stock total incluye todos los lotes con saldo. El stock utilizable excluye los que vencieron antes de la fecha de la jornada. Guardar la planificación no reserva ni descuenta stock.</p>
          </div> : <p className="builder-empty">La receta seleccionada no tiene ingredientes para mostrar.</p>}
          <div style={{ marginTop: '16px', padding: '15px', border: '1px solid var(--border, #e5e7eb)', borderRadius: '12px' }}>
            <div className="ingredient-builder-title"><strong>Verificación previa de insumos</strong><small>{Number.isSafeInteger(portions) && portions > 0 ? `PostgreSQL verifica exactamente ${formatearCantidad(portions)} viandas para la fecha seleccionada.` : 'PostgreSQL verificará la disponibilidad cuando ingreses una cantidad válida.'} Los lotes vencidos no cuentan como utilizables.</small></div>
            {checkingAvailability && <p className="muted-text">Verificando ingredientes y fechas de vencimiento...</p>}
            {availabilityError && <div className="calculadora-error" role="alert">{availabilityError}</div>}
            {!checkingAvailability && !availabilityError && !disponibilidadActual && <p className="muted-text">Esperando los datos para verificar la disponibilidad.</p>}
            {!checkingAvailability && disponibilidadActual && <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', margin: '10px 0' }}>
                <StatusPill tone={availabilityCheck.hay_faltantes ? 'rose' : 'green'}>{availabilityCheck.hay_faltantes ? 'Hay faltantes' : 'Cantidad necesaria cubierta'}</StatusPill>
                {availabilityCheck.hay_lotes_vencidos && <StatusPill tone="rose">Hay lotes vencidos</StatusPill>}
                {availabilityCheck.hay_stock_bajo_despues && <StatusPill tone="amber">Puede quedar stock bajo</StatusPill>}
              </div>
              <div className="builder-ingredient-list">{availabilityCheck.ingredientes.map((ingrediente) => {
                const situacion = ingrediente.insuficiente
                  ? `Faltan ${formatearCantidad(ingrediente.cantidad_faltante)} ${ingrediente.unidad_medida}`
                  : ingrediente.cantidad_vencida_para_fecha > 0
                    ? `Hay ${formatearCantidad(ingrediente.cantidad_vencida_para_fecha)} ${ingrediente.unidad_medida} vencidos (excluidos)`
                    : ingrediente.stock_quedaria_bajo_minimo
                      ? 'Quedaría en el mínimo o por debajo'
                      : 'Alcanza';
                return <div className="builder-ingredient" key={ingrediente.insumo_id}>
                  <span><strong>{ingrediente.nombre_insumo}</strong><small>Necesario: {formatearCantidad(ingrediente.cantidad_necesaria)} {ingrediente.unidad_medida} · Utilizable: {formatearCantidad(ingrediente.cantidad_utilizable)} {ingrediente.unidad_medida} · Total: {formatearCantidad(ingrediente.cantidad_total)} {ingrediente.unidad_medida}</small></span>
                  <span className={ingrediente.insuficiente ? 'number-warning' : ''}>{situacion}</span>
                </div>;
              })}</div>
              <p className="form-help"><CircleHelp size={15} /> La jornada se puede guardar como pendiente aun si hay alertas. Para iniciar la preparación, el backend volverá a verificar el stock utilizable en ese momento.</p>
            </>}
          </div>
        </div>
        <div className="form-actions wide"><Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" icon={CalendarCheck} disabled={saving || recipesLoading || !recipes.length || checkingAvailability || !disponibilidadActual || Boolean(availabilityError)}>{saving ? 'Guardando...' : 'Guardar jornada en PostgreSQL'}</Button></div>
      </form>
    </section>}

    <div className="toolbar-row">
      <div className="filter-tabs">
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <span>{jornadas.length}</span></button>
        <button className={filter === 'planned' ? 'active' : ''} onClick={() => setFilter('planned')}>Planificadas <span>{jornadas.filter((p) => p.status === 'planned').length}</span></button>
        <button className={filter === 'in_progress' ? 'active' : ''} onClick={() => setFilter('in_progress')}>En preparación <span>{jornadas.filter((p) => p.status === 'in_progress').length}</span></button>
        <button className={filter === 'prepared' ? 'active' : ''} onClick={() => setFilter('prepared')}>Preparadas <span>{jornadas.filter((p) => p.status === 'prepared').length}</span></button>
        <button className={filter === 'cancelled' ? 'active' : ''} onClick={() => setFilter('cancelled')}>Canceladas <span>{jornadas.filter((p) => p.status === 'cancelled').length}</span></button>
      </div>
      <span className="toolbar-note"><Sparkles size={14} /> Jornadas guardadas en PostgreSQL</span>
    </div>

    {loading ? <div className="surface-card form-card"><p className="muted-text">Cargando jornadas desde PostgreSQL...</p></div> : filteredJornadas.length ? <div className="planning-list">
      {filteredJornadas.map((jornada) => <article className="planning-card" key={jornada.id}>
        <div className="planning-card-main">
          <div className="planning-date"><CalendarDays size={17} /><strong>{formatDate(jornada.date)}</strong></div>
          <div className="planning-title-row">
            <div className="recipe-illustration"><CookingPot size={25} /></div>
            <div className="planning-title"><h3>{jornada.recipeName}</h3><p>{jornada.description || 'Receta de la fundación.'}</p>
              <div className="plan-tags"><span><Utensils size={14} /> {formatearCantidad(jornada.portions)} viandas planificadas</span><span><Clock3 size={14} /> {jornada.mealTime}</span><span><ChefHat size={14} /> {jornada.prepMinutes || '—'} min</span></div>
            </div>
            <StatusPill tone={estadoColor(jornada.status)}>{estadoEtiqueta(jornada.status)}</StatusPill>
          </div>
          <div className="ingredient-calculation">
            <div className="ingredient-calc-heading"><strong><Sparkles size={15} /> Copia de ingredientes prevista</strong><small>Cantidades para {formatearCantidad(jornada.portions)} porciones</small></div>
            {jornada.ingredients.length ? <div className="ingredient-chips">{jornada.ingredients.map((ingrediente) => <span className="ingredient-chip" key={ingrediente.inventoryId}><span>{ingrediente.name}</span><strong>{formatearCantidad(ingrediente.quantity)} {ingrediente.unit}</strong></span>)}</div> : <p className="muted-text">No hay ingredientes asociados a la copia de esta jornada.</p>}
            {jornada.ingredients.some((ingrediente) => ingrediente.quantityMismatch) && <div className="calculadora-error" role="alert" style={{ marginTop: '12px' }}><strong>Inconsistencia en las cantidades.</strong> Esta jornada está planificada para {formatearCantidad(jornada.portions)} viandas, pero uno o más ingredientes no coinciden con la cantidad por vianda guardada. No se puede iniciar con esta copia. Cancelá la jornada y creá una nueva después de revisar la receta.</div>}
          </div>
          {jornada.status === 'prepared' && <div className="prepared-note"><CheckCircle2 size={16} /> Cierre registrado · {formatearCantidad(jornada.preparedPortions ?? 0)} viandas preparadas · {formatearCantidad(jornada.leftovers)} viandas sobrantes</div>}
          {jornada.status === 'prepared' && jornada.leftovers > 0 && (jornada.leftoverDestinations || []).length > 0 && <div className="builder-ingredient-list">
            <div className="ingredient-calc-heading"><strong>Destino de las viandas sobrantes</strong><small>Trazabilidad registrada al cerrar la jornada</small></div>
            {jornada.leftoverDestinations.map((destino, indice) => <div className="builder-ingredient" key={destino.id || `${jornada.id}-sobrante-${indice}`}>
              <span>{etiquetaDestinoSobrantes(destino.destination)}</span>
              <span>Viandas: <strong>{formatearCantidad(destino.portions)}</strong></span>
              {destino.observations && <span>Observaciones: <strong>{destino.observations}</strong></span>}
            </div>)}
          </div>}
          {jornada.status === 'prepared' && jornada.leftovers > 0 && (jornada.leftoverDestinations || []).length === 0 && <div className="form-help"><CircleHelp size={15} /> Esta jornada se cerró antes de activar el registro detallado de destinos de sobrantes.</div>}
          {jornada.status === 'prepared' && jornada.ingredients.some((ingrediente) => ingrediente.quantityUsed !== null) && <div className="builder-ingredient-list">
            {jornada.ingredients.map((ingrediente) => <div className="builder-ingredient" key={ingrediente.inventoryId}><span>{ingrediente.name}</span><span>Utilizado: <strong>{formatearCantidad(ingrediente.quantityUsed ?? 0)} {ingrediente.unit}</strong></span><span>Devuelto: <strong>{formatearCantidad(ingrediente.quantityReturned)} {ingrediente.unit}</strong></span></div>)}
          </div>}
          <div className="planning-card-footer">
            <span className="stock-footnote"><Boxes size={15} /> {jornada.status === 'planned' ? 'Antes de cocinar, iniciá la preparación: se validará el stock utilizable.' : jornada.status === 'in_progress' ? 'Disponibilidad verificada. El stock se actualiza al cerrar la jornada.' : jornada.status === 'prepared' ? 'Consumo y devoluciones registrados en el historial de stock.' : 'Jornada cancelada; sin movimientos de inventario.'}</span>
            <div className="planning-actions">
              {jornada.status === 'planned' && <Button icon={CookingPot} disabled={startingId === jornada.id || jornada.ingredients.some((ingrediente) => ingrediente.quantityMismatch)} onClick={() => iniciarJornada(jornada)}>{startingId === jornada.id ? 'Verificando...' : jornada.ingredients.some((ingrediente) => ingrediente.quantityMismatch) ? 'Revisar cantidades antes de iniciar' : 'Verificar e iniciar preparación'}</Button>}
              {jornada.status === 'in_progress' && <Button icon={CheckCircle2} onClick={() => abrirCierre(jornada)}>Cerrar jornada</Button>}
              {jornada.status === 'planned' && <IconButton icon={X} label="Cancelar jornada" subtle danger disabled={cancellingId === jornada.id || startingId === jornada.id} onClick={() => cancelarJornada(jornada)} />}
            </div>
          </div>
        </div>
      </article>)}
    </div> : <EmptyState icon={CalendarDays} title={filter === 'all' ? 'No hay jornadas para mostrar' : 'No hay jornadas en este filtro'} description="Creá una planificación para guardar la jornada y copiar sus ingredientes en PostgreSQL." action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Nueva jornada</Button>} />}

    {closeTarget && <Modal title="Cerrar jornada de cocina" description="Indicá cuántas viandas se prepararon y cuánto se utilizó o se devolvió de cada ingrediente. Se validará el stock antes de registrar el cierre." size="large" onClose={() => { if (!closing) setCloseTarget(null); }}>
      <div className="close-plan-summary"><span className="summary-icon"><CookingPot size={22} /></span><div><strong>{closeTarget.recipeName}</strong><small>{formatearCantidad(closeTarget.portions)} porciones planificadas · {formatDate(closeTarget.date)}</small></div></div>
      <div className="form-grid">
        <label className="field"><span>Viandas preparadas</span><input type="number" min="0" max={closeTarget.portions} step="1" value={closeForm.preparedPortions} onChange={(e) => setCloseForm({ ...closeForm, preparedPortions: e.target.value })} /></label>
        <label className="field"><span>Viandas terminadas sobrantes</span><input type="number" min="0" max={closeForm.preparedPortions || closeTarget.portions} step="1" value={closeForm.leftoverPortions} onChange={(e) => actualizarCantidadSobrantesViandas(e.target.value)} /></label>
      </div>
      {Number(closeForm.leftoverPortions) > 0 && <div className="modal-leftovers" style={{ marginTop: '16px' }}>
        <div className="modal-section-label"><strong>Destino de las viandas sobrantes</strong><small>Registrá qué se hará con cada grupo de viandas. Podés dividirlas entre varios destinos; la suma debe coincidir con las viandas sobrantes. No confundas estas viandas preparadas con los ingredientes sin usar que se devuelven al inventario.</small></div>
        {(closeForm.leftoverDestinations || []).map((item, indice) => <div key={`destino-sobrante-${indice}`} className="leftover-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,0.55fr) minmax(180px,1fr) minmax(180px,1.25fr) auto', gap: '12px', alignItems: 'end' }}>
          <label className="field"><span>Viandas</span><input type="number" min="1" max={closeForm.leftoverPortions} step="1" value={item.portions} onChange={(e) => actualizarDestinoSobrante(indice, 'portions', e.target.value)} /></label>
          <label className="field"><span>Destino</span><select value={item.destination} onChange={(e) => actualizarDestinoSobrante(indice, 'destination', e.target.value)}>
            <option value="">Seleccioná un destino</option>
            {DESTINOS_SOBRANTES.map((destino) => <option key={destino.value} value={destino.value}>{destino.label}</option>)}
          </select></label>
          <label className="field"><span>Observaciones {item.destination === 'descarte' ? '(obligatorio para descarte)' : '(opcional)'}</span><textarea rows="2" maxLength="1000" value={item.observations} onChange={(e) => actualizarDestinoSobrante(indice, 'observations', e.target.value)} placeholder={item.destination === 'descarte' ? 'Indicá el motivo del descarte' : 'Por ejemplo, lugar de entrega o conservación'} /></label>
          {(closeForm.leftoverDestinations || []).length > 1 && <Button variant="secondary" onClick={() => quitarDestinoSobrante(indice)}>Quitar</Button>}
        </div>)}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
          <Button variant="secondary" icon={Plus} onClick={agregarDestinoSobrante}>Agregar otro destino</Button>
          <span className="stock-footnote">Asignadas: <strong>{(closeForm.leftoverDestinations || []).reduce((total, item) => total + (Number(item.portions) || 0), 0)} de {Number(closeForm.leftoverPortions) || 0} viandas</strong></span>
        </div>
        <p className="form-help"><CircleHelp size={15} /> Registrá el destino real de las viandas sobrantes. Para conservación o redistribución, seguí los procedimientos de manipulación y conservación de alimentos de la fundación.</p>
      </div>}
      <div className="modal-leftovers">
        <div className="modal-section-label"><strong>Consumo y devolución de ingredientes</strong><small>Las cantidades están en la unidad del insumo. El valor utilizado se completa con la cantidad prevista; corregilo según lo que se usó realmente.</small></div>
        {closeTarget.ingredients.map((ingrediente) => {
          const valores = closeForm.ingredients[ingrediente.inventoryId] || { used: '', returned: '0' };
          const usado = Number(valores.used || 0);
          const devuelto = Number(valores.returned || 0);
          const merma = Math.max(0, Math.round((ingrediente.quantity - usado - devuelto) * 1000) / 1000);
          return <div key={ingrediente.inventoryId} className="leftover-row" style={{ display: 'grid', gridTemplateColumns: 'minmax(130px,1.3fr) minmax(110px,1fr) minmax(110px,1fr)', gap: '12px', alignItems: 'center' }}>
            <span><strong>{ingrediente.name}</strong><small>Previsto: {formatearCantidad(ingrediente.quantity)} {ingrediente.unit}</small></span>
            <label className="field"><span>Utilizado real ({ingrediente.unit})</span><input type="number" min="0" max={ingrediente.quantity} step="0.001" value={valores.used} onChange={(e) => actualizarIngredienteCierre(ingrediente.inventoryId, 'used', e.target.value)} /></label>
            <label className="field"><span>Devuelto ({ingrediente.unit})</span><input type="number" min="0" max={ingrediente.quantity} step="0.001" value={valores.returned} onChange={(e) => actualizarIngredienteCierre(ingrediente.inventoryId, 'returned', e.target.value)} /></label>
            <small style={{ gridColumn: '1 / -1' }}>Diferencia no devuelta que se descontará como merma: <strong>{formatearCantidad(merma)} {ingrediente.unit}</strong></small>
          </div>;
        })}
      </div>
      <p className="form-help"><CircleHelp size={15} /> Al cerrar se descuenta la cantidad prevista que sale hacia cocina y se vuelven a sumar los ingredientes devueltos. El consumo real queda guardado en la jornada. Si falta stock o hay un dato incoherente, no se guarda ningún movimiento.</p>
      <div className="modal-actions"><Button variant="secondary" disabled={closing} onClick={() => setCloseTarget(null)}>Cancelar</Button><Button icon={CheckCircle2} disabled={closing} onClick={confirmarCierre}>{closing ? 'Registrando cierre...' : 'Confirmar cierre y actualizar stock'}</Button></div>
    </Modal>}
  </div>;
}

function RecipesPage({ setToast, search }) {
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: '',
    category: 'Plato principal',
    description: '',
    prepMinutes: 45,
    ingredients: [],
  });
  const [ingredientDraft, setIngredientDraft] = useState({
    inventoryId: '',
    quantity: '0.1',
  });
  const [modoCantidad, setModoCantidad] = useState('porcion');
  const [porcionesLote, setPorcionesLote] = useState('40');
  const [recipes, setRecipes] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [eliminandoId, setEliminandoId] = useState(null);
  const [errorCarga, setErrorCarga] = useState('');
  const [errorFormulario, setErrorFormulario] = useState('');
  const formularioRef = useRef(null);

  const obtenerIdInsumo = (item) => String(item?.insumo_id ?? item?.id ?? '');
  const buscarInsumo = (id) => insumos.find((item) => obtenerIdInsumo(item) === String(id));

  // El recetario se consulta desde PostgreSQL; localDB.js sigue vigente para otros módulos.
  useEffect(() => {
    let cancelado = false;

    async function cargarRecetasEInsumos() {
      setCargando(true);
      setErrorCarga('');

      try {
        const [respuestaRecetas, respuestaInsumos] = await Promise.all([
          fetch('http://localhost:3000/api/recetas'),
          fetch('http://localhost:3000/api/insumos'),
        ]);

        const datosRecetas = await respuestaRecetas.json().catch(() => null);
        const datosInsumos = await respuestaInsumos.json().catch(() => null);

        if (!respuestaRecetas.ok) {
          throw new Error(datosRecetas?.error || datosRecetas?.mensaje ||
            `No se pudieron consultar las recetas (HTTP ${respuestaRecetas.status}).`);
        }
        if (!respuestaInsumos.ok) {
          throw new Error(datosInsumos?.error || datosInsumos?.mensaje ||
            `No se pudo consultar el inventario (HTTP ${respuestaInsumos.status}).`);
        }

        const listaRecetas = Array.isArray(datosRecetas)
          ? datosRecetas
          : datosRecetas?.recetas ?? datosRecetas?.datos?.recetas ?? [];
        const listaInsumos = Array.isArray(datosInsumos)
          ? datosInsumos
          : datosInsumos?.insumos ?? datosInsumos?.datos?.insumos ??
            (Array.isArray(datosInsumos?.datos) ? datosInsumos.datos : []);

        if (!Array.isArray(listaRecetas) || !Array.isArray(listaInsumos)) {
          throw new Error('La API devolvió un formato de datos inesperado.');
        }

        if (!cancelado) {
          setRecipes(listaRecetas);
          setInsumos(listaInsumos);
          setIngredientDraft((actual) => ({
            ...actual,
            inventoryId: actual.inventoryId || obtenerIdInsumo(listaInsumos[0]),
          }));
        }
      } catch (error) {
        if (!cancelado) setErrorCarga(error.message || 'No se pudieron cargar los datos del recetario.');
      } finally {
        if (!cancelado) setCargando(false);
      }
    }

    cargarRecetasEInsumos();
    return () => { cancelado = true; };
  }, []);

  // Cuando se abre el formulario o se elige otra receta con el lápiz,
  // lleva la vista al editor para que el cambio sea visible.
  useEffect(() => {
    if (formOpen && formularioRef.current) {
      formularioRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [formOpen, editingId]);

  const resetForm = () => {
    setEditingId(null);
    setForm({ name: '', category: 'Plato principal', description: '', prepMinutes: 45, ingredients: [] });
    setIngredientDraft({ inventoryId: insumos.length ? obtenerIdInsumo(insumos[0]) : '', quantity: '0.1' });
    setModoCantidad('porcion');
    setPorcionesLote('40');
    setErrorFormulario('');
    setFormOpen(false);
  };

  const startEdit = (recipe) => {
    setEditingId(recipe.id);
    setForm({
      name: recipe.nombre || '',
      category: recipe.categoria || 'Plato principal',
      description: recipe.descripcion || '',
      prepMinutes: recipe.minutos_preparacion || 45,
      // Las cantidades del backend siempre se interpretan como cantidades por porción.
      ingredients: (recipe.ingredientes || []).map((ingredient) => ({
        inventoryId: String(ingredient.insumo_id),
        quantity: Number(ingredient.cantidad_por_porcion),
      })),
    });
    setIngredientDraft({ inventoryId: insumos.length ? obtenerIdInsumo(insumos[0]) : '', quantity: '' });
    setModoCantidad('porcion');
    setPorcionesLote('40');
    setErrorFormulario('');
    setFormOpen(true);
  };

  const addIngredientDraft = () => {
    const cantidadIngresada = Number(ingredientDraft.quantity);
    const rinde = Number(porcionesLote);

    if (!ingredientDraft.inventoryId || !Number.isFinite(cantidadIngresada) || cantidadIngresada <= 0) {
      setErrorFormulario('Elegí un insumo e ingresá una cantidad mayor que cero.');
      return;
    }
    if (modoCantidad === 'lote' && (!Number.isSafeInteger(rinde) || rinde < 1)) {
      setErrorFormulario('Indicá cuántas porciones rinde la olla, usando un entero positivo.');
      return;
    }

    // La API guarda cantidades por porción. Si se ingresó la cantidad total de la olla,
    // se divide por su rendimiento antes de agregarla al formulario.
    const cantidadPorPorcion = modoCantidad === 'lote'
      ? cantidadIngresada / rinde
      : cantidadIngresada;

    setErrorFormulario('');
    const yaExiste = form.ingredients.some(
      (item) => String(item.inventoryId) === String(ingredientDraft.inventoryId)
    );

    setForm((actual) => {
      const existente = actual.ingredients.some(
        (item) => String(item.inventoryId) === String(ingredientDraft.inventoryId)
      );
      if (existente) {
        // Cada insumo debe aparecer una sola vez en una receta. Si ya existe,
        // reemplazamos su cantidad por la nueva (no la sumamos accidentalmente).
        return {
          ...actual,
          ingredients: actual.ingredients.map((item) =>
            String(item.inventoryId) === String(ingredientDraft.inventoryId)
              ? { ...item, quantity: cantidadPorPorcion }
              : item
          ),
        };
      }
      return {
        ...actual,
        ingredients: [...actual.ingredients, {
          inventoryId: ingredientDraft.inventoryId,
          quantity: cantidadPorPorcion,
        }],
      };
    });

    if (yaExiste) {
      const nombreInsumo = buscarInsumo(ingredientDraft.inventoryId)?.nombre || 'El ingrediente';
      setToast({
        type: 'success',
        message: `${nombreInsumo}: se reemplazó la cantidad anterior por la nueva cantidad por porción.`,
      });
    }
    setIngredientDraft((actual) => ({ ...actual, quantity: '' }));
  };

  const updateIngredientQuantity = (inventoryId, value) => {
    setForm((actual) => ({
      ...actual,
      ingredients: actual.ingredients.map((item) =>
        String(item.inventoryId) === String(inventoryId)
          ? { ...item, quantity: value === '' ? '' : Number(value) }
          : item
      ),
    }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setErrorFormulario('');

    if (!form.name.trim()) {
      setErrorFormulario('El nombre de la receta es obligatorio.');
      return;
    }
    if (!Number.isInteger(Number(form.prepMinutes)) || Number(form.prepMinutes) < 1) {
      setErrorFormulario('El tiempo de preparación debe ser un entero positivo.');
      return;
    }
    if (!form.ingredients.length) {
      setErrorFormulario('Agregá al menos un ingrediente a la receta.');
      return;
    }
    if (form.ingredients.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0)) {
      setErrorFormulario('Cada ingrediente debe tener una cantidad por porción mayor que cero.');
      return;
    }

    const ingredientesApi = form.ingredients.map((item) => ({
      insumo_id: item.inventoryId,
      cantidad_por_porcion: Number(item.quantity),
      observaciones: null,
    }));

    if (ingredientesApi.some((item) => !item.insumo_id || !Number.isFinite(item.cantidad_por_porcion) || item.cantidad_por_porcion <= 0)) {
      setErrorFormulario('Revisá los ingredientes y sus cantidades antes de guardar.');
      return;
    }

    const recetaApi = {
      nombre: form.name.trim(),
      descripcion: form.description.trim() || null,
      categoria: form.category,
      minutos_preparacion: Number(form.prepMinutes),
      // Las cantidades guardadas ya están normalizadas por porción.
      porciones_referencia: 1,
      ingredientes: ingredientesApi,
    };

    setGuardando(true);
    try {
      const editando = Boolean(editingId);
      const url = editando
        ? `http://localhost:3000/api/recetas/${editingId}`
        : 'http://localhost:3000/api/recetas';
      const respuesta = await fetch(url, {
        method: editando ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(recetaApi),
      });

      const datos = await respuesta.json().catch(() => null);
      if (!respuesta.ok) {
        throw new Error(datos?.error || datos?.mensaje ||
          `No se pudo ${editando ? 'actualizar' : 'guardar'} la receta (HTTP ${respuesta.status}).`);
      }
      if (!datos?.receta?.id) {
        throw new Error('El backend no devolvió la receta confirmada por PostgreSQL.');
      }

      setRecipes((actuales) => {
        const sinLaActual = actuales.filter((item) => item.id !== datos.receta.id);
        return [...sinLaActual, datos.receta].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
      });
      setToast({
        type: 'success',
        message: datos.mensaje || (editando
          ? 'Receta actualizada en PostgreSQL correctamente.'
          : 'Receta guardada en PostgreSQL correctamente.'),
      });
      resetForm();
    } catch (error) {
      setErrorFormulario(error.message || 'Ocurrió un error al guardar la receta.');
      setToast({ type: 'error', message: error.message || 'No se pudo guardar la receta en PostgreSQL.' });
    } finally {
      setGuardando(false);
    }
  };

  // Desactivación lógica desde DELETE: PostgreSQL conserva la receta y el historial,
  // pero la API deja de devolverla en la lista de recetas activas.
  const eliminarReceta = async (recipe) => {
    if (!recipe?.id || eliminandoId || guardando) return;

    const confirmar = window.confirm(
      `¿Querés eliminar la receta «${recipe.nombre}» del recetario?\n\n` +
      'La receta quedará inactiva y dejará de aparecer en el recetario y en la calculadora. ' +
      'Se conservará en PostgreSQL para proteger el historial de jornadas. No se borrará físicamente.'
    );
    if (!confirmar) return;

    setEliminandoId(recipe.id);
    setErrorFormulario('');

    try {
      const respuesta = await fetch(
        `http://localhost:3000/api/recetas/${encodeURIComponent(recipe.id)}`,
        { method: 'DELETE' }
      );
      const datos = await respuesta.json().catch(() => null);

      if (!respuesta.ok) {
        throw new Error(
          datos?.error || datos?.mensaje ||
          `No se pudo desactivar la receta (HTTP ${respuesta.status}).`
        );
      }

      setRecipes((actuales) => actuales.filter((item) => item.id !== recipe.id));
      if (editingId === recipe.id) resetForm();

      setToast({
        type: 'success',
        message: datos?.mensaje || `La receta «${recipe.nombre}» fue desactivada en PostgreSQL.`,
      });
    } catch (error) {
      setToast({
        type: 'error',
        message: error.message || 'No se pudo eliminar la receta desde PostgreSQL.',
      });
    } finally {
      setEliminandoId(null);
    }
  };

  const recetasFiltradas = recipes.filter((recipe) =>
    `${recipe.nombre || ''} ${recipe.descripcion || ''} ${recipe.categoria || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  return <div className="page-content">
    <PageHeader
      eyebrow="COCINA INTELIGENTE"
      title="Recetario"
      description="Consultá, creá y editá recetas guardadas en PostgreSQL. Las cantidades se guardan por porción."
      action={<Button icon={Plus} onClick={() => {
        if (formOpen) {
          resetForm();
        } else {
          setEditingId(null);
          setForm({ name: '', category: 'Plato principal', description: '', prepMinutes: 45, ingredients: [] });
          setIngredientDraft({ inventoryId: insumos.length ? obtenerIdInsumo(insumos[0]) : '', quantity: '0.1' });
          setModoCantidad('porcion');
          setPorcionesLote('40');
          setErrorFormulario('');
          setFormOpen(true);
        }
      }}>{formOpen ? 'Cerrar formulario' : 'Nueva receta'}</Button>}
    />

    <CalculadoraReceta />

    {errorCarga && <div className="calculadora-error" role="alert">
      <strong>No se pudo cargar el recetario:</strong> {errorCarga}
      <p>Comprobá que el backend siga activo en el puerto 3000 y recargá la página.</p>
    </div>}

    {formOpen && <section ref={formularioRef} className="surface-card form-card">
      <div className="form-card-heading">
        <div>
          <span className="eyebrow">{editingId ? 'EDITAR RECETA' : 'NUEVA RECETA'}</span>
          <h3>{editingId ? 'Actualizar receta e ingredientes' : 'Sumar una receta al recetario'}</h3>
        </div>
        <IconButton icon={X} label="Cerrar formulario" onClick={resetForm} subtle />
      </div>

      <form className="form-grid" onSubmit={submit}>
        <label className="field">
          <span>Nombre de la receta</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Guiso de lentejas" required />
        </label>
        <label className="field">
          <span>Categoría</span>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option>Plato principal</option><option>Desayuno</option><option>Merienda</option><option>Postre</option><option>Panificado</option>
          </select>
        </label>
        <label className="field wide">
          <span>Descripción</span>
          <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Breve descripción del plato" />
        </label>
        <label className="field">
          <span>Tiempo de preparación (min)</span>
          <input type="number" min="1" step="1" value={form.prepMinutes} onChange={(e) => setForm({ ...form, prepMinutes: e.target.value })} required />
        </label>

        <div className="ingredient-builder wide">
          <div className="ingredient-builder-title">
            <strong>Ingredientes de la receta</strong>
            <small>Elegí cómo vas a ingresar la cantidad. La API siempre guarda el equivalente por porción.</small>
          </div>

          <label className="field wide">
            <span>La cantidad que vas a ingresar corresponde a...</span>
            <select value={modoCantidad} onChange={(e) => {
              setModoCantidad(e.target.value);
              setIngredientDraft((actual) => ({ ...actual, quantity: '' }));
              setErrorFormulario('');
            }}>
              <option value="porcion">Una porción / una vianda</option>
              <option value="lote">La cantidad total para una olla o lote</option>
            </select>
          </label>

          {modoCantidad === 'lote' && <>
            <label className="field">
              <span>¿Cuántas porciones rinde esa olla?</span>
              <input type="number" min="1" step="1" value={porcionesLote} onChange={(e) => setPorcionesLote(e.target.value)} required />
            </label>
            <p className="form-help wide">Ejemplo: si una olla lleva 4 kg de fideos y rinde 40 viandas, ingresá 4 kg como cantidad total. El sistema guardará 0,1 kg por porción.</p>
          </>}

          {cargando ? <p className="muted-text">Cargando insumos...</p> : <>
            <p className="form-help wide">Para editar un ingrediente existente, podés cambiar su campo «Cantidad por porción» en la lista. También podés elegirlo arriba y pulsar Agregar para reemplazar su cantidad. No se sumará accidentalmente a la cantidad anterior.</p>
            <div className="ingredient-builder-row">
              <label className="field">
                <span>Ingrediente</span>
                <select value={ingredientDraft.inventoryId} onChange={(e) => setIngredientDraft({ ...ingredientDraft, inventoryId: e.target.value })} disabled={!insumos.length}>
                  {insumos.length ? insumos.map((item) => <option key={obtenerIdInsumo(item)} value={obtenerIdInsumo(item)}>
                    {item.nombre} ({item.unidad_medida})
                  </option>) : <option value="">No hay insumos disponibles</option>}
                </select>
              </label>
              <label className="field quantity-field">
                <span>{modoCantidad === 'lote' ? 'Cantidad total para la olla' : 'Cantidad por porción'}</span>
                <input type="number" step="any" min="0" inputMode="decimal" value={ingredientDraft.quantity} onChange={(e) => setIngredientDraft({ ...ingredientDraft, quantity: e.target.value })} />
              </label>
              <Button type="button" icon={Plus} onClick={addIngredientDraft} disabled={!insumos.length}>Agregar</Button>
            </div>

            {form.ingredients.length ? <div className="builder-ingredient-list">
              <div className="form-help">Las cantidades de esta lista siempre se expresan por porción. Podés corregirlas directamente al editar una receta.</div>
              {form.ingredients.map((ingredient) => {
                const item = buscarInsumo(ingredient.inventoryId);
                return <div className="builder-ingredient" key={ingredient.inventoryId}>
                  <span>{item?.nombre || 'Insumo no disponible'}</span>
                  <label className="field quantity-field">
                    <span>Cantidad por porción ({item?.unidad_medida || 'unidad'})</span>
                    <input type="number" min="0" step="any" inputMode="decimal" value={ingredient.quantity} onChange={(e) => updateIngredientQuantity(ingredient.inventoryId, e.target.value)} required />
                  </label>
                  <IconButton icon={X} label="Quitar ingrediente" onClick={() => setForm((actual) => ({ ...actual, ingredients: actual.ingredients.filter((i) => String(i.inventoryId) !== String(ingredient.inventoryId)) }))} subtle danger />
                </div>;
              })}
            </div> : <p className="builder-empty">Todavía no agregaste ingredientes.</p>}
          </>}
        </div>

        {errorFormulario && <div className="calculadora-error wide" role="alert">{errorFormulario}</div>}

        <div className="form-actions wide">
          <Button type="button" variant="secondary" onClick={resetForm} disabled={guardando}>Cancelar</Button>
          <Button type="submit" icon={CheckCircle2} disabled={guardando || cargando || !insumos.length}>
            {guardando ? (editingId ? 'Actualizando en PostgreSQL...' : 'Guardando en PostgreSQL...') : (editingId ? 'Guardar cambios en PostgreSQL' : 'Guardar receta en PostgreSQL')}
          </Button>
        </div>
      </form>
    </section>}

    {cargando ? <div className="surface-card"><p className="muted-text">Cargando recetas desde PostgreSQL...</p></div> : recetasFiltradas.length ? <>
      <div className="recipe-grid">
        {recetasFiltradas.map((recipe, index) => <article className="recipe-card surface-card" key={recipe.id}>
          <div className={`recipe-card-art art-${index % 3}`}>
            <span className="recipe-category">{recipe.categoria || 'Receta'}</span>
            <span className="recipe-art-icon"><CookingPot size={34} strokeWidth={1.35} /></span>
            <div className="recipe-art-decoration decoration-one" /><div className="recipe-art-decoration decoration-two" /><div className="recipe-art-lines">♡　✳　♡</div>
          </div>
          <div className="recipe-card-body">
            <div className="recipe-title-row">
              <h3>{recipe.nombre}</h3>
              <div className="recipe-card-actions">
                <IconButton icon={Pencil} label={`Editar ${recipe.nombre}`} subtle onClick={() => startEdit(recipe)} disabled={guardando || Boolean(eliminandoId)} />
                <IconButton
                  icon={Trash2}
                  label={eliminandoId === recipe.id ? `Eliminando ${recipe.nombre}` : `Eliminar ${recipe.nombre}`}
                  subtle
                  danger
                  disabled={guardando || Boolean(eliminandoId)}
                  onClick={() => eliminarReceta(recipe)}
                />
              </div>
            </div>
            <p>{recipe.descripcion || 'Una receta de la fundación para compartir en comunidad.'}</p>
            <div className="recipe-stats">
              <span><Clock3 size={14} /> {recipe.minutos_preparacion || '—'} min</span>
              <span><Boxes size={14} /> {(recipe.ingredientes || []).length} ingredientes</span>
            </div>
            <div className="recipe-ingredients">
              <strong>Por porción</strong>
              <div className="recipe-ingredient-lines">
                {(recipe.ingredientes || []).slice(0, 3).map((ingredient) => <span key={ingredient.insumo_id}>
                  {ingredient.nombre} <b>{formatNumber(ingredient.cantidad_por_porcion)} {ingredient.unidad_medida}</b>
                </span>)}
                {(recipe.ingredientes || []).length > 3 && <small>+ {recipe.ingredientes.length - 3} ingredientes más</small>}
              </div>
            </div>
            <button className="recipe-calculate" onClick={() => setToast({ type: 'success', message: `La receta ${recipe.nombre} está disponible en el recetario inteligente.` })}>
              Usar en una jornada <ArrowRight size={15} />
            </button>
          </div>
        </article>)}
      </div>
      <p className="muted-text">Las recetas y sus ingredientes se consultan en PostgreSQL. Las altas usan POST, las modificaciones PUT y la eliminación DELETE. Al eliminar, la receta se desactiva para conservar el historial de jornadas.</p>
    </> : <EmptyState icon={ChefHat} title="Todavía no hay recetas para mostrar" description="Creá una receta y vinculá los ingredientes existentes en PostgreSQL." action={<Button icon={Plus} onClick={() => setFormOpen(true)}>Nueva receta</Button>} />}
  </div>;
}

function InventoryPage({ inventory, loading, error, onReload, onAddItem, onAdjustStock, onViewMovements, setToast, search }) {
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({ name: '', category: 'Almacén', quantity: '0', unit: 'kg', minimum: '1', expiration: '' });
  const [filter, setFilter] = useState('all');
  const [movimientosObjetivo, setMovimientosObjetivo] = useState(null);
  const [movimientos, setMovimientos] = useState([]);
  const [cargandoMovimientos, setCargandoMovimientos] = useState(false);
  const [errorMovimientos, setErrorMovimientos] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [movimientoEnCurso, setMovimientoEnCurso] = useState('');

  const inventoryFiltrado = inventory
    .filter((item) => (filter === 'all' || (filter === 'low' && isLowStock(item)) || (filter === 'expiring' && (Number(item.expiredQuantity || 0) > 0 || Number(item.expiringTodayQuantity || 0) > 0 || isExpiringSoon(item) || (item.expiration && daysUntil(item.expiration) < 0)))) && `${item.name} ${item.category} ${item.unit}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const stockBajo = inventory.filter(isLowStock).length;
  const porVencer = inventory.filter((item) => Number(item.expiredQuantity || 0) > 0 || Number(item.expiringTodayQuantity || 0) > 0 || isExpiringSoon(item) || (item.expiration && daysUntil(item.expiration) < 0)).length;

  const reiniciarFormulario = () => {
    setForm({ name: '', category: 'Almacén', quantity: '0', unit: 'kg', minimum: '1', expiration: '' });
    setFormOpen(false);
  };

  const submit = async (event) => {
    event.preventDefault();
    const cantidad = Number(form.quantity);
    const minimo = Number(form.minimum);
    if (!form.name.trim()) {
      setToast({ type: 'error', message: 'Ingresá el nombre del producto.' });
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad < 0 || !Number.isFinite(minimo) || minimo < 0) {
      setToast({ type: 'error', message: 'Las cantidades no pueden ser negativas.' });
      return;
    }
    if (Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 0.000001 || Math.abs(minimo * 1000 - Math.round(minimo * 1000)) > 0.000001) {
      setToast({ type: 'error', message: 'Usá como máximo tres decimales para las cantidades.' });
      return;
    }
    if (cantidad === 0 && form.expiration) {
      setToast({ type: 'error', message: 'Para registrar un vencimiento, ingresá una cantidad inicial mayor que cero.' });
      return;
    }

    setGuardando(true);
    try {
      await onAddItem({ ...form, name: form.name.trim(), quantity: cantidad, minimum: minimo });
      reiniciarFormulario();
      setToast({ type: 'success', message: 'Insumo registrado en PostgreSQL.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo registrar el insumo.' });
    } finally {
      setGuardando(false);
    }
  };

  const ajustar = async (item, amount) => {
    const llave = `${item.id}:${amount}`;
    setMovimientoEnCurso(llave);
    try {
      await onAdjustStock(item.id, amount);
      setToast({ type: 'success', message: `Ajuste de stock registrado en PostgreSQL para ${item.name}.` });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo ajustar el stock.' });
    } finally {
      setMovimientoEnCurso('');
    }
  };

  const abrirMovimientos = async (item) => {
    setMovimientosObjetivo(item);
    setMovimientos([]);
    setErrorMovimientos('');
    setCargandoMovimientos(true);
    try {
      const lista = await onViewMovements(item.id);
      setMovimientos(lista);
    } catch (err) {
      setErrorMovimientos(err.message || 'No se pudo cargar el historial.');
    } finally {
      setCargandoMovimientos(false);
    }
  };

  return <div className="page-content">
    <PageHeader eyebrow="CONTROL DE ALIMENTOS" title="Inventario" description="Consultá las existencias reales, registrá altas y ajustes, y revisá el historial de movimientos en PostgreSQL." action={<Button icon={PackagePlus} onClick={() => setFormOpen((actual) => !actual)}>{formOpen ? 'Cerrar formulario' : 'Agregar producto'}</Button>} />

    <div className="inventory-summary-grid">
      <div className="inventory-summary-card"><span className="inventory-summary-icon green"><Boxes size={19} /></span><div><small>Productos registrados</small><strong>{inventory.length}</strong></div></div>
      <div className="inventory-summary-card"><span className="inventory-summary-icon amber"><AlertTriangle size={19} /></span><div><small>Con stock bajo</small><strong>{stockBajo}</strong></div></div>
      <div className="inventory-summary-card"><span className="inventory-summary-icon rose"><CalendarClock size={19} /></span><div><small>Vencidos o próximos a vencer</small><strong>{porVencer}</strong></div></div>
    </div>

    {error && <div className="calculadora-error" role="alert"><strong>No se pudo cargar el inventario:</strong> {error}<p>Verificá que el backend esté activo y que la ruta /api/insumos esté registrada.</p><Button type="button" variant="secondary" onClick={onReload}>Reintentar consulta</Button></div>}

    {formOpen && <section className="surface-card form-card">
      <div className="form-card-heading"><div><span className="eyebrow">ALTA DE PRODUCTO</span><h3>Registrar alimento o insumo en PostgreSQL</h3><p className="muted-text">Si ingresás cantidad inicial, se crea un lote y un movimiento de stock inicial.</p></div><IconButton icon={X} label="Cerrar formulario" onClick={reiniciarFormulario} subtle /></div>
      <form className="form-grid" onSubmit={submit}>
        <label className="field"><span>Nombre del producto</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Harina" required maxLength={120} /></label>
        <label className="field"><span>Categoría</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}><option>Almacén</option><option>Cereales</option><option>Legumbres</option><option>Verduras</option><option>Frutas</option><option>Proteínas</option><option>Conservas</option><option>Descartables</option><option>Lácteos</option><option>Otros</option></select></label>
        <label className="field"><span>Cantidad inicial</span><input type="number" min="0" step="0.001" inputMode="decimal" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required /></label>
        <label className="field"><span>Unidad</span><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })}><option value="kg">kg</option><option value="g">g</option><option value="L">L</option><option value="ml">ml</option><option value="unid.">unidades</option><option value="cajas">cajas</option><option value="paquetes">paquetes</option></select></label>
        <label className="field"><span>Stock mínimo de alerta</span><input type="number" min="0" step="0.001" inputMode="decimal" value={form.minimum} onChange={(e) => setForm({ ...form, minimum: e.target.value })} required /></label>
        <label className="field"><span>Fecha de vencimiento (opcional)</span><input type="date" value={form.expiration} onChange={(e) => setForm({ ...form, expiration: e.target.value })} /></label>
        <div className="form-actions wide"><Button type="button" variant="secondary" onClick={reiniciarFormulario} disabled={guardando}>Cancelar</Button><Button type="submit" icon={PackagePlus} disabled={guardando}>{guardando ? 'Guardando en PostgreSQL...' : 'Guardar producto'}</Button></div>
      </form>
    </section>}

    <section className="surface-card inventory-table-card">
      <div className="table-toolbar"><div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todos <span>{inventory.length}</span></button><button className={filter === 'low' ? 'active' : ''} onClick={() => setFilter('low')}>Stock bajo <span>{stockBajo}</span></button><button className={filter === 'expiring' ? 'active' : ''} onClick={() => setFilter('expiring')}>Vencimientos</button></div><span className="table-count">{inventoryFiltrado.length} productos · PostgreSQL</span></div>
      {loading ? <div className="empty-state"><span className="empty-icon"><Package size={24} /></span><h3>Cargando inventario...</h3><p>Consultando las existencias de PostgreSQL.</p></div> : inventoryFiltrado.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Stock total / utilizable</th><th>Stock mínimo</th><th>Próximo vencimiento</th><th>Estado</th><th className="actions-column">Movimientos</th></tr></thead><tbody>{inventoryFiltrado.map((item) => {
        const hayLotesVencidos = Number(item.expiredQuantity || 0) > 0;
        const vencido = hayLotesVencidos && Number(item.usableQuantity ?? item.quantity) <= 0.000001;
        const expira = isExpiringSoon(item);
        const bajo = isLowStock(item);
        const montoDescontar = item.unit === 'unid.' ? Math.min(1, Number(item.quantity)) : Math.min(0.5, Number(item.quantity));
        const montoAgregar = item.unit === 'unid.' ? 10 : 1;
        return <tr key={item.id}>
          <td><div className="product-cell"><span className="product-icon"><Package size={17} /></span><span><strong>{item.name}</strong><small>Actualizado {formatDate(item.updatedAt || todayISO())}</small></span></div></td>
          <td><span className="category-label">{item.category}</span></td>
          <td><strong className={bajo ? 'number-warning' : ''}>Total: {formatNumber(item.quantity)} <span className="unit-text">{item.unit}</span></strong><small style={{ display: 'block', marginTop: '3px' }}>Utilizable: {formatNumber(item.usableQuantity ?? item.quantity)} {item.unit}</small>{hayLotesVencidos && <small className="number-warning" style={{ display: 'block' }}>Vencido: {formatNumber(item.expiredQuantity)} {item.unit}</small>}</td>
          <td>{formatNumber(item.minimum)} <span className="unit-text">{item.unit}</span></td>
          <td>{item.expiration ? <span className={vencido || expira ? 'date-warning' : ''}>{formatDate(item.expiration)}</span> : <span className="muted-text">Sin fecha registrada</span>}</td>
          <td>{vencido ? <StatusPill tone="rose">Sin stock utilizable</StatusPill> : hayLotesVencidos ? <StatusPill tone="rose">Hay lotes vencidos</StatusPill> : item.expiringTodayQuantity > 0 ? <StatusPill tone="amber">Vence hoy</StatusPill> : expira ? <StatusPill tone="amber">Por vencer</StatusPill> : bajo ? <StatusPill tone="amber">Stock bajo</StatusPill> : <StatusPill tone="green">Disponible</StatusPill>}</td>
          <td><div className="stock-adjust-actions">
            <IconButton icon={ArrowDownRight} label={`Descontar ${formatNumber(montoDescontar)} ${item.unit}`} subtle disabled={Number(item.quantity) <= 0 || movimientoEnCurso.startsWith(`${item.id}:`)} onClick={() => ajustar(item, -montoDescontar)} />
            <IconButton icon={Plus} label={`Agregar ${formatNumber(montoAgregar)} ${item.unit}`} subtle disabled={movimientoEnCurso.startsWith(`${item.id}:`)} onClick={() => ajustar(item, montoAgregar)} />
            <IconButton icon={Clock3} label={`Ver movimientos de ${item.name}`} subtle onClick={() => abrirMovimientos(item)} />
          </div></td>
        </tr>;
      })}</tbody></table></div> : <EmptyState icon={Package} title="No hay productos para mostrar" description={inventory.length ? 'Probá otro filtro o término de búsqueda.' : 'Todavía no hay insumos activos en PostgreSQL.'} action={<Button icon={PackagePlus} onClick={() => setFormOpen(true)}>Agregar producto</Button>} />}
      <div className="table-footer"><span><CircleHelp size={14} /> Las altas y los ajustes se guardan como movimientos auditables en PostgreSQL.</span><button onClick={() => { const csv = ['Producto,Categoría,Cantidad,Unidad,Mínimo,Vencimiento', ...inventory.map((item) => [item.name, item.category, item.quantity, item.unit, item.minimum, item.expiration].map((v) => `"${String(v ?? '').replaceAll('"', '""')}"`).join(','))].join('\n'); const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'inventario-vivir-para-servir.csv'; a.click(); URL.revokeObjectURL(url); }}><Download size={14} /> Exportar CSV</button></div>
    </section>

    {movimientosObjetivo && <Modal title={`Historial de movimientos: ${movimientosObjetivo.name}`} description="Los movimientos se conservan como auditoría; no se editan ni se eliminan." onClose={() => setMovimientosObjetivo(null)}>
      {cargandoMovimientos ? <p className="muted-text">Cargando movimientos desde PostgreSQL...</p> : errorMovimientos ? <div className="calculadora-error" role="alert">{errorMovimientos}</div> : movimientos.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Variación</th><th>Lote</th><th>Vencimiento del lote</th><th>Observaciones</th></tr></thead><tbody>{movimientos.map((m) => {
        const cantidad = Number(m.variacion_cantidad);
        const fechaHora = m.creado_en ? new Date(m.creado_en) : null;
        return <tr key={m.id}><td>{fechaHora && !Number.isNaN(fechaHora.getTime()) ? `${fechaHora.toLocaleDateString('es-AR')} ${fechaHora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}` : 'Sin fecha'}</td><td>{String(m.tipo_movimiento || '').replaceAll('_', ' ')}</td><td className={cantidad >= 0 ? 'calculadora-disponible' : 'calculadora-faltante'}>{cantidad > 0 ? '+' : ''}{formatearCantidad(cantidad)} {m.unidad_medida || movimientosObjetivo.unit}</td><td>{m.codigo_lote || '—'}</td><td>{m.fecha_vencimiento ? formatDate(String(m.fecha_vencimiento).slice(0, 10)) : 'Sin vencimiento'}</td><td>{m.observaciones || '—'}</td></tr>;
      })}</tbody></table></div> : <EmptyState icon={ClipboardList} title="Sin movimientos registrados" description="Los ingresos iniciales y los ajustes nuevos aparecerán en este historial." />}
      <div className="modal-actions"><Button variant="secondary" onClick={() => setMovimientosObjetivo(null)}>Cerrar</Button></div>
    </Modal>}
  </div>;
}

function DonacionesPage({ donaciones, loading, error, onReload, inventory, inventoryLoading, onReceiveDonation, setToast, search }) {
  const [formOpen, setFormOpen] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [filter, setFilter] = useState('all');
  const [detalle, setDetalle] = useState(null);
  const [form, setForm] = useState({ nombre_donante: '', contacto_donante: '', fecha_recepcion: todayISO(), observaciones: '', tipo_donacion: 'alimentos', monto_dinero: '0' });
  const requiereAlimentos = form.tipo_donacion === 'alimentos' || form.tipo_donacion === 'mixta';
  const nuevaLinea = () => ({
    id: createId('donacion-linea'),
    insumo_id: inventory[0]?.id || '',
    cantidad: '1',
    codigo_lote: '',
    fecha_vencimiento: '',
    costo_unitario: '',
    observaciones: '',
  });
  const [lineas, setLineas] = useState([]);

  const abrirFormulario = () => {
    if (formOpen) {
      setFormOpen(false);
      return;
    }
    setForm({ nombre_donante: '', contacto_donante: '', fecha_recepcion: todayISO(), observaciones: '', tipo_donacion: 'alimentos', monto_dinero: '0' });
    setLineas([nuevaLinea()]);
    setFormOpen(true);
  };

  const cambiarTipoDonacion = (tipo) => {
    setForm((actual) => ({
      ...actual,
      tipo_donacion: tipo,
      monto_dinero: tipo === 'alimentos' ? '0' : actual.monto_dinero,
    }));
    if (tipo === 'dinero') {
      setLineas([]);
    } else {
      setLineas((actuales) => actuales.length ? actuales : [nuevaLinea()]);
    }
  };

  const actualizarLinea = (id, cambios) => {
    setLineas((actuales) => actuales.map((linea) => linea.id === id ? { ...linea, ...cambios } : linea));
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.nombre_donante.trim()) {
      setToast({ type: 'error', message: 'Ingresá el nombre de la persona u organización donante.' });
      return;
    }
    if (!form.fecha_recepcion || form.fecha_recepcion > todayISO()) {
      setToast({ type: 'error', message: 'La fecha de recepción debe ser válida y no puede estar en el futuro.' });
      return;
    }

    const monto = form.monto_dinero.trim() === '' ? 0 : parseNumeroArgentino(form.monto_dinero);
    if (!Number.isFinite(monto) || monto < 0 || monto > 9999999999.99 || Math.abs(monto * 100 - Math.round(monto * 100)) > 0.000001) {
      setToast({ type: 'error', message: 'El importe monetario debe ser cero o mayor y tener hasta dos decimales.' });
      return;
    }
    if (!['alimentos', 'dinero', 'mixta'].includes(form.tipo_donacion)) {
      setToast({ type: 'error', message: 'Elegí un tipo de donación válido.' });
      return;
    }
    if (form.tipo_donacion === 'alimentos' && monto !== 0) {
      setToast({ type: 'error', message: 'Para una donación de alimentos, el importe monetario debe ser cero.' });
      return;
    }
    if (form.tipo_donacion === 'dinero' && monto <= 0) {
      setToast({ type: 'error', message: 'Ingresá un importe mayor que cero para la donación de dinero.' });
      return;
    }
    if (form.tipo_donacion === 'mixta' && monto <= 0) {
      setToast({ type: 'error', message: 'Para una donación mixta, ingresá también el importe de dinero.' });
      return;
    }
    if (requiereAlimentos && (lineas.length < 1 || lineas.length > 50)) {
      setToast({ type: 'error', message: 'Agregá al menos un alimento y no más de 50.' });
      return;
    }
    if (form.tipo_donacion === 'dinero' && lineas.length > 0) {
      setToast({ type: 'error', message: 'Una donación solo de dinero no debe contener renglones de alimentos.' });
      return;
    }

    for (let indice = 0; indice < lineas.length; indice += 1) {
      const linea = lineas[indice];
      const cantidad = Number(linea.cantidad);
      if (!linea.insumo_id) {
        setToast({ type: 'error', message: `Elegí un insumo en el renglón ${indice + 1}.` });
        return;
      }
      if (!Number.isFinite(cantidad) || cantidad <= 0 || Math.abs(cantidad * 1000 - Math.round(cantidad * 1000)) > 0.000001) {
        setToast({ type: 'error', message: `La cantidad del renglón ${indice + 1} debe ser mayor que cero y tener hasta tres decimales.` });
        return;
      }
      if (linea.fecha_vencimiento && linea.fecha_vencimiento < form.fecha_recepcion) {
        setToast({ type: 'error', message: `El vencimiento del renglón ${indice + 1} no puede ser anterior a la fecha de recepción.` });
        return;
      }
      const costoUnitario = linea.costo_unitario.trim() === '' ? null : parseNumeroArgentino(linea.costo_unitario);
      if (linea.costo_unitario.trim() !== '' && (!Number.isFinite(costoUnitario) || costoUnitario < 0 || Math.abs(costoUnitario * 100 - Math.round(costoUnitario * 100)) > 0.000001)) {
        setToast({ type: 'error', message: `Revisá el costo unitario del renglón ${indice + 1}. Usá un importe como 1500 o 1.500,00, con hasta dos decimales.` });
        return;
      }
    }

    setGuardando(true);
    try {
      const resultado = await onReceiveDonation({
        nombre_donante: form.nombre_donante.trim(),
        contacto_donante: form.contacto_donante.trim() || null,
        fecha_recepcion: form.fecha_recepcion,
        observaciones: form.observaciones.trim() || null,
        tipo_donacion: form.tipo_donacion,
        monto_dinero: form.tipo_donacion === 'alimentos' ? 0 : monto,
        moneda: 'ARS',
        items: requiereAlimentos ? lineas.map((linea) => ({
          insumo_id: linea.insumo_id,
          cantidad: Number(linea.cantidad),
          codigo_lote: linea.codigo_lote.trim() || null,
          fecha_vencimiento: linea.fecha_vencimiento || null,
          costo_unitario: linea.costo_unitario.trim() === '' ? null : parseNumeroArgentino(linea.costo_unitario),
          observaciones: linea.observaciones.trim() || null,
        })) : [],
      });
      setFormOpen(false);
      setToast({ type: 'success', message: resultado?.mensaje || 'La donación quedó registrada en PostgreSQL.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo registrar la donación.' });
    } finally {
      setGuardando(false);
    }
  };
  const donacionesFiltradas = donaciones.filter((donacion) => {
    const items = Array.isArray(donacion.items) ? donacion.items : [];
    const texto = `${donacion.nombre_donante || ''} ${donacion.contacto_donante || ''} ${donacion.fecha_recepcion || ''} ${donacion.estado || ''} ${donacion.tipo_donacion || 'alimentos'} ${donacion.monto_dinero || ''} ${donacion.observaciones || ''} ${items.map((item) => `${item.nombre_insumo || ''} ${item.codigo_lote || ''}`).join(' ')}`.toLowerCase();
    return (filter === 'all' || donacion.estado === filter) && texto.includes(search.toLowerCase());
  });
  const totalLotes = donaciones.reduce((sum, donacion) => sum + (Array.isArray(donacion.items) ? donacion.items.length : 0), 0);
  const totalLotesConVencimiento = donaciones.reduce((sum, donacion) => sum + (Array.isArray(donacion.items) ? donacion.items.filter((item) => item.fecha_vencimiento).length : 0), 0);
  const totalDineroRecibido = donaciones.filter((donacion) => donacion.estado === 'recibida').reduce((sum, donacion) => sum + (Number(donacion.monto_dinero) || 0), 0);
  const tipoDonacionLabel = (tipo) => ({ alimentos: 'Alimentos', dinero: 'Dinero', mixta: 'Alimentos y dinero' }[tipo] || 'Alimentos');
  const formatoAlimentos = (donacion) => {
    const items = Array.isArray(donacion.items) ? donacion.items : [];
    if (!items.length) return donacion.tipo_donacion === 'dinero' ? 'Sin alimentos (aporte monetario)' : 'Sin lotes asociados';
    return items.map((item) => `${item.nombre_insumo || 'Insumo'}: ${formatearCantidad(item.cantidad_original)} ${item.unidad_medida || ''}`).join(' · ');
  };

  return <div className="page-content">
    <PageHeader eyebrow="INGRESO Y TRAZABILIDAD" title="Donaciones" description="Registrá aportes de alimentos, dinero o ambos, con trazabilidad en PostgreSQL." action={<Button icon={Plus} onClick={abrirFormulario}>{formOpen ? 'Cerrar formulario' : 'Registrar donación'}</Button>} />

    <div className="inventory-summary-grid">
      <div className="inventory-summary-card"><span className="inventory-summary-icon green"><HandHeart size={19} /></span><div><small>Donaciones registradas</small><strong>{donaciones.length}</strong></div></div>
      <div className="inventory-summary-card"><span className="inventory-summary-icon blue"><Package size={19} /></span><div><small>Lotes asociados</small><strong>{totalLotes}</strong></div></div>
      <div className="inventory-summary-card"><span className="inventory-summary-icon amber"><CalendarClock size={19} /></span><div><small>Lotes con vencimiento informado</small><strong>{totalLotesConVencimiento}</strong></div></div>
      <div className="inventory-summary-card"><span className="inventory-summary-icon green"><HandHeart size={19} /></span><div><small>Aportes monetarios recibidos</small><strong>{formatearPesos(totalDineroRecibido)}</strong></div></div>
    </div>

    <section className="surface-card data-note-card" style={{ marginBottom: 18 }}>
      <div className="data-note-icon"><ShieldCheck size={22} /></div>
      <div><h3>¿Qué pasa al registrar una donación?</h3><p>Los alimentos recibidos generan lotes y movimientos positivos de inventario. Los aportes monetarios se registran en pesos argentinos (ARS) y no modifican el stock. Podés registrar una donación de alimentos, de dinero o mixta. Esta pantalla registra aportes ya recibidos, no promesas.</p></div>
    </section>

    {error && <div className="calculadora-error" role="alert"><strong>No se pudo consultar el historial de donaciones:</strong> {error}<p>Comprobá que el backend esté activo y que la ruta /api/donaciones esté registrada en server.js.</p><Button variant="secondary" onClick={onReload}>Reintentar consulta</Button></div>}

    {formOpen && <section className="surface-card form-card">
      <div className="form-card-heading"><div><span className="eyebrow">NUEVA DONACIÓN</span><h3>Datos de la donación</h3><p className="muted-text">Elegí si el aporte es de alimentos, dinero o ambos. El stock solo cambia si se reciben alimentos.</p></div><IconButton icon={X} label="Cerrar formulario" onClick={() => setFormOpen(false)} subtle /></div>
      <form className="form-grid" onSubmit={submit}>
        <label className="field"><span>Nombre del donante</span><input value={form.nombre_donante} onChange={(e) => setForm({ ...form, nombre_donante: e.target.value })} maxLength={160} placeholder="Ej. Almacén del barrio" required /></label>
        <label className="field"><span>Contacto del donante (opcional)</span><input value={form.contacto_donante} onChange={(e) => setForm({ ...form, contacto_donante: e.target.value })} maxLength={160} placeholder="Teléfono, correo u otro contacto" /></label>
        <label className="field"><span>Fecha de recepción</span><input type="date" value={form.fecha_recepcion} max={todayISO()} onChange={(e) => setForm({ ...form, fecha_recepcion: e.target.value })} required /></label>
        <label className="field"><span>Observaciones generales (opcional)</span><input value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} placeholder="Ej. Donación coordinada por teléfono" /></label>
        <label className="field"><span>Tipo de donación</span><select value={form.tipo_donacion} onChange={(e) => cambiarTipoDonacion(e.target.value)}><option value="alimentos">Alimentos</option><option value="dinero">Dinero</option><option value="mixta">Alimentos y dinero</option></select></label>
        {form.tipo_donacion !== 'alimentos' ? <label className="field"><span>Importe recibido (pesos argentinos, ARS)</span><input type="text" inputMode="decimal" autoComplete="off" value={form.monto_dinero} onChange={(e) => setForm({ ...form, monto_dinero: e.target.value })} placeholder="Ej. 1500 o 1.500,00" required /><small className="muted-text">Podés escribir 1500 o 1.500,00. Usá coma para los centavos.</small></label> : <div className="field"><span>Aporte monetario</span><div className="surface-card" style={{ padding: '10px 12px', minHeight: 42 }}>No corresponde: esta donación es solo de alimentos.</div></div>}

        {requiereAlimentos ? <><div className="wide" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginTop: 4 }}><div><h3 style={{ margin: 0 }}>Alimentos recibidos</h3><p className="muted-text" style={{ margin: '4px 0 0' }}>Indicá la cantidad en la unidad que muestra el inventario.</p></div><Button type="button" variant="secondary" icon={Plus} disabled={inventoryLoading || !inventory.length || lineas.length >= 50 || guardando} onClick={() => setLineas((actuales) => [...actuales, nuevaLinea()])}>Agregar alimento</Button></div>

        {!inventoryLoading && inventory.length === 0 && <div className="calculadora-error wide">No hay insumos activos para elegir. Primero registrá el producto desde Inventario.</div>}
        {inventoryLoading && <p className="muted-text wide">Cargando catálogo de insumos desde PostgreSQL...</p>}

        {lineas.map((linea, indice) => {
          const insumoElegido = inventory.find((item) => item.id === linea.insumo_id);
          return <section key={linea.id} className="wide surface-card" style={{ padding: 15, display: 'grid', gap: 12, border: '1px solid var(--border, #e5e7eb)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}><strong>Alimento {indice + 1}</strong><IconButton icon={Trash2} label={`Quitar alimento ${indice + 1}`} subtle danger disabled={lineas.length <= 1 || guardando} onClick={() => setLineas((actuales) => actuales.filter((item) => item.id !== linea.id))} /></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              <label className="field"><span>Insumo</span><select value={linea.insumo_id} onChange={(e) => actualizarLinea(linea.id, { insumo_id: e.target.value })} required><option value="">Elegí un insumo</option>{inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.unit})</option>)}</select></label>
              <label className="field"><span>Cantidad recibida ({insumoElegido?.unit || 'unidad'})</span><input type="number" min="0.001" step="0.001" value={linea.cantidad} onChange={(e) => actualizarLinea(linea.id, { cantidad: e.target.value })} required /></label>
              <label className="field"><span>Código de lote (opcional)</span><input value={linea.codigo_lote} onChange={(e) => actualizarLinea(linea.id, { codigo_lote: e.target.value })} maxLength={80} placeholder="Si figura en el envase" /></label>
              <label className="field"><span>Fecha de vencimiento (opcional)</span><input type="date" min={form.fecha_recepcion || undefined} value={linea.fecha_vencimiento} onChange={(e) => actualizarLinea(linea.id, { fecha_vencimiento: e.target.value })} /></label>
              <label className="field"><span>Costo por unidad en ARS (opcional)</span><input type="text" inputMode="decimal" autoComplete="off" value={linea.costo_unitario} onChange={(e) => actualizarLinea(linea.id, { costo_unitario: e.target.value })} placeholder="Ej. 1500 o 1.500,00" /><small className="muted-text">Podés escribir 1500 o 1.500,00. Usá coma para los centavos.</small></label>
              <label className="field"><span>Observaciones del lote (opcional)</span><input value={linea.observaciones} onChange={(e) => actualizarLinea(linea.id, { observaciones: e.target.value })} placeholder="Marca, presentación o estado" /></label>
            </div>
          </section>;
        })}</> : <div className="wide surface-card" style={{ padding: 15, border: '1px solid var(--border, #e5e7eb)' }}><h3 style={{ marginTop: 0 }}>Donación monetaria</h3><p className="muted-text" style={{ marginBottom: 0 }}>Este aporte se registrará en ARS y no creará lotes ni modificará el inventario.</p></div>}

        <div className="form-actions wide"><Button type="button" variant="secondary" disabled={guardando} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" icon={PackagePlus} disabled={guardando || (requiereAlimentos && (inventoryLoading || !inventory.length))}>{guardando ? 'Registrando donación...' : form.tipo_donacion === 'dinero' ? 'Registrar donación monetaria' : form.tipo_donacion === 'mixta' ? 'Registrar donación mixta y actualizar stock' : 'Confirmar donación y actualizar stock'}</Button></div>
      </form>
    </section>}

    <section className="surface-card inventory-table-card">
      <div className="table-toolbar"><div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <span>{donaciones.length}</span></button><button className={filter === 'recibida' ? 'active' : ''} onClick={() => setFilter('recibida')}>Recibidas <span>{donaciones.filter((d) => d.estado === 'recibida').length}</span></button><button className={filter === 'cancelada' ? 'active' : ''} onClick={() => setFilter('cancelada')}>Canceladas <span>{donaciones.filter((d) => d.estado === 'cancelada').length}</span></button></div><div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><span className="table-count">{donacionesFiltradas.length} donaciones · PostgreSQL</span><IconButton icon={RotateCcw} label="Actualizar historial" subtle onClick={onReload} /></div></div>
      {loading ? <div className="empty-state"><span className="empty-icon"><HandHeart size={24} /></span><h3>Cargando donaciones...</h3><p>Consultando registros y lotes asociados en PostgreSQL.</p></div> : donacionesFiltradas.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Donante</th><th>Fecha</th><th>Tipo</th><th>Alimentos recibidos</th><th>Aporte monetario</th><th>Contacto</th><th>Estado</th><th>Detalle</th></tr></thead><tbody>{donacionesFiltradas.map((donacion) => <tr key={donacion.id}>
        <td><div className="product-cell"><span className="product-icon"><HandHeart size={17} /></span><span><strong>{donacion.nombre_donante}</strong><small>{Array.isArray(donacion.items) ? donacion.items.length : 0} lotes asociados</small></span></div></td>
        <td>{formatDate(String(donacion.fecha_recepcion || '').slice(0, 10))}</td>
        <td><StatusPill tone={donacion.tipo_donacion === 'dinero' ? 'blue' : donacion.tipo_donacion === 'mixta' ? 'amber' : 'green'}>{tipoDonacionLabel(donacion.tipo_donacion)}</StatusPill></td>
        <td style={{ minWidth: 220, maxWidth: 380 }}><span>{formatoAlimentos(donacion)}</span></td>
        <td>{Number(donacion.monto_dinero) > 0 ? formatearPesos(donacion.monto_dinero) : <span className="muted-text">—</span>}</td>
        <td>{donacion.contacto_donante || <span className="muted-text">Sin contacto</span>}</td>
        <td>{donacion.estado === 'recibida' ? <StatusPill tone="green">Recibida</StatusPill> : donacion.estado === 'cancelada' ? <StatusPill tone="rose">Cancelada</StatusPill> : <StatusPill tone="blue">Registrada</StatusPill>}</td>
        <td><Button variant="secondary" onClick={() => setDetalle(donacion)}>Ver detalle</Button></td>
      </tr>)}</tbody></table></div> : <EmptyState icon={HandHeart} title="No hay donaciones para mostrar" description={donaciones.length ? 'Probá otro término en el buscador o cambiá el filtro.' : 'Cuando registres una recepción, aparecerá en este historial.'} action={<Button icon={Plus} onClick={abrirFormulario}>Registrar recepción</Button>} />}
      <div className="table-footer"><span><CircleHelp size={14} /> Los lotes y movimientos de recepción se guardan en una sola transacción. No se editan ni se borran desde esta pantalla.</span></div>
    </section>

    {detalle && <Modal title={`Donación de ${detalle.nombre_donante}`} description={`Fecha: ${formatDate(String(detalle.fecha_recepcion || '').slice(0, 10))} · Tipo: ${tipoDonacionLabel(detalle.tipo_donacion)} · Estado: ${detalle.estado || 'sin estado'}`} onClose={() => setDetalle(null)} size="large">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 18 }}><div className="surface-card" style={{ padding: 14 }}><small className="muted-text">Tipo de donación</small><p style={{ margin: '5px 0 0' }}>{tipoDonacionLabel(detalle.tipo_donacion)}</p></div><div className="surface-card" style={{ padding: 14 }}><small className="muted-text">Aporte monetario</small><p style={{ margin: '5px 0 0', fontWeight: 650 }}>{Number(detalle.monto_dinero) > 0 ? formatearPesos(detalle.monto_dinero) : 'Sin aporte monetario'}</p></div><div className="surface-card" style={{ padding: 14 }}><small className="muted-text">Contacto</small><p style={{ margin: '5px 0 0' }}>{detalle.contacto_donante || 'Sin contacto registrado'}</p></div><div className="surface-card" style={{ padding: 14 }}><small className="muted-text">Observaciones generales</small><p style={{ margin: '5px 0 0' }}>{detalle.observaciones || 'Sin observaciones'}</p></div></div>
      {(Array.isArray(detalle.items) ? detalle.items : []).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Insumo</th><th>Lote</th><th>Cantidad recibida</th><th>Stock actual del lote</th><th>Costo unitario</th><th>Valor referencial recibido</th><th>Vencimiento</th><th>Observaciones</th></tr></thead><tbody>{(Array.isArray(detalle.items) ? detalle.items : []).map((item) => {
        const costoInformado = tieneCostoUnitarioInformado(item);
        const valorReferencial = calcularValorReferencialLote(item);
        return <tr key={item.lote_id}>
          <td>{item.nombre_insumo} <small className="unit-text">({item.unidad_medida})</small></td>
          <td>{item.codigo_lote || '—'}</td>
          <td>{formatearCantidad(item.cantidad_original)} {item.unidad_medida}</td>
          <td>{formatearCantidad(item.cantidad_disponible)} {item.unidad_medida}</td>
          <td>{costoInformado ? <>{formatearPesos(item.costo_unitario)} / {item.unidad_medida}</> : <span className="muted-text">No informado</span>}</td>
          <td>{valorReferencial !== null ? formatearPesos(valorReferencial) : <span className="muted-text">No disponible</span>}</td>
          <td>{item.fecha_vencimiento ? formatDate(String(item.fecha_vencimiento).slice(0, 10)) : 'Sin vencimiento'}</td>
          <td>{item.observaciones_lote || '—'}</td>
        </tr>;
      })}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><HandHeart size={24} /></span><h3>Esta donación no incluye alimentos</h3><p>El aporte monetario está registrado en el historial financiero y no modificó las existencias.</p></div>}
      <div className="modal-actions"><Button variant="secondary" onClick={() => setDetalle(null)}>Cerrar</Button></div>
    </Modal>}
  </div>;
}


function TasksPage({ tasks: tareas, volunteers: voluntarios, loading, error, onReload, db, user, onAddTask, onUpdateTask, setToast, search }) {
  const [formOpen, setFormOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [saving, setSaving] = useState(false);
  const voluntariosActivos = voluntarios.filter((volunteer) => volunteer.active);
  const [form, setForm] = useState({ title: '', area: 'Cocina', date: todayISO(), time: '09:00', volunteerId: '', priority: 'Media', notes: '' });
  const allTasks = tareas.filter((task) => user.role === 'admin' || task.volunteerId === user.volunteerId);
  const pendingTasks = allTasks.filter((task) => ['pending', 'in_progress'].includes(task.status));
  const completedTasks = allTasks.filter((task) => task.status === 'done');
  const tasksFiltradas = allTasks.filter((task) => {
    const coincideFiltro = filter === 'all'
      || (filter === 'pending' && ['pending', 'in_progress'].includes(task.status))
      || (filter === 'done' && task.status === 'done');
    const nombreResponsable = task.volunteerName || personName(db, task.volunteerId);
    return coincideFiltro && `${task.title} ${task.area} ${nombreResponsable}`.toLowerCase().includes(search.toLowerCase());
  }).sort((a, b) => `${a.date}${a.time || ''}`.localeCompare(`${b.date}${b.time || ''}`));

  const abrirFormulario = () => {
    setForm({ title: '', area: 'Cocina', date: todayISO(), time: '09:00', volunteerId: voluntariosActivos[0]?.id || '', priority: 'Media', notes: '' });
    setFormOpen(true);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    try {
      await onAddTask(form);
      setForm({ title: '', area: 'Cocina', date: todayISO(), time: '09:00', volunteerId: '', priority: 'Media', notes: '' });
      setFormOpen(false);
      setToast({ type: 'success', message: 'La tarea se guardó en PostgreSQL y quedó asignada.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo guardar la tarea.' });
    } finally {
      setSaving(false);
    }
  };

  const cambiarTarea = async (task, changes, message) => {
    try {
      await onUpdateTask(task.id, changes);
      setToast({ type: 'success', message });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo actualizar la tarea.' });
    }
  };

  const nombreEstado = (status) => ({ pending: 'Pendiente', in_progress: 'En curso', done: 'Completada', cancelled: 'Cancelada' }[status] || 'Pendiente');
  const tonoEstado = (status) => ({ pending: 'blue', in_progress: 'amber', done: 'green', cancelled: 'rose' }[status] || 'blue');

  return <div className="page-content">
    <PageHeader eyebrow="COORDINACIÓN DEL EQUIPO" title="Tareas y voluntariado" description={user.role === 'admin' ? 'Asigná responsabilidades, controlá confirmaciones y seguí cada actividad. Los datos se consultan en PostgreSQL.' : 'Consultá tus actividades y confirmá tu asistencia a las jornadas.'} action={user.role === 'admin' ? <Button icon={Plus} onClick={formOpen ? () => setFormOpen(false) : abrirFormulario}>{formOpen ? 'Cerrar formulario' : 'Nueva tarea'}</Button> : null} />

    {error && <div className="calculadora-error" role="alert"><strong>No se pudieron cargar las tareas:</strong> {error}<p>Comprobá que el backend esté activo y que la ruta /api/tareas esté registrada.</p><Button variant="secondary" onClick={onReload}>Reintentar</Button></div>}

    <div className="task-summary-row"><div className="task-summary"><span className="task-summary-icon"><ClipboardList size={20} /></span><div><small>Tareas registradas</small><strong>{allTasks.length}</strong></div></div><div className="task-summary"><span className="task-summary-icon amber"><Clock3 size={20} /></span><div><small>Pendientes</small><strong>{pendingTasks.length}</strong></div></div><div className="task-summary"><span className="task-summary-icon green"><CheckCircle2 size={20} /></span><div><small>Completadas</small><strong>{completedTasks.length}</strong></div></div><div className="task-summary"><span className="task-summary-icon blue"><CalendarCheck size={20} /></span><div><small>Asistencia confirmada</small><strong>{allTasks.filter((t) => t.attendance === 'confirmed' || t.attendance === 'attended').length}</strong></div></div></div>

    {formOpen && user.role === 'admin' && <section className="surface-card form-card"><div className="form-card-heading"><div><span className="eyebrow">NUEVA ACTIVIDAD</span><h3>Asignar una tarea</h3><p>La tarea y su asignación se guardarán en PostgreSQL.</p></div><IconButton icon={X} label="Cerrar formulario" onClick={() => setFormOpen(false)} subtle /></div><form className="form-grid" onSubmit={submit}><label className="field wide"><span>Nombre de la tarea</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Ej. Preparar las mesas de empaque" required maxLength={160} /></label><label className="field"><span>Área</span><select value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}><option>Cocina</option><option>Empaque</option><option>Reparto</option><option>Comunicación</option><option>Compras</option><option>Apoyo general</option></select></label><label className="field"><span>Responsable</span><select value={form.volunteerId} onChange={(e) => setForm({ ...form, volunteerId: e.target.value })}><option value="">Sin asignar</option>{voluntariosActivos.map((volunteer) => <option value={volunteer.id} key={volunteer.id}>{volunteer.name}</option>)}</select>{!voluntariosActivos.length && <small className="muted-text">No hay voluntarios activos; podés guardar la tarea sin asignar.</small>}</label><label className="field"><span>Fecha</span><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></label><label className="field"><span>Hora</span><input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} /></label><label className="field"><span>Prioridad</span><select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}><option>Alta</option><option>Media</option><option>Baja</option></select></label><label className="field"><span>Indicaciones (opcional)</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Información para el voluntario" /></label><div className="form-actions wide"><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" icon={ClipboardPenLine} disabled={saving}>{saving ? 'Guardando...' : 'Asignar tarea'}</Button></div></form></section>}

    <div className="toolbar-row"><div className="filter-tabs"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Todas <span>{allTasks.length}</span></button><button className={filter === 'pending' ? 'active' : ''} onClick={() => setFilter('pending')}>Pendientes <span>{pendingTasks.length}</span></button><button className={filter === 'done' ? 'active' : ''} onClick={() => setFilter('done')}>Completadas <span>{completedTasks.length}</span></button></div><span className="toolbar-note"><Users size={14} /> {user.role === 'admin' ? `${voluntariosActivos.length} voluntarios activos en PostgreSQL` : 'Tu agenda de actividades'}</span></div>

    {loading ? <div className="empty-state"><span className="empty-icon"><ClipboardList size={24} /></span><h3>Cargando tareas...</h3><p>Consultando tareas y asignaciones en PostgreSQL.</p></div> : tasksFiltradas.length ? <div className="task-cards-list">{tasksFiltradas.map((task) => {
      const responsable = task.volunteerName || personName(db, task.volunteerId);
      const attendanceConfirmed = ['confirmed', 'attended'].includes(task.attendance);
      const canRegisterAttendance = Boolean(task.volunteerId);
      return <article className={`task-card ${task.status === 'done' ? 'task-card-done' : ''}`} key={task.id}>
        <button className={`task-completion ${task.status === 'done' ? 'checked' : ''}`} aria-label={task.status === 'done' ? 'Marcar como pendiente' : 'Marcar como completada'} disabled={task.status === 'cancelled'} onClick={() => cambiarTarea(task, { status: task.status === 'done' ? 'pending' : 'done' }, task.status === 'done' ? 'Tarea reabierta.' : 'Tarea marcada como completada en PostgreSQL.')}><Check size={17} /></button>
        <div className="task-card-date"><strong>{task.date ? new Date(`${task.date}T12:00:00Z`).getUTCDate() : '—'}</strong><span>{task.date ? new Intl.DateTimeFormat('es-AR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${task.date}T12:00:00Z`)).replace('.', '') : ''}</span></div>
        <div className="task-card-content"><div className="task-card-title-row"><h3>{task.title}</h3><StatusPill tone={tonoEstado(task.status)}>{nombreEstado(task.status)}</StatusPill></div><p>{task.notes || 'Sin indicaciones adicionales.'}</p><div className="task-card-meta"><span><Clock3 size={14} /> {task.time || 'Sin horario'}</span><span className="area-tag">{task.area}</span><span className="assigned-person"><span className="avatar avatar-small">{responsable === 'Sin asignar' ? '?' : responsable.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>{user.role === 'admin' ? responsable : 'Asignada a vos'}</span><span className={`priority-label ${task.priority?.toLowerCase() || 'media'}`}><span className="priority-dot" /> Prioridad {task.priority || 'Media'}</span></div></div>
        <div className="task-card-side"><span className="attendance-label">{user.role === 'admin' ? 'Asistencia' : 'Tu asistencia'}</span><button className={`attendance-button ${attendanceConfirmed ? 'confirmed' : ''}`} disabled={!canRegisterAttendance || task.status === 'cancelled'} onClick={() => cambiarTarea(task, { attendance: attendanceConfirmed ? 'pending' : 'confirmed' }, attendanceConfirmed ? 'Se actualizó el estado de asistencia.' : (user.role === 'admin' ? 'Asistencia confirmada.' : 'Confirmaste tu asistencia.'))}>{attendanceConfirmed ? <><CheckCircle2 size={15} /> Confirmada</> : <><CircleAlert size={15} /> {canRegisterAttendance ? 'Confirmar asistencia' : 'Sin responsable'}</>}</button></div>
      </article>;
    })}</div> : <EmptyState icon={ClipboardList} title={loading ? 'Cargando tareas...' : 'No hay tareas para mostrar'} description={error ? 'No se pudieron recuperar las tareas de PostgreSQL.' : 'Cuando se asignen actividades, van a aparecer en esta lista.'} action={user.role === 'admin' ? <Button icon={Plus} onClick={abrirFormulario}>Nueva tarea</Button> : null} />}
  </div>;
}

function VolunteersPage({ volunteers: voluntarios, tasks: tareas, loading, error, onReload, onAddVolunteer, onToggleVolunteer, setToast, search }) {
  const [formOpen, setFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', role: 'Apoyo general', phone: '', email: '' });
  const volunteers = voluntarios.filter((v) => `${v.name} ${v.role} ${v.email || ''} ${v.phone || ''}`.toLowerCase().includes(search.toLowerCase()));
  const activeVolunteers = voluntarios.filter((v) => v.active);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onAddVolunteer(form);
      setForm({ name: '', role: 'Apoyo general', phone: '', email: '' });
      setFormOpen(false);
      setToast({ type: 'success', message: 'Voluntario registrado en PostgreSQL.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo registrar el voluntario.' });
    } finally {
      setSaving(false);
    }
  };
  const taskCount = (id) => tareas.filter((task) => task.volunteerId === id && ['pending', 'in_progress'].includes(task.status)).length;
  const toggle = async (volunteer) => {
    try {
      await onToggleVolunteer(volunteer.id, !volunteer.active);
      setToast({ type: 'success', message: volunteer.active ? 'Voluntario marcado como inactivo en PostgreSQL.' : 'Voluntario activado en PostgreSQL.' });
    } catch (err) {
      setToast({ type: 'error', message: err.message || 'No se pudo modificar el estado del voluntario.' });
    }
  };

  return <div className="page-content"><PageHeader eyebrow="PERSONAS QUE HACEN LA DIFERENCIA" title="Equipo de voluntarios" description="Administrá los perfiles de voluntariado guardados en PostgreSQL y organizá las responsabilidades de cada jornada." action={<Button icon={UserRoundPlus} onClick={() => setFormOpen(!formOpen)}>{formOpen ? 'Cerrar formulario' : 'Registrar voluntario'}</Button>} />
    {error && <div className="calculadora-error" role="alert"><strong>No se pudieron cargar los voluntarios:</strong> {error}<p>Comprobá que el backend esté activo y que se haya ejecutado la migración de área principal.</p><Button variant="secondary" onClick={onReload}>Reintentar</Button></div>}
    <div className="volunteer-overview"><div className="volunteer-overview-main"><span className="volunteer-overview-icon"><HandHeart size={26} /></span><div><span className="eyebrow light">COMUNIDAD EN ACCIÓN</span><h3>El corazón de cada jornada</h3><p>Un equipo que suma tiempo, energía y compromiso para que la ayuda llegue.</p></div></div><div className="volunteer-overview-stat"><strong>{activeVolunteers.length}</strong><span>voluntarios activos</span></div><div className="volunteer-overview-stat"><strong>{tareas.filter((t) => ['pending', 'in_progress'].includes(t.status)).length}</strong><span>tareas por realizar</span></div></div>
    {formOpen && <section className="surface-card form-card"><div className="form-card-heading"><div><span className="eyebrow">ALTA DE VOLUNTARIO</span><h3>Sumar una persona al equipo</h3></div><IconButton icon={X} label="Cerrar formulario" onClick={() => setFormOpen(false)} subtle /></div><form className="form-grid" onSubmit={submit}><label className="field"><span>Nombre y apellido</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. Ana Gómez" required maxLength={120} /></label><label className="field"><span>Área principal</span><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option>Cocina</option><option>Empaque</option><option>Reparto</option><option>Comunicación</option><option>Compras</option><option>Apoyo general</option></select></label><label className="field"><span>Teléfono (opcional)</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="381 ..." maxLength={40} /></label><label className="field"><span>Correo electrónico (opcional)</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="nombre@ejemplo.org" maxLength={254} /></label><div className="form-actions wide"><Button type="button" variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button><Button type="submit" icon={UserRoundPlus} disabled={saving}>{saving ? 'Guardando...' : 'Registrar voluntario'}</Button></div></form></section>}
    <div className="volunteer-section-head"><div><h3>Integrantes</h3><p>{volunteers.length} perfiles encontrados en PostgreSQL</p></div><span className="team-availability"><span /> Equipo organizado</span></div>
    {loading ? <div className="empty-state"><span className="empty-icon"><Users size={24} /></span><h3>Cargando voluntarios...</h3><p>Consultando perfiles en PostgreSQL.</p></div> : <div className="volunteer-grid">{volunteers.map((volunteer, index) => <article className={`volunteer-card surface-card ${!volunteer.active ? 'volunteer-inactive' : ''}`} key={volunteer.id}><div className={`volunteer-card-banner banner-${index % 4}`}><span className="volunteer-avatar-large">{volunteer.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span><span className="volunteer-status"><span />{volunteer.active ? 'Activo' : 'Inactivo'}</span><button className="volunteer-more" onClick={() => toggle(volunteer)} title={volunteer.active ? 'Desactivar voluntario' : 'Activar voluntario'}><MoreHorizontal size={18} /></button></div><div className="volunteer-card-body"><h3>{volunteer.name}</h3><span className="role-tag">{volunteer.role || 'Apoyo general'}</span><div className="volunteer-contact"><span><Phone size={14} /> {volunteer.phone || 'Teléfono no cargado'}</span><span><Mail size={14} /> {volunteer.email || 'Correo no cargado'}</span></div><div className="volunteer-card-footer"><span><ClipboardList size={15} /> {taskCount(volunteer.id)} tareas pendientes</span><button onClick={() => toggle(volunteer)}>{volunteer.active ? 'Desactivar' : 'Activar'}</button></div></div></article>)}</div>}
    {!loading && !volunteers.length && <EmptyState icon={Users} title="No hay voluntarios para mostrar" description={voluntarios.length ? 'Probá otro término de búsqueda.' : 'Registrá a una persona para incorporarla al equipo.'} action={<Button icon={UserRoundPlus} onClick={() => setFormOpen(true)}>Registrar voluntario</Button>} />}
  </div>;
}

function ReportsPage({ db, onReset, setToast }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [loadingReports, setLoadingReports] = useState(true);
  const [reportError, setReportError] = useState('');

  const cargarReportes = async () => {
    setLoadingReports(true);
    setReportError('');
    try {
      const response = await fetch(`${API_URL}/api/reportes/resumen`);
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || `No se pudieron cargar los reportes (HTTP ${response.status}).`);
      }
      if (data?.estado !== 'ok' || !data?.resumen) {
        throw new Error('La API de reportes devolvió una respuesta incompleta.');
      }
      setReportData(data);
    } catch (error) {
      setReportError(error.message || 'No se pudieron consultar los reportes en PostgreSQL.');
    } finally {
      setLoadingReports(false);
    }
  };

  useEffect(() => { cargarReportes(); }, []);

  const exportJson = () => {
    if (!reportData) {
      setToast({ type: 'error', message: 'Primero cargá los reportes desde PostgreSQL.' });
      return;
    }
    const blob = new Blob([JSON.stringify({ proyecto: 'Vivir para Servir', exportado_en: new Date().toISOString(), fuente: reportData.base_datos, reportes: reportData }, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'reportes-vivir-para-servir-postgresql.json';
    anchor.click();
    URL.revokeObjectURL(url);
    setToast({ type: 'success', message: 'Se exportaron los reportes consultados desde PostgreSQL.' });
  };

  const exportPdf = () => {
    if (!reportData) {
      setToast({ type: 'error', message: 'Primero cargá los reportes desde PostgreSQL.' });
      return;
    }

    try {
      // El informe se construye exclusivamente con reportData, recibido desde la API PostgreSQL.
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const anchoPagina = pdf.internal.pageSize.getWidth();
      const altoPagina = pdf.internal.pageSize.getHeight();
      const margen = 12;
      const anchoContenido = anchoPagina - margen * 2;
      const limpiar = (valor) => String(valor ?? '—')
        .replace(/\u00a0/g, ' ')
        .replace(/[–—]/g, '-')
        .replace(/·/g, '|')
        .replace(/\s+/g, ' ')
        .trim();
      let y = 17;

      const dibujarEncabezadoContinuacion = () => {
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(47, 84, 65);
        pdf.text('Vivir para Servir | Reportes desde PostgreSQL', margen, 8);
        pdf.setDrawColor(216, 225, 219);
        pdf.line(margen, 11, anchoPagina - margen, 11);
        pdf.setTextColor(40, 48, 44);
        y = 16;
      };

      const asegurarEspacio = (altoNecesario) => {
        if (y + altoNecesario > altoPagina - 13) {
          pdf.addPage();
          dibujarEncabezadoContinuacion();
        }
      };

      const agregarTexto = (texto, opciones = {}) => {
        const tamano = opciones.tamano || 9;
        const negrita = Boolean(opciones.negrita);
        const sangria = opciones.sangria || 0;
        const ancho = anchoContenido - sangria;
        pdf.setFont('helvetica', negrita ? 'bold' : 'normal');
        pdf.setFontSize(tamano);
        pdf.setTextColor(48, 57, 52);
        const lineas = pdf.splitTextToSize(limpiar(texto), ancho);
        lineas.forEach((linea) => {
          asegurarEspacio(tamano * 0.42 + 2.1);
          pdf.text(linea, margen + sangria, y);
          y += tamano * 0.42 + 1.6;
        });
      };

      const agregarSeccion = (titulo) => {
        asegurarEspacio(12);
        pdf.setFillColor(235, 242, 237);
        pdf.roundedRect(margen, y - 4.4, anchoContenido, 8, 1.5, 1.5, 'F');
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.setTextColor(40, 83, 60);
        pdf.text(limpiar(titulo), margen + 3, y + 0.5);
        y += 7;
      };

      const agregarTabla = (titulo, encabezados, filas, anchos) => {
        agregarSeccion(titulo);
        const altoLinea = 4.2;
        const dibujarCabeceraTabla = () => {
          asegurarEspacio(10);
          let x = margen;
          const alto = 8;
          pdf.setFillColor(57, 91, 72);
          pdf.rect(margen, y - 4.8, anchoContenido, alto, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(7.5);
          pdf.setTextColor(255, 255, 255);
          encabezados.forEach((encabezado, indice) => {
            const lineas = pdf.splitTextToSize(limpiar(encabezado), anchos[indice] - 4);
            pdf.text(lineas.slice(0, 2), x + 2, y - 1.1);
            x += anchos[indice];
          });
          y += 4.2;
        };

        dibujarCabeceraTabla();
        if (!filas.length) {
          agregarTexto('Sin registros para este apartado.', { tamano: 8, sangria: 2 });
          y += 1;
          return;
        }

        filas.forEach((fila, indiceFila) => {
          const celdas = fila.map((celda, indice) => pdf.splitTextToSize(limpiar(celda), anchos[indice] - 4));
          const maxLineas = Math.max(1, ...celdas.map((celda) => celda.length));
          const altoFila = Math.max(6.5, maxLineas * altoLinea + 2.5);
          if (y + altoFila > altoPagina - 13) {
            pdf.addPage();
            dibujarEncabezadoContinuacion();
            agregarSeccion(`${titulo} (continuación)`);
            dibujarCabeceraTabla();
          }
          let x = margen;
          if (indiceFila % 2 === 0) {
            pdf.setFillColor(248, 250, 248);
            pdf.rect(margen, y - 3.7, anchoContenido, altoFila, 'F');
          }
          pdf.setDrawColor(224, 231, 226);
          pdf.setLineWidth(0.15);
          pdf.line(margen, y + altoFila - 3.7, margen + anchoContenido, y + altoFila - 3.7);
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(7.5);
          pdf.setTextColor(48, 57, 52);
          celdas.forEach((lineas, indice) => {
            pdf.text(lineas, x + 2, y + 0.2);
            x += anchos[indice];
          });
          y += altoFila;
        });
        y += 3;
      };

      const jornadasPDF = reportData.resumen?.jornadas || {};
      const tareasPDF = reportData.resumen?.tareas || {};
      const voluntariosPDF = reportData.resumen?.voluntarios || {};
      const donacionesPDF = reportData.resumen?.donaciones || {};
      const inventarioPDF = reportData.resumen?.inventario || {};
      const fechaExportacion = new Intl.DateTimeFormat('es-AR', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Argentina/Tucuman',
      }).format(new Date());

      // Portada breve: título, fuente, base y fecha de actualización/exportación.
      pdf.setFillColor(35, 79, 55);
      pdf.rect(0, 0, anchoPagina, 31, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(19);
      pdf.text('Vivir para Servir', margen, 12);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      pdf.text('Reporte de gestión solidaria', margen, 19);
      pdf.setFontSize(8.5);
      pdf.text('Indicadores calculados desde registros de PostgreSQL', margen, 25);
      y = 39;
      agregarTexto(`Base de datos consultada: ${reportData.base_datos || 'No informada'}`, { negrita: true, tamano: 10 });
      agregarTexto(`Datos consultados: ${fechaGeneracion}`, { tamano: 9 });
      agregarTexto(`PDF exportado: ${fechaExportacion}`, { tamano: 9 });
      agregarTexto('Este informe refleja los datos devueltos por la API al momento de la consulta. No utiliza los indicadores locales del navegador.', { tamano: 8 });
      y += 2;

      agregarSeccion('Resumen general');
      agregarTexto(`Jornadas: ${formatNumber(jornadasPDF.planificadas)} planificadas | ${formatNumber(jornadasPDF.en_preparacion)} en preparación | ${formatNumber(jornadasPDF.preparadas)} preparadas | ${formatNumber(jornadasPDF.canceladas)} canceladas.`);
      agregarTexto(`Viandas: ${formatNumber(jornadasPDF.viandas_pendientes)} pendientes | ${formatNumber(jornadasPDF.viandas_preparadas)} preparadas | ${formatNumber(jornadasPDF.viandas_sobrantes)} sobrantes registradas.`);
      agregarTexto(`Tareas: ${formatNumber(tareasPDF.total)} en total | ${formatNumber(tareasPDF.pendientes)} pendientes | ${formatNumber(tareasPDF.en_progreso)} en progreso | ${formatNumber(tareasPDF.completadas)} completadas | ${formatNumber(tareasPDF.canceladas)} canceladas.`);
      agregarTexto(`Voluntariado: ${formatNumber(voluntariosPDF.activos)} activos | ${formatNumber(voluntariosPDF.inactivos)} inactivos.`);
      agregarTexto(`Donaciones recibidas: ${formatNumber(donacionesPDF.recibidas)} | ${formatNumber(donacionesPDF.de_alimentos)} de alimentos | ${formatNumber(donacionesPDF.de_dinero)} de dinero | ${formatNumber(donacionesPDF.mixtas)} mixtas.`);
      agregarTexto(`Aportes monetarios recibidos: ${formatearPesos(donacionesPDF.aporte_monetario_recibido)}.`);
      agregarTexto(`Inventario: ${formatNumber(inventarioPDF.stock_bajo_o_insuficiente)} insumos con stock bajo o insuficiente | ${formatNumber(inventarioPDF.lotes_vencidos_con_stock)} lotes vencidos con stock | ${formatearCantidad(inventarioPDF.cantidad_vencida_total)} unidades de cantidad vencida agregada.`);
      y += 2;

      const consumos = (reportData.consumo_ingredientes || []).map((item) => [
        item.insumo,
        `${formatearCantidad(item.cantidad_total_utilizada)} ${item.unidad_medida || ''}`,
        formatNumber(item.jornadas),
      ]);
      agregarTabla('Consumo real de ingredientes', ['Insumo', 'Cantidad utilizada', 'Jornadas cerradas'], consumos, [108, 105, 60]);

      const destinos = (reportData.destinos_sobrantes || []).map((item) => [
        etiquetaDestinoSobrantes(item.destino),
        formatNumber(item.cantidad_viandas),
        formatNumber(item.jornadas),
      ]);
      agregarTabla('Destino de las viandas sobrantes', ['Destino', 'Viandas registradas', 'Jornadas'], destinos, [130, 75, 68]);

      const stockBajo = (reportData.insumos_stock_bajo || []).map((item) => [
        item.nombre,
        `${formatearCantidad(item.cantidad_utilizable)} ${item.unidad_medida || ''}`,
        `${formatearCantidad(item.cantidad_total)} ${item.unidad_medida || ''}`,
        `${formatearCantidad(item.cantidad_vencida)} ${item.unidad_medida || ''}`,
        `${formatearCantidad(item.stock_minimo)} ${item.unidad_medida || ''}`,
      ]);
      agregarTabla('Insumos con stock bajo o insuficiente', ['Insumo', 'Utilizable', 'Stock total', 'Vencido excluido', 'Mínimo'], stockBajo, [60, 58, 58, 52, 45]);

      const movimientos = (reportData.movimientos_recientes || []).map((item) => {
        const fecha = item.creado_en
          ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Tucuman' }).format(new Date(item.creado_en))
          : '—';
        const referencia = item.nombre_donante || item.nombre_receta || item.observaciones || '—';
        return [
          fecha,
          nombresMovimientos[item.tipo_movimiento] || item.tipo_movimiento,
          item.nombre_insumo,
          `${Number(item.variacion_cantidad) > 0 ? '+' : ''}${formatearCantidad(item.variacion_cantidad)} ${item.unidad_medida || ''}`,
          item.codigo_lote || 'Sin código',
          referencia,
        ];
      });
      agregarTabla('Movimientos recientes de inventario', ['Fecha/hora', 'Tipo', 'Insumo', 'Variación', 'Lote', 'Referencia'], movimientos, [28, 43, 43, 35, 43, 81]);

      const totalPaginas = pdf.getNumberOfPages();
      for (let pagina = 1; pagina <= totalPaginas; pagina += 1) {
        pdf.setPage(pagina);
        pdf.setDrawColor(216, 225, 219);
        pdf.line(margen, altoPagina - 9, anchoPagina - margen, altoPagina - 9);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(7.5);
        pdf.setTextColor(100, 110, 104);
        pdf.text('Vivir para Servir | Informe generado desde datos de PostgreSQL', margen, altoPagina - 5);
        pdf.text(`Página ${pagina} de ${totalPaginas}`, anchoPagina - margen, altoPagina - 5, { align: 'right' });
      }

      const fechaArchivo = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'America/Argentina/Tucuman',
      }).format(new Date());
      pdf.save(`reporte-vivir-para-servir-${fechaArchivo}.pdf`);
      setToast({ type: 'success', message: 'Se generó el PDF con los datos consultados desde PostgreSQL.' });
    } catch (error) {
      console.error('Error al generar el PDF de reportes:', error);
      setToast({ type: 'error', persist: true, message: 'No se pudo generar el PDF. Verificá que jsPDF esté instalado en el proyecto y volvé a intentarlo.' });
    }
  };

  const resumen = reportData?.resumen || {};
  const jornadas = resumen.jornadas || {};
  const tareas = resumen.tareas || {};
  const voluntarios = resumen.voluntarios || {};
  const donaciones = resumen.donaciones || {};
  const inventario = resumen.inventario || {};
  const porcentajeTareasCompletadas = Number(tareas.total) > 0
    ? Math.round(Number(tareas.completadas || 0) / Number(tareas.total) * 100)
    : 0;
  const fechaGeneracion = reportData?.generado_en
    ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Argentina/Tucuman' }).format(new Date(reportData.generado_en))
    : 'Sin consultar';
  const nombresMovimientos = {
    donacion: 'Donación recibida',
    consumo: 'Consumo de cocina',
    devolucion_sobrante: 'Devolución de ingrediente',
    perdida: 'Pérdida / merma',
    ajuste: 'Ajuste de inventario',
    stock_inicial: 'Stock inicial',
  };

  return <div className="page-content">
    <PageHeader
      eyebrow="SEGUIMIENTO Y TRANSPARENCIA"
      title="Reportes y resumen"
      description="Indicadores calculados desde los registros actuales de PostgreSQL, no desde datos locales del navegador."
      action={<div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button icon={RotateCcw} variant="secondary" onClick={cargarReportes} disabled={loadingReports}>{loadingReports ? 'Actualizando...' : 'Actualizar reportes'}</Button>
        <Button icon={Download} onClick={exportPdf} disabled={!reportData || loadingReports}>Exportar reporte PDF</Button>
        <Button icon={Download} variant="secondary" onClick={exportJson} disabled={!reportData || loadingReports}>Exportar JSON</Button>
      </div>}
    />

    <section className="surface-card" style={{ padding: 16, marginBottom: 18, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <div>
        <strong>Fuente de datos: PostgreSQL</strong>
        <p style={{ margin: '5px 0 0', color: 'var(--text-muted, #64748b)' }}>Base consultada: <strong>{reportData?.base_datos || '—'}</strong> · Actualizado: {fechaGeneracion}</p>
      </div>
      <span className="role-tag">{loadingReports ? 'Consultando...' : reportError ? 'Error de consulta' : 'Datos en vivo'}</span>
    </section>

    {reportError && <div className="calculadora-error" role="alert">
      <strong>No se pudieron cargar los reportes:</strong> {reportError}
      <p>Comprobá que el backend esté activo, que el archivo `reportes.js` esté montado y que Express consulte la base de pruebas.</p>
      <Button variant="secondary" icon={RotateCcw} onClick={cargarReportes} disabled={loadingReports}>Reintentar</Button>
    </div>}

    {loadingReports && !reportData ? <div className="empty-state"><span className="empty-icon"><ChartNoAxesCombined size={24} /></span><h3>Cargando reportes...</h3><p>Consultando jornadas, inventario, donaciones, tareas y voluntarios en PostgreSQL.</p></div> : null}

    {reportData && <>
      <div className="reports-highlight">
        <div>
          <span className="eyebrow light">RESUMEN OPERATIVO · POSTGRESQL</span>
          <h2>Lo que hacemos, cuenta.</h2>
          <p>Una vista del trabajo registrado por la Fundación Vivir para Servir, actualizada desde la base de datos seleccionada.</p>
          <div className="report-highlight-stats">
            <div><strong>{formatNumber(jornadas.viandas_preparadas)}</strong><span>viandas preparadas</span></div>
            <div><strong>{formatNumber(jornadas.viandas_sobrantes)}</strong><span>viandas sobrantes registradas</span></div>
            <div><strong>{formatNumber(voluntarios.activos)}</strong><span>voluntarios activos</span></div>
          </div>
        </div>
        <div className="report-illustration"><HeartHandshake size={72} strokeWidth={1.15} /><span>Unidos para servir</span></div>
      </div>

      <div className="section-heading"><div><h3>Indicadores del sistema</h3><p>Los contadores se calculan usando los registros existentes en PostgreSQL.</p></div></div>
      <div className="report-metrics">
        <div className="report-metric surface-card"><span className="report-metric-icon green"><CalendarCheck size={20} /></span><div><small>Jornadas planificadas</small><strong>{formatNumber(jornadas.planificadas)}</strong><span>{formatNumber(jornadas.viandas_pendientes)} viandas pendientes de preparación</span></div></div>
        <div className="report-metric surface-card"><span className="report-metric-icon blue"><CookingPot size={20} /></span><div><small>Jornadas en preparación</small><strong>{formatNumber(jornadas.en_preparacion)}</strong><span>{formatNumber(jornadas.preparadas)} jornadas ya cerradas</span></div></div>
        <div className="report-metric surface-card"><span className="report-metric-icon amber"><Package size={20} /></span><div><small>Insumos con stock bajo</small><strong>{formatNumber(inventario.stock_bajo_o_insuficiente)}</strong><span>{formatNumber(inventario.lotes_vencidos_con_stock)} lotes vencidos con stock</span></div></div>
        <div className="report-metric surface-card"><span className="report-metric-icon purple"><ClipboardCheck size={20} /></span><div><small>Tareas completadas</small><strong>{porcentajeTareasCompletadas}%</strong><span>{formatNumber(tareas.completadas)} de {formatNumber(tareas.total)} tareas</span></div></div>
      </div>

      <div className="report-metrics" style={{ marginTop: 14 }}>
        <div className="report-metric surface-card"><span className="report-metric-icon green"><Utensils size={20} /></span><div><small>Viandas preparadas</small><strong>{formatNumber(jornadas.viandas_preparadas)}</strong><span>{formatNumber(jornadas.viandas_sobrantes)} sobrantes documentadas</span></div></div>
        <div className="report-metric surface-card"><span className="report-metric-icon blue"><HandHeart size={20} /></span><div><small>Donaciones recibidas</small><strong>{formatNumber(donaciones.recibidas)}</strong><span>{formatNumber(donaciones.de_alimentos)} alimentos · {formatNumber(donaciones.de_dinero)} dinero · {formatNumber(donaciones.mixtas)} mixtas</span></div></div>
        <div className="report-metric surface-card"><span className="report-metric-icon purple"><HeartHandshake size={20} /></span><div><small>Aportes monetarios recibidos</small><strong>{formatearPesos(donaciones.aporte_monetario_recibido)}</strong><span>Solo donaciones recibidas de dinero y mixtas</span></div></div>
        <div className="report-metric surface-card"><span className="report-metric-icon amber"><Users size={20} /></span><div><small>Voluntarios activos</small><strong>{formatNumber(voluntarios.activos)}</strong><span>{formatNumber(voluntarios.inactivos)} perfiles inactivos</span></div></div>
      </div>

      <div className="section-heading"><div><h3>Consumo real de ingredientes</h3><p>Totales agregados de jornadas cerradas. Las unidades se muestran según el catálogo de insumos.</p></div></div>
      <section className="surface-card inventory-table-card">
        {(reportData.consumo_ingredientes || []).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Insumo</th><th>Consumo registrado</th><th>Jornadas cerradas</th></tr></thead><tbody>{reportData.consumo_ingredientes.map((item) => <tr key={`${item.insumo}-${item.unidad_medida}`}><td>{item.insumo}</td><td>{formatearCantidad(item.cantidad_total_utilizada)} {item.unidad_medida}</td><td>{formatNumber(item.jornadas)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Package size={24} /></span><h3>Sin consumo registrado todavía</h3><p>Cuando se cierren jornadas con consumos reales, aparecerán acá.</p></div>}
      </section>

      <div className="section-heading"><div><h3>Destino de las viandas sobrantes</h3><p>Resumen de destinos registrados al cerrar las jornadas.</p></div></div>
      <section className="surface-card inventory-table-card">
        {(reportData.destinos_sobrantes || []).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Destino</th><th>Viandas registradas</th><th>Jornadas</th></tr></thead><tbody>{reportData.destinos_sobrantes.map((item) => <tr key={item.destino}><td>{etiquetaDestinoSobrantes(item.destino)}</td><td>{formatNumber(item.cantidad_viandas)}</td><td>{formatNumber(item.jornadas)}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Sprout size={24} /></span><h3>Sin destinos de sobrantes</h3><p>Los destinos de viandas sobrantes aparecerán después de cerrar jornadas con sobrantes declarados.</p></div>}
      </section>

      <div className="section-heading"><div><h3>Insumos con stock bajo o insuficiente</h3><p>Se compara el stock utilizable con el mínimo configurado; el stock vencido no se considera utilizable.</p></div></div>
      <section className="surface-card inventory-table-card">
        {(reportData.insumos_stock_bajo || []).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Insumo</th><th>Stock utilizable</th><th>Stock total</th><th>Vencido excluido</th><th>Stock mínimo</th></tr></thead><tbody>{reportData.insumos_stock_bajo.map((item) => <tr key={item.nombre}><td>{item.nombre}</td><td>{formatearCantidad(item.cantidad_utilizable)} {item.unidad_medida}</td><td>{formatearCantidad(item.cantidad_total)} {item.unidad_medida}</td><td>{formatearCantidad(item.cantidad_vencida)} {item.unidad_medida}</td><td>{formatearCantidad(item.stock_minimo)} {item.unidad_medida}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><CheckCircle2 size={24} /></span><h3>Sin alertas de stock bajo</h3><p>Todos los insumos activos superan su nivel mínimo utilizable.</p></div>}
      </section>

      <div className="section-heading"><div><h3>Movimientos recientes de inventario</h3><p>Últimos movimientos registrados en PostgreSQL, incluyendo donaciones y consumos de cocina.</p></div></div>
      <section className="surface-card inventory-table-card">
        {(reportData.movimientos_recientes || []).length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Fecha y hora</th><th>Tipo</th><th>Insumo</th><th>Variación</th><th>Lote</th><th>Referencia</th></tr></thead><tbody>{reportData.movimientos_recientes.map((movimiento) => <tr key={movimiento.id}><td>{movimiento.creado_en ? new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Argentina/Tucuman' }).format(new Date(movimiento.creado_en)) : '—'}</td><td>{nombresMovimientos[movimiento.tipo_movimiento] || movimiento.tipo_movimiento}</td><td>{movimiento.nombre_insumo}</td><td>{Number(movimiento.variacion_cantidad) > 0 ? '+' : ''}{formatearCantidad(movimiento.variacion_cantidad)} {movimiento.unidad_medida}</td><td>{movimiento.codigo_lote || 'Sin código'}</td><td>{movimiento.nombre_donante || movimiento.nombre_receta || movimiento.observaciones || '—'}</td></tr>)}</tbody></table></div> : <div className="empty-state"><span className="empty-icon"><Package size={24} /></span><h3>Sin movimientos registrados</h3><p>Los ingresos, consumos y devoluciones aparecerán en esta tabla.</p></div>}
      </section>

      <section className="surface-card data-note-card"><div className="data-note-icon"><ShieldCheck size={22} /></div><div><h3>Fuente y alcance de los datos</h3><p>Los indicadores y las tablas de este informe se consultan directamente en PostgreSQL. La base informada arriba permite distinguir los datos de prueba de la base original. La sesión local se valida en Express y los permisos de las rutas protegidas se comprueban en el backend.</p><div className="data-note-tags"><span><CheckCircle2 size={14} /> Informes generados desde PostgreSQL</span><span><ShieldCheck size={14} /> Sesión local protegida</span></div></div></section>
    </>}

    <section className="surface-card reset-card"><div><h3>Datos locales de demostración</h3><p>Esta acción restablece los datos locales auxiliares del navegador. No borra registros de PostgreSQL ni modifica las donaciones, el inventario, las jornadas, las tareas o los perfiles guardados en la base.</p></div><Button variant="secondary" icon={RotateCcw} onClick={() => setConfirmReset(true)}>Restablecer datos locales</Button></section>
    {confirmReset && <Modal title="Restablecer datos locales de demostración" description="Solo se reemplazará la información local auxiliar del navegador. Los registros de PostgreSQL permanecerán intactos." onClose={() => setConfirmReset(false)}><div className="warning-message"><AlertTriangle size={19} /><p>Esta acción no se puede deshacer para los datos locales. Los registros en PostgreSQL no se modificarán.</p></div><div className="modal-actions"><Button variant="secondary" onClick={() => setConfirmReset(false)}>Cancelar</Button><Button onClick={() => { onReset(); setConfirmReset(false); setToast({ type: 'success', message: 'Se restablecieron los datos locales de demostración; PostgreSQL no fue modificado.' }); }}>Sí, restablecer datos locales</Button></div></Modal>}
  </div>;
}

function etiquetaUsuarioVisible(usuario) {
  return usuario?.role === 'admin' ? 'Administrador' : 'Voluntario';
}

function inicialesUsuarioVisible(usuario) {
  return usuario?.role === 'admin' ? 'Ad' : 'Vo';
}

function normalizarUsuarioAutenticado(usuario) {
  const rol = usuario?.rol === 'administrador' ? 'admin' : 'volunteer';
  return {
    id: String(usuario?.id || ''),
    name: usuario?.nombre_completo || 'Usuario',
    email: usuario?.correo_electronico || '',
    role: rol,
    volunteerId: rol === 'volunteer' ? String(usuario?.id || '') : null,
  };
}

function App() {
  const [db, setDb] = useState(() => loadDatabase());
  const [user, setUser] = useState(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [page, setPage] = useState('dashboard');
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState(null);
  const [inventarioPostgres, setInventarioPostgres] = useState([]);
  const [inventarioCargando, setInventarioCargando] = useState(true);
  const [inventarioError, setInventarioError] = useState('');
  const [versionInventario, setVersionInventario] = useState(0);
  const [alertasInventario, setAlertasInventario] = useState(null);
  const [alertasInventarioError, setAlertasInventarioError] = useState('');
  const [jornadasPostgres, setJornadasPostgres] = useState([]);
  const [jornadasCargando, setJornadasCargando] = useState(true);
  const [jornadasError, setJornadasError] = useState('');
  const [versionJornadas, setVersionJornadas] = useState(0);
  const [donacionesPostgres, setDonacionesPostgres] = useState([]);
  const [donacionesCargando, setDonacionesCargando] = useState(true);
  const [donacionesError, setDonacionesError] = useState('');
  const [versionDonaciones, setVersionDonaciones] = useState(0);
  const [tareasPostgres, setTareasPostgres] = useState([]);
  const [tareasCargando, setTareasCargando] = useState(true);
  const [tareasError, setTareasError] = useState('');
  const [versionTareas, setVersionTareas] = useState(0);
  const [voluntariosPostgres, setVoluntariosPostgres] = useState([]);
  const [voluntariosCargando, setVoluntariosCargando] = useState(true);
  const [voluntariosError, setVoluntariosError] = useState('');
  const [versionVoluntarios, setVersionVoluntarios] = useState(0);
  // Identifica únicamente las entradas del historial creadas durante esta sesión.
  // Evita confundirlas con entradas antiguas de otras pruebas en Chrome.
  const historySessionRef = useRef(null);

  useEffect(() => {
    let vigente = true;
    async function verificarSesion() {
      const token = window.sessionStorage.getItem(AUTH_TOKEN_KEY);
      if (!token) {
        if (vigente) setAuthChecking(false);
        return;
      }
      try {
        const respuesta = await fetch(`${API_URL}/api/auth/me`);
        const datos = await leerRespuestaAPI(respuesta);
        if (!datos?.usuario) throw new Error('La sesión no contiene un usuario válido.');
        if (vigente) setUser(normalizarUsuarioAutenticado(datos.usuario));
      } catch (_error) {
        window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
        if (vigente) setUser(null);
      } finally {
        if (vigente) setAuthChecking(false);
      }
    }
    verificarSesion();
    return () => { vigente = false; };
  }, []);

  useEffect(() => {
    const manejarSesionVencida = () => {
      window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
      setUser(null);
      setPage('dashboard');
      setSearch('');
      setToast({ type: 'error', message: 'Tu sesión venció o dejó de estar habilitada. Ingresá nuevamente.' });
    };
    window.addEventListener('vps-auth-expired', manejarSesionVencida);
    return () => window.removeEventListener('vps-auth-expired', manejarSesionVencida);
  }, []);

  // Navegación interna coordinada con el historial de Chrome.
  // Cada inicio de sesión tiene un identificador propio: las entradas viejas
  // de otras sesiones nunca se interpretan como páginas actuales.
  useEffect(() => {
    if (!user) {
      historySessionRef.current = null;
      return undefined;
    }

    const sessionId = historySessionRef.current || (
      window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    historySessionRef.current = sessionId;

    const estadoPanelRaiz = {
      vpsApp: true,
      vpsSession: sessionId,
      page: 'dashboard',
      root: true,
    };

    // Reemplaza el estado actual: descarta marcadores viejos de pruebas anteriores.
    window.history.replaceState(estadoPanelRaiz, '', window.location.href);

    const manejarAtras = (event) => {
      const estado = event.state;
      const perteneceASesionActual = estado?.vpsApp === true && estado?.vpsSession === sessionId;
      const paginaAnterior = perteneceASesionActual ? estado.page : null;
      const paginasPermitidas = user.role === 'admin'
        ? ['dashboard', 'planning', 'recipes', 'inventory', 'donations', 'tasks', 'volunteers', 'reports']
        : ['dashboard', 'tasks'];

      if (paginaAnterior && paginasPermitidas.includes(paginaAnterior)) {
        setPage(paginaAnterior);
        setMobileOpen(false);
        return;
      }

      // Llegamos al límite inicial (o a una entrada antigua): permanecer en el Panel.
      // Se crea una nueva entrada raíz para que otro clic en Atrás no salga del sistema.
      window.history.pushState(estadoPanelRaiz, '', window.location.href);
      setPage('dashboard');
      setMobileOpen(false);
    };

    window.addEventListener('popstate', manejarAtras);
    return () => window.removeEventListener('popstate', manejarAtras);
  }, [user]);

  useEffect(() => { saveDatabase(db); }, [db]);
  // Los errores y los avisos marcados como persistentes quedan visibles hasta cerrar con la X.
  // Los avisos de éxito de los demás módulos desaparecen automáticamente después de 3,5 segundos.
  useEffect(() => {
    if (!toast || toast.type === 'error' || toast.persist) return undefined;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    let vigente = true;
    if (!user || user.role !== 'admin') { setInventarioPostgres([]); setInventarioCargando(false); setInventarioError(''); return () => { vigente = false; }; }
    async function cargarInventario() {
      setInventarioCargando(true);
      setInventarioError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/insumos`);
        const datos = await leerRespuestaAPI(respuesta);
        const filas = Array.isArray(datos)
          ? datos
          : Array.isArray(datos?.insumos)
            ? datos.insumos
            : Array.isArray(datos?.datos?.insumos)
              ? datos.datos.insumos
              : Array.isArray(datos?.datos)
                ? datos.datos
                : Array.isArray(datos?.rows)
                  ? datos.rows
                  : null;
        if (!filas) throw new Error('El backend no devolvió una lista válida de insumos.');
        const normalizados = filas.map(normalizarInsumoAPI).filter((item) => item.id && item.active);
        if (vigente) setInventarioPostgres(normalizados);
      } catch (err) {
        if (vigente) setInventarioError(err.message || 'No se pudo cargar el inventario.');
      } finally {
        if (vigente) setInventarioCargando(false);
      }
    }
    cargarInventario();
    return () => { vigente = false; };
  }, [versionInventario, user]);

  useEffect(() => {
    let vigente = true;
    if (!user || user.role !== 'admin') { setAlertasInventario(null); setAlertasInventarioError(''); return () => { vigente = false; }; }
    async function cargarAlertasInventario() {
      setAlertasInventarioError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/insumos/alertas`);
        const datos = await leerRespuestaAPI(respuesta);
        if (vigente) setAlertasInventario(datos);
      } catch (err) {
        if (vigente) {
          setAlertasInventario(null);
          setAlertasInventarioError(err.message || 'No se pudieron cargar las alertas.');
        }
      }
    }
    cargarAlertasInventario();
    return () => { vigente = false; };
  }, [versionInventario, user]);

  useEffect(() => {
    let vigente = true;
    if (!user || user.role !== 'admin') { setJornadasPostgres([]); setJornadasCargando(false); setJornadasError(''); return () => { vigente = false; }; }
    async function cargarJornadas() {
      setJornadasCargando(true);
      setJornadasError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/jornadas`);
        const datos = await leerRespuestaAPI(respuesta);
        const filas = Array.isArray(datos) ? datos : datos?.jornadas ?? datos?.datos?.jornadas ?? [];
        if (!Array.isArray(filas)) throw new Error('El backend no devolvió una lista válida de jornadas.');
        if (vigente) setJornadasPostgres(filas.map(normalizarJornadaAPI));
      } catch (err) {
        if (vigente) setJornadasError(err.message || 'No se pudieron cargar las jornadas.');
      } finally {
        if (vigente) setJornadasCargando(false);
      }
    }
    cargarJornadas();
    return () => { vigente = false; };
  }, [versionJornadas, user]);

  useEffect(() => {
    let vigente = true;
    if (!user || user.role !== 'admin') { setDonacionesPostgres([]); setDonacionesCargando(false); setDonacionesError(''); return () => { vigente = false; }; }
    async function cargarDonaciones() {
      setDonacionesCargando(true);
      setDonacionesError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/donaciones`);
        const datos = await leerRespuestaAPI(respuesta);
        const filas = Array.isArray(datos) ? datos : datos?.donaciones ?? datos?.datos?.donaciones ?? [];
        if (!Array.isArray(filas)) throw new Error('El backend no devolvió una lista válida de donaciones.');
        if (vigente) setDonacionesPostgres(filas);
      } catch (err) {
        if (vigente) setDonacionesError(err.message || 'No se pudieron cargar las donaciones.');
      } finally {
        if (vigente) setDonacionesCargando(false);
      }
    }
    cargarDonaciones();
    return () => { vigente = false; };
  }, [versionDonaciones, user]);

  useEffect(() => {
    let vigente = true;
    if (!user) { setTareasPostgres([]); setTareasCargando(false); setTareasError(''); return () => { vigente = false; }; }
    async function cargarTareas() {
      setTareasCargando(true);
      setTareasError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/tareas`);
        const datos = await leerRespuestaAPI(respuesta);
        const filas = Array.isArray(datos) ? datos : datos?.tareas ?? datos?.datos?.tareas ?? [];
        if (!Array.isArray(filas)) throw new Error('El backend no devolvió una lista válida de tareas.');
        if (vigente) setTareasPostgres(filas.map(normalizarTareaAPI));
      } catch (err) {
        if (vigente) setTareasError(err.message || 'No se pudieron cargar las tareas.');
      } finally {
        if (vigente) setTareasCargando(false);
      }
    }
    cargarTareas();
    return () => { vigente = false; };
  }, [versionTareas, user]);

  useEffect(() => {
    let vigente = true;
    if (!user || user.role !== 'admin') { setVoluntariosPostgres([]); setVoluntariosCargando(false); setVoluntariosError(''); return () => { vigente = false; }; }
    async function cargarVoluntarios() {
      setVoluntariosCargando(true);
      setVoluntariosError('');
      try {
        const respuesta = await fetch(`${API_URL}/api/voluntarios`);
        const datos = await leerRespuestaAPI(respuesta);
        const filas = Array.isArray(datos) ? datos : datos?.voluntarios ?? datos?.datos?.voluntarios ?? [];
        if (!Array.isArray(filas)) throw new Error('El backend no devolvió una lista válida de voluntarios.');
        if (vigente) setVoluntariosPostgres(filas.map(normalizarVoluntarioAPI));
      } catch (err) {
        if (vigente) setVoluntariosError(err.message || 'No se pudieron cargar los voluntarios.');
      } finally {
        if (vigente) setVoluntariosCargando(false);
      }
    }
    cargarVoluntarios();
    return () => { vigente = false; };
  }, [versionVoluntarios, user]);

  const recargarInventario = () => setVersionInventario((actual) => actual + 1);
  const recargarJornadas = () => setVersionJornadas((actual) => actual + 1);
  const recargarDonaciones = () => setVersionDonaciones((actual) => actual + 1);
  const recargarTareas = () => setVersionTareas((actual) => actual + 1);
  const recargarVoluntarios = () => setVersionVoluntarios((actual) => actual + 1);
  const dbPostgres = useMemo(() => ({ ...db, tasks: tareasPostgres, volunteers: voluntariosPostgres }), [db, tareasPostgres, voluntariosPostgres]);

  const notify = (message, type = 'success') => {
    if (message && typeof message === 'object' && 'message' in message) setToast(message);
    else setToast({ message, type });
  };
  // En Donaciones dejamos todos los mensajes visibles hasta que la persona pulse la X.
  const notifyDonaciones = (message, type = 'success') => {
    if (message && typeof message === 'object' && 'message' in message) {
      setToast({ ...message, persist: true });
    } else {
      setToast({ message, type, persist: true });
    }
  };
  const login = (respuestaLogin) => {
    window.sessionStorage.setItem(AUTH_TOKEN_KEY, respuestaLogin.token);
    const sessionId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    historySessionRef.current = sessionId;
    window.history.replaceState({
      vpsApp: true,
      vpsSession: sessionId,
      page: 'dashboard',
      root: true,
    }, '', window.location.href);
    setUser(normalizarUsuarioAutenticado(respuestaLogin.usuario));
    setAuthChecking(false);
    setPage('dashboard');
    setMobileOpen(false);
    setToast({ type: 'success', message: 'Sesión iniciada correctamente.' });
  };
  const logout = () => {
    window.sessionStorage.removeItem(AUTH_TOKEN_KEY);
    historySessionRef.current = null;
    window.history.replaceState({ vpsAppLoggedOut: true }, '', window.location.href);
    setUser(null);
    setPage('dashboard');
    setSearch('');
    setMobileOpen(false);
  };
  const navegarA = (paginaSolicitada) => {
    const paginaPermitida = user?.role === 'admin' || ['dashboard', 'tasks'].includes(paginaSolicitada);
    if (!paginaPermitida) {
      setToast({ type: 'error', message: 'Tu perfil de voluntario solo tiene acceso al Panel principal y a Tareas.' });
      return;
    }
    if (paginaSolicitada === page) return;
    const sessionId = historySessionRef.current;
    if (!sessionId) return;
    window.history.pushState({
      vpsApp: true,
      vpsSession: sessionId,
      page: paginaSolicitada,
    }, '', window.location.href);
    setPage(paginaSolicitada);
  };
  const updateDb = (key, updater) => setDb((current) => ({ ...current, [key]: updater(current[key]) }));

  const addRecipe = (recipe) => updateDb('recipes', (items) => [...items, { id: createId('rec'), ...recipe }]);
  const updateRecipe = (id, recipe) => updateDb('recipes', (items) => items.map((item) => item.id === id ? { ...item, ...recipe } : item));
  const deleteRecipe = (id) => updateDb('recipes', (items) => items.filter((item) => item.id !== id));
  const addInventoryItem = async (item) => {
    const respuesta = await fetch(`${API_URL}/api/insumos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre: item.name,
        categoria: item.category,
        unidad_medida: item.unit,
        cantidad_inicial: item.quantity,
        stock_minimo: item.minimum,
        fecha_vencimiento: item.expiration || null,
        observaciones: null,
      }),
    });
    await leerRespuestaAPI(respuesta);
    recargarInventario();
  };

  const adjustStock = async (id, amount) => {
    const respuesta = await fetch(`${API_URL}/api/insumos/${encodeURIComponent(id)}/movimientos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tipo_movimiento: 'ajuste',
        variacion_cantidad: amount,
        observaciones: 'Ajuste manual desde el módulo de inventario.',
      }),
    });
    await leerRespuestaAPI(respuesta);
    recargarInventario();
  };

  const consultarMovimientosInsumo = async (id) => {
    const respuesta = await fetch(`${API_URL}/api/insumos/${encodeURIComponent(id)}/movimientos`);
    const datos = await leerRespuestaAPI(respuesta);
    const lista = Array.isArray(datos) ? datos : datos?.movimientos ?? [];
    if (!Array.isArray(lista)) throw new Error('El backend no devolvió un historial de movimientos válido.');
    return lista;
  };
  const registrarDonacion = async (donacion) => {
    const respuesta = await fetch(`${API_URL}/api/donaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(donacion),
    });
    const resultado = await leerRespuestaAPI(respuesta);
    recargarDonaciones();
    recargarInventario();
    return resultado;
  };
  const addTask = async (task) => {
    const respuesta = await fetch(`${API_URL}/api/tareas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titulo: task.title,
        area: task.area,
        observaciones: task.notes || null,
        fecha_tarea: task.date,
        hora_tarea: task.time || null,
        prioridad: String(task.priority || 'Media').toLowerCase(),
        perfil_id: task.volunteerId || null,
      }),
    });
    const datos = await leerRespuestaAPI(respuesta);
    recargarTareas();
    recargarVoluntarios();
    return datos;
  };

  const updateTask = async (id, changes) => {
    const tareaActual = tareasPostgres.find((task) => task.id === String(id));
    const cuerpo = {};
    const estadosTarea = { pending: 'pendiente', in_progress: 'en_progreso', done: 'completada', cancelled: 'cancelada' };
    const estadosAsistencia = { pending: 'pendiente', confirmed: 'confirmada', attended: 'asistio', absent: 'ausente' };
    if (Object.prototype.hasOwnProperty.call(changes, 'status')) cuerpo.estado = estadosTarea[changes.status] || changes.status;
    if (Object.prototype.hasOwnProperty.call(changes, 'attendance')) {
      cuerpo.estado_asistencia = estadosAsistencia[changes.attendance] || changes.attendance;
      cuerpo.perfil_id = tareaActual?.volunteerId || null;
    }
    if (Object.prototype.hasOwnProperty.call(changes, 'volunteerId')) cuerpo.perfil_id = changes.volunteerId || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'title')) cuerpo.titulo = changes.title;
    if (Object.prototype.hasOwnProperty.call(changes, 'area')) cuerpo.area = changes.area;
    if (Object.prototype.hasOwnProperty.call(changes, 'notes')) cuerpo.observaciones = changes.notes || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'date')) cuerpo.fecha_tarea = changes.date;
    if (Object.prototype.hasOwnProperty.call(changes, 'time')) cuerpo.hora_tarea = changes.time || null;
    if (Object.prototype.hasOwnProperty.call(changes, 'priority')) cuerpo.prioridad = String(changes.priority).toLowerCase();

    const respuesta = await fetch(`${API_URL}/api/tareas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const datos = await leerRespuestaAPI(respuesta);
    recargarTareas();
    recargarVoluntarios();
    return datos;
  };

  const addVolunteer = async (volunteer) => {
    const respuesta = await fetch(`${API_URL}/api/voluntarios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nombre_completo: volunteer.name,
        area_principal: volunteer.role,
        telefono: volunteer.phone || null,
        correo_electronico: volunteer.email || null,
      }),
    });
    const datos = await leerRespuestaAPI(respuesta);
    recargarVoluntarios();
    return datos;
  };

  const toggleVolunteer = async (id, activo) => {
    const respuesta = await fetch(`${API_URL}/api/voluntarios/${encodeURIComponent(id)}/estado`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activo }),
    });
    const datos = await leerRespuestaAPI(respuesta);
    recargarVoluntarios();
    return datos;
  };
  const restoreDemo = () => setDb(resetDatabase());

  const pageMeta = useMemo(() => ({
    dashboard: ['Panel principal', 'Un resumen de la actividad y las próximas jornadas.'],
    planning: ['Planificación', 'Organizá las jornadas de cocina y las viandas.'],
    recipes: ['Recetario', 'Recetas, ingredientes y cantidades por porción.'],
    inventory: ['Inventario', 'Stock, donaciones y fechas de vencimiento.'],
    donations: ['Donaciones', 'Registrá aportes de alimentos, dinero o ambos desde PostgreSQL.'],
    tasks: ['Tareas', 'Responsabilidades y confirmación de asistencia.'],
    volunteers: ['Voluntarios', 'Personas y roles del equipo solidario.'],
    reports: ['Reportes', 'Indicadores básicos del trabajo de la fundación.'],
  }), []);

  if (authChecking) return <main className="login-screen"><section className="login-panel"><div className="login-form-wrap"><div className="login-intro"><span className="eyebrow">VIVIR PARA SERVIR</span><h2>Verificando sesión</h2><p>Comprobando la validez de tu acceso...</p></div></div></section></main>;
  if (!user) return <LoginScreen onLogin={login} />;
  const current = pageMeta[page] || pageMeta.dashboard;
  return <div className="app-shell"><Sidebar page={page} setPage={navegarA} user={user} onLogout={logout} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} /><main className="main-area"><Topbar title={current[0]} subtitle={current[1]} user={user} onToggleMenu={() => setMobileOpen(true)} search={search} setSearch={setSearch} /><div className="main-content-wrap">
    {page === 'dashboard' && <Dashboard db={dbPostgres} user={user} setPage={navegarA} setToast={notify} search={search} inventory={inventarioPostgres} plans={jornadasPostgres} inventoryAlerts={alertasInventario} inventoryAlertsError={alertasInventarioError} />}
    {page === 'planning' && user.role === 'admin' && <PlanningPage jornadas={jornadasPostgres} loading={jornadasCargando} error={jornadasError} onReload={recargarJornadas} inventory={inventarioPostgres} inventoryLoading={inventarioCargando} onReloadInventory={recargarInventario} setToast={notify} search={search} />}
    {page === 'recipes' && user.role === 'admin' && <RecipesPage db={db} onAddRecipe={addRecipe} onUpdateRecipe={updateRecipe} onDeleteRecipe={deleteRecipe} setToast={notify} search={search} />}
    {page === 'inventory' && user.role === 'admin' && <InventoryPage inventory={inventarioPostgres} loading={inventarioCargando} error={inventarioError} onReload={recargarInventario} onAddItem={addInventoryItem} onAdjustStock={adjustStock} onViewMovements={consultarMovimientosInsumo} setToast={notify} search={search} />}
    {page === 'donations' && user.role === 'admin' && <DonacionesPage donaciones={donacionesPostgres} loading={donacionesCargando} error={donacionesError} onReload={recargarDonaciones} inventory={inventarioPostgres} inventoryLoading={inventarioCargando} onReceiveDonation={registrarDonacion} setToast={notifyDonaciones} search={search} />}
    {page === 'tasks' && <TasksPage tasks={tareasPostgres} volunteers={voluntariosPostgres} loading={tareasCargando || voluntariosCargando} error={tareasError || voluntariosError} onReload={() => { recargarTareas(); recargarVoluntarios(); }} db={dbPostgres} user={user} onAddTask={addTask} onUpdateTask={updateTask} setToast={notify} search={search} />}
    {page === 'volunteers' && user.role === 'admin' && <VolunteersPage volunteers={voluntariosPostgres} tasks={tareasPostgres} loading={voluntariosCargando} error={voluntariosError} onReload={recargarVoluntarios} onAddVolunteer={addVolunteer} onToggleVolunteer={toggleVolunteer} setToast={notify} search={search} />}
    {page === 'reports' && user.role === 'admin' && <ReportsPage db={dbPostgres} onReset={restoreDemo} setToast={notify} inventory={inventarioPostgres} plans={jornadasPostgres} />}
  </div><footer className="app-footer"><span>© 2026 Fundación Vivir para Servir · Sistema académico</span><span><span className="footer-status-dot" /> Módulos conectados a PostgreSQL · Sesión local autenticada</span></footer></main>{toast && <div className={`toast-message ${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'}><span className="toast-icon">{toast.type === 'error' ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}</span><span>{toast.message}</span><button onClick={() => setToast(null)} aria-label="Cerrar aviso"><X size={16} /></button></div>}</div>;
}

export default App;