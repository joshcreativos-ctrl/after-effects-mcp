// Comunicación con el puente que corre dentro de After Effects.
// Node escribe inbox/<id>.json → el puente lo ejecuta → escribe outbox/<id>.json.
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { BRIDGE_DIR, BRIDGE_VERSION, PERMISSION_HELP, findLatest, installedBridgeVersion, scriptingPermission } from "./ae-env.mjs";

export const DIR = BRIDGE_DIR;
const INBOX = path.join(DIR, "inbox");
const OUTBOX = path.join(DIR, "outbox");
const STATUS = path.join(DIR, "status.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fwd = (p) => p.replace(/\\/g, "/");

function isRunning() {
  return new Promise((resolve) => {
    execFile("tasklist", ["/FI", "IMAGENAME eq AfterFX.exe", "/NH"], { windowsHide: true }, (err, out) => {
      resolve(!err && /AfterFX\.exe/i.test(out || ""));
    });
  });
}

// ---------- estado del puente ----------
export async function bridgeAlive() {
  try {
    const st = await fs.stat(path.join(DIR, "status.json"));
    return Date.now() - st.mtimeMs < 4000;
  } catch {
    return false;
  }
}

export async function readStatus() {
  try {
    return JSON.parse(await fs.readFile(STATUS, "utf8"));
  } catch {
    return null;
  }
}

let lastLaunch = 0;

// Deja el puente listo: abre After Effects si está cerrado (el puente arranca solo con él)
// y, si algo falta, falla con la instrucción exacta para arreglarlo.
export async function ensureBridge(waitMs = 120000) {
  if (await bridgeAlive()) return;
  const ae = findLatest();
  if (!ae) throw new Error("No encontré After Effects en Program Files\\Adobe. Define AE_PATH con la carpeta de instalación.");

  const installed = ae.version ? installedBridgeVersion(ae.version) : null;
  const perm = ae.version ? scriptingPermission(ae.version) : null;
  const running = await isRunning();

  if (perm === 0) throw new Error(`After Effects no permite que los scripts escriban archivos. ${PERMISSION_HELP}`);
  if (installed === null || installed < BRIDGE_VERSION) {
    throw new Error("El puente de Videazo no está instalado (o está desactualizado). Ejecuta el instalador: `node install.mjs` dentro de la carpeta del MCP, y reinicia After Effects.");
  }

  await fs.mkdir(INBOX, { recursive: true });
  await fs.mkdir(OUTBOX, { recursive: true });

  if (Date.now() - lastLaunch > 45000) {
    lastLaunch = Date.now();
    if (!running) {
      spawn(ae.exe, [], { detached: true, stdio: "ignore" }).unref(); // el script de inicio arranca el puente
    } else {
      // AE ya estaba abierto (p. ej. el puente no pudo arrancar porque había un cuadro esperando respuesta):
      // le pedimos que ejecute el puente ahora. Solo funciona si no hay ningún cuadro abierto.
      const bridge = path.join(path.dirname(fileURLToPath(import.meta.url)), "bridge", "videazo_bridge.jsx").replace(/\\/g, "/");
      const boot = path.join(DIR, "boot.jsx");
      await fs.writeFile(boot, `$.evalFile(new File(${JSON.stringify(bridge)}));\n`, "utf8");
      spawn(ae.exe, ["-r", boot], { detached: true, stdio: "ignore" }).unref();
    }
  }

  const startedAt = Date.now();
  const deadline = startedAt + waitMs;
  while (Date.now() < deadline) {
    if (await bridgeAlive()) return;
    if (running && Date.now() - startedAt > 20000) break;
    await sleep(500);
  }
  throw new Error(
    running
      ? "After Effects está abierto pero el puente no responde. Lo más probable es que haya un cuadro de diálogo esperando respuesta (After Effects no ejecuta scripts mientras haya uno): ciérralo y vuelve a intentar. Si no hay ninguno, reinicia After Effects."
      : "After Effects no terminó de arrancar a tiempo. Espera a que cargue (o a que respondas sus cuadros de inicio) y vuelve a intentar."
  );
}

// ---------- ejecutar código ExtendScript ----------
// `code` es el CUERPO de una función: usa `return` para devolver datos.
// Dentro están disponibles `app`, todo el DOM de After Effects y el objeto `VZ` (ayudas del puente).
export async function callAE(code, { undo, timeout = 60000, args } = {}) {
  await ensureBridge();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const prelude = args === undefined ? "" : `var A = ${JSON.stringify(args)};\n`;
  const wrapped = `(function(){\n${prelude}${code}\n})()`;
  // JSON válido pero con los separadores de línea escapados, para que ExtendScript lo evalúe sin problema.
  const body = JSON.stringify({ id, undo: undo || null, code: wrapped }).split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");

  const tmp = path.join(INBOX, `${id}.tmp`);
  const req = path.join(INBOX, `${id}.json`);
  await fs.writeFile(tmp, body, "utf8");
  await fs.rename(tmp, req);

  const out = path.join(OUTBOX, `${id}.json`);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const raw = await fs.readFile(out, "utf8");
      await fs.rm(out, { force: true });
      const res = JSON.parse(raw);
      if (!res.ok) throw new Error(res.error + (res.line ? ` (línea ${res.line})` : ""));
      return res.result;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await sleep(40);
  }
  const pending = fss.existsSync(req);
  if (pending) await fs.rm(req, { force: true });
  throw new Error(
    pending
      ? "After Effects no atendió la orden a tiempo (¿render en curso o diálogo abierto?). La orden se canceló."
      : "La orden llegó a After Effects pero tardó más de lo esperado; puede seguir ejecutándose. Revisa con ae_status."
  );
}
