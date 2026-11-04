import { seedDatabase } from '../data/seedData.js';

const DB_KEY = 'vivir-para-servir-local-db-v1';
const SESSION_KEY = 'vivir-para-servir-session-v1';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function loadDatabase() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.inventory && parsed.recipes && parsed.tasks && parsed.volunteers && parsed.plans) return parsed;
    }
  } catch (error) {
    console.warn('No se pudo leer la base local de demostración. Se cargarán datos iniciales.', error);
  }
  return clone(seedDatabase);
}

export function saveDatabase(database) {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(database));
  } catch (error) {
    console.error('No se pudieron guardar los datos locales.', error);
  }
}

export function resetDatabase() {
  const fresh = clone(seedDatabase);
  saveDatabase(fresh);
  return fresh;
}

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

export function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}

export function createId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
