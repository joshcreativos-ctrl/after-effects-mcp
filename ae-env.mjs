// Detección del entorno de After Effects (rutas, versiones, estado del puente y del permiso de scripting).
// Lo usan el servidor MCP y el instalador.
import fss from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export const APPDATA = process.env.APPDATA || "";
export const BRIDGE_DIR = process.env.VIDEAZO_AE_DIR || path.join(APPDATA, "Videazo", "ae-bridge");
export const BRIDGE_FILE = "videazo_bridge.jsx";
export const BRIDGE_VERSION = 2; // debe coincidir con VZ_BRIDGE_VERSION en bridge/videazo_bridge.jsx

// Instalaciones de After Effects (en orden, la más nueva al final).
export function findInstalls() {
  const env = process.env.AE_PATH;
  const roots = [];
  if (env) {
    const exe = env.toLowerCase().endsWith(".exe") ? env : path.join(env, "Support Files", "AfterFX.exe");
    if (fss.existsSync(exe)) return [describe(path.basename(path.dirname(path.dirname(exe))), exe)];
  }
  for (const pf of new Set([process.env["ProgramFiles"], "C:\\Program Files"].filter(Boolean))) roots.push(path.join(pf, "Adobe"));
  const found = [];
  for (const root of roots) {
    if (!fss.existsSync(root)) continue;
    for (const d of fss.readdirSync(root)) {
      if (!/^Adobe After Effects/i.test(d)) continue;
      const exe = path.join(root, d, "Support Files", "AfterFX.exe");
      if (fss.existsSync(exe)) found.push(describe(d, exe));
    }
  }
  return found.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function describe(name, exe) {
  let version = null;
  try {
    const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Item -LiteralPath '${exe.replace(/'/g, "''")}').VersionInfo.ProductVersion`], { encoding: "utf8", windowsHide: true }).trim();
    const m = out.match(/^(\d+)\.(\d+)/);
    if (m) version = `${m[1]}.${m[2]}`;
  } catch {}
  return { name, exe, support: path.dirname(exe), version };
}

export const findLatest = () => findInstalls().at(-1) ?? null;

// Carpeta de scripts de inicio del usuario (no pide administrador).
export const startupDir = (version) => path.join(APPDATA, "Adobe", "After Effects", version, "Scripts", "Startup");
export const startupFile = (version) => path.join(startupDir(version), BRIDGE_FILE);

export function installedBridgeVersion(version) {
  try {
    const m = fss.readFileSync(startupFile(version), "utf8").match(/VZ_BRIDGE_VERSION\s*=\s*(\d+)/);
    return m ? Number(m[1]) : 0;
  } catch {
    return null; // no instalado
  }
}

// Valor del permiso "Permitir que los scripts escriban archivos y accedan a la red": 1, 0 o null (no se pudo leer).
export function scriptingPermission(version) {
  const dir = path.join(APPDATA, "Adobe", "After Effects", version || "");
  try {
    for (const f of fss.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(".txt")) continue;
      const m = fss.readFileSync(path.join(dir, f), "utf8").match(/"Pref_SCRIPTING_FILE_NETWORK_SECURITY"\s*=\s*"(\d)"/);
      if (m) return Number(m[1]);
    }
  } catch {}
  return null;
}

export const PERMISSION_HELP =
  "Activa en After Effects: Edición > Preferencias > Scripting y expresiones > 'Permitir que los scripts escriban archivos y accedan a la red'. Luego reinicia After Effects. Es un ajuste de seguridad de Adobe: solo lo activa el usuario, una vez.";
