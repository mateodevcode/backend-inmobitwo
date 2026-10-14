// src/lib/sshDominios.js — ejecuta los scripts de dominios en el VPS por SSH.
// Cada línea de salida se reporta vía onLinea para el log en vivo del CRM.
import { spawn } from "node:child_process";

const MAX_SALIDA = 200_000;

// comando: ej. "sudo /srv/infra/inmobitwo/scripts-dominios/agregar-dominio.sh x.com --www"
export function ejecutarRemoto({ host, user, keyPath, comando, timeoutMs = 600_000, onLinea }) {
  return new Promise((resolve) => {
    let salida = "";
    let terminado = false;
    const args = [
      "-i",
      keyPath,
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=15",
      "-o",
      "StrictHostKeyChecking=accept-new",
      `${user}@${host}`,
      comando,
    ];
    let proc;
    try {
      proc = spawn("ssh", args, { timeout: timeoutMs });
    } catch (error) {
      resolve({ codigo: 127, salida: `[ERROR] No se pudo lanzar ssh: ${error.message}\n` });
      return;
    }
    const volcar = (trozo) => {
      const texto = trozo.toString();
      salida = (salida + texto).slice(-MAX_SALIDA);
      for (const linea of texto.split(/\r?\n/)) {
        if (linea.trim() !== "") onLinea?.(linea);
      }
    };
    proc.stdout.on("data", volcar);
    proc.stderr.on("data", volcar);
    const fin = (codigo) => {
      if (terminado) return;
      terminado = true;
      resolve({ codigo: codigo ?? 1, salida });
    };
    proc.on("error", (error) => {
      salida += `[ERROR] ssh: ${error.message}\n`;
      fin(127);
    });
    proc.on("close", fin);
    setTimeout(() => {
      if (!terminado) {
        salida += "[ERROR] Tiempo agotado (10 min). Proceso terminado.\n";
        try {
          proc.kill("SIGKILL");
        } catch {}
        fin(124);
      }
    }, timeoutMs).unref?.();
  });
}
