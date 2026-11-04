
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

// Comprobar que estén configurados los datos esenciales.
const variablesNecesarias = [
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
];

const faltantes = variablesNecesarias.filter(
  (nombre) => !process.env[nombre]
);

if (faltantes.length > 0) {
  throw new Error(
    `Faltan variables en el archivo .env: ${faltantes.join(", ")}`
  );
}

// Crear el conjunto de conexiones a PostgreSQL.
export const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Informar si hay un error inesperado en una conexión inactiva.
pool.on("error", (error) => {
  console.error(
    "Error inesperado en una conexión PostgreSQL:",
    error.message
  );
});