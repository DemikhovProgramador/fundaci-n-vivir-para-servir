import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";

async function leerSecreto(etiqueta) {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    const rl = readline.createInterface({ input, output });
    try { return await rl.question(etiqueta); } finally { rl.close(); }
  }
  return new Promise((resolve, reject) => {
    let valor = "";
    output.write(etiqueta);
    const terminar = (error = null) => {
      stdin.off("data", alRecibir);
      try { stdin.setRawMode(false); } catch {}
      output.write("\n");
      if (error) reject(error); else resolve(valor);
    };
    const alRecibir = (datos) => {
      for (const caracter of datos.toString("utf8")) {
        if (caracter === "\u0003") return terminar(new Error("Operación cancelada."));
        if (caracter === "\r" || caracter === "\n") return terminar();
        if (caracter === "\u007f" || caracter === "\b") {
          if (valor.length) { valor = valor.slice(0, -1); output.write("\b \b"); }
        } else if (caracter >= " ") {
          valor += caracter;
          output.write("*");
        }
      }
    };
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", alRecibir);
  });
}

let exitCode = 0;
try {
  const rl = readline.createInterface({ input, output });
  const email = (await rl.question("Correo del perfil existente en public.perfiles: ")).trim().toLowerCase();
  rl.close();
  if (!email || email.length > 254) throw new Error("Ingresá un correo válido.");

  const perfiles = await pool.query(
    `SELECT id, nombre_completo, correo_electronico, rol, activo
     FROM public.perfiles WHERE LOWER(correo_electronico) = $1 LIMIT 2`, [email]
  );
  if (perfiles.rowCount !== 1) throw new Error("No existe un único perfil con ese correo. Registrá o corregí el correo desde Voluntarios/pgAdmin primero.");
  const perfil = perfiles.rows[0];
  if (!perfil.activo) throw new Error("El perfil está inactivo. Activá el perfil antes de crear credenciales.");
  if (!['administrador', 'voluntario'].includes(perfil.rol)) throw new Error("El perfil no tiene un rol habilitado para iniciar sesión.");

  console.log(`Perfil seleccionado: ${perfil.nombre_completo} (${perfil.rol})`);
  const password = await leerSecreto("Nueva contraseña (mínimo 10 caracteres; no se mostrará): ");
  const confirmacion = await leerSecreto("Repetí la contraseña: ");
  if (password.length < 10 || password.length > 200) throw new Error("La contraseña debe tener entre 10 y 200 caracteres.");
  if (password !== confirmacion) throw new Error("Las contraseñas no coinciden.");

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO public.credenciales_locales (perfil_id, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (perfil_id) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           intentos_fallidos = 0,
           bloqueado_hasta = NULL,
           actualizado_en = NOW()`,
    [perfil.id, hash]
  );
  console.log(`Credenciales locales configuradas para ${perfil.nombre_completo}. El perfil conserva su rol actual: ${perfil.rol}.`);
  console.log("La contraseña no se guardó en texto legible ni se mostró en pantalla.");
} catch (error) {
  exitCode = 1;
  console.error(`No se pudieron crear las credenciales: ${error.message}`);
} finally {
  await pool.end().catch(() => {});
  process.exitCode = exitCode;
}