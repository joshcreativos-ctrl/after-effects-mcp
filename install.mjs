#!/usr/bin/env node
// Instalador de Free After Effects MCP by Videazo Super Intelligence (Windows).
//   node install.mjs               instala y registra en Claude Code y Claude Desktop
//   node install.mjs --dry-run     muestra qué haría, sin tocar nada
//   node install.mjs --uninstall   quita todo
//   Opciones: --no-claude-code --no-claude-desktop --no-codex --no-cursor --no-gemini --no-windsurf
// No pide administrador: todo va a carpetas del usuario.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { PERMISSION_HELP, BRIDGE_FILE, findInstalls, startupDir, startupFile, scriptingPermission } from "./ae-env.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const flags = new Set(process.argv.slice(2));
const DRY = flags.has("--dry-run");
const UNINSTALL = flags.has("--uninstall");
const NAME = "after-effects";
const HOME = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "Videazo", "ae-mcp");
const SERVER = path.join(HOME, "server.mjs");
const FILES = ["server.mjs", "bridge-client.mjs", "ae-env.mjs", "install.mjs", "package.json", "README.md", "LICENSE", "Instalar.cmd", "Desinstalar.cmd", path.join("bridge", BRIDGE_FILE)];

const say = (m = "") => console.log(m);
const step = (m) => say(`${DRY ? "[simulación] " : ""}${m}`);
const problems = [];
const warn = (m) => { problems.push(m); say(`  ! ${m}`); };

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: true, ...opts });
}
const has = (cmd) => { try { sh("where", [cmd]); return true; } catch { return false; } };
const aeRunning = () => { try { return /AfterFX\.exe/i.test(sh("tasklist", ["/FI", '"IMAGENAME eq AfterFX.exe"', "/NH"])); } catch { return false; } };

if (process.platform !== "win32") { say("Este instalador es solo para Windows por ahora."); process.exit(1); }
if (Number(process.versions.node.split(".")[0]) < 18) { say(`Necesitas Node 18 o más (tienes ${process.versions.node}). Instálalo con: winget install OpenJS.NodeJS.LTS`); process.exit(1); }

const installs = findInstalls();
if (!installs.length) { say("No encontré After Effects en Program Files\\Adobe. Instálalo primero."); process.exit(1); }
const versions = [...new Set(installs.map((i) => i.version).filter(Boolean))];

say(UNINSTALL ? "Desinstalando Free After Effects MCP…" : "Instalando Free After Effects MCP…");
say(`After Effects encontrado: ${installs.map((i) => `${i.name} (${i.version ?? "?"})`).join(", ")}\n`);

// ---------- 1. puente dentro de After Effects (carpeta de inicio del usuario) ----------
for (const v of versions) {
  const target = startupFile(v);
  if (UNINSTALL) {
    step(`Quitando el puente: ${target}`);
    if (!DRY) fs.rmSync(target, { force: true });
  } else {
    step(`Instalando el puente en After Effects ${v}: ${target}`);
    if (!DRY) {
      fs.mkdirSync(startupDir(v), { recursive: true });
      fs.copyFileSync(path.join(here, "bridge", BRIDGE_FILE), target);
    }
  }
}

// ---------- 2. servidor MCP en una carpeta estable ----------
if (UNINSTALL) {
  if (path.resolve(here) !== path.resolve(HOME)) {
    step(`Borrando ${HOME}`);
    if (!DRY) fs.rmSync(HOME, { recursive: true, force: true });
  }
} else if (path.resolve(here) !== path.resolve(HOME)) {
  step(`Copiando el servidor a ${HOME}`);
  if (!DRY) {
    for (const f of FILES) {
      const dest = path.join(HOME, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(here, f), dest);
    }
  }
}
if (!UNINSTALL) {
  step("Instalando dependencias (npm install)…");
  if (!DRY) {
    try { sh("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: HOME }); }
    catch (e) { warn(`npm install falló: ${String(e.stderr || e.message).split("\n")[0]}`); }
  }
}

// ---------- 3. registrar en los clientes MCP ----------
// Claude Code y Claude Desktop, Codex, Cursor, Gemini CLI y Windsurf: se registra en los que estén instalados.
const nodeExe = process.execPath;
const HOMEDIR = process.env.USERPROFILE || process.env.HOME || "";
const entry = { command: nodeExe, args: [SERVER] };
const registered = [];

function backup(file) {
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-videazo`);
}
function editJson(file) {
  let json = {};
  if (fs.existsSync(file)) {
    backup(file);
    json = JSON.parse(fs.readFileSync(file, "utf8").trim() || "{}");
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  json.mcpServers = json.mcpServers || {};
  if (UNINSTALL) delete json.mcpServers[NAME];
  else json.mcpServers[NAME] = entry;
  fs.writeFileSync(file, JSON.stringify(json, null, 2));
}
function editToml(file) {
  let t = "";
  if (fs.existsSync(file)) {
    backup(file);
    t = fs.readFileSync(file, "utf8");
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  // Quita la sección anterior (y sus subtablas) línea por línea, sin tocar el resto, y escribe la nueva.
  const cabecera = `[mcp_servers.${NAME}]`;
  const subtabla = `[mcp_servers.${NAME}.`;
  const nl = t.includes("\r\n") ? "\r\n" : "\n";
  const salida = [];
  let saltando = false;
  for (const linea of t.split(/\r?\n/)) {
    const h = linea.trim();
    if (h.startsWith("[") && h.endsWith("]")) saltando = h === cabecera || h.startsWith(subtabla);
    if (!saltando) salida.push(linea);
  }
  t = salida.join(nl).trimEnd();
  if (!UNINSTALL) t += `${nl}${nl}${cabecera}${nl}command = ${JSON.stringify(nodeExe)}${nl}args = [${JSON.stringify(SERVER)}]`;
  fs.writeFileSync(file, `${t}${nl}`);
}

const CLIENTS = [
  {
    id: "claude-code",
    label: "Claude Code",
    detect: () => has("claude"),
    apply: () => {
      try { sh("claude", ["mcp", "remove", "--scope", "user", NAME]); } catch {}
      if (!UNINSTALL) sh("claude", ["mcp", "add", "--scope", "user", NAME, "--", `"${nodeExe}"`, `"${SERVER}"`]);
    },
  },
  { id: "claude-desktop", label: "Claude Desktop", detect: () => fs.existsSync(path.join(process.env.APPDATA || "", "Claude")), apply: () => editJson(path.join(process.env.APPDATA || "", "Claude", "claude_desktop_config.json")) },
  { id: "cursor", label: "Cursor", detect: () => fs.existsSync(path.join(HOMEDIR, ".cursor")), apply: () => editJson(path.join(HOMEDIR, ".cursor", "mcp.json")) },
  { id: "codex", label: "Codex", detect: () => fs.existsSync(path.join(HOMEDIR, ".codex")), apply: () => editToml(path.join(HOMEDIR, ".codex", "config.toml")) },
  { id: "gemini", label: "Gemini CLI", detect: () => fs.existsSync(path.join(HOMEDIR, ".gemini")), apply: () => editJson(path.join(HOMEDIR, ".gemini", "settings.json")) },
  { id: "windsurf", label: "Windsurf", detect: () => fs.existsSync(path.join(HOMEDIR, ".codeium", "windsurf")), apply: () => editJson(path.join(HOMEDIR, ".codeium", "windsurf", "mcp_config.json")) },
];

for (const c of CLIENTS) {
  // --no-claude-code, --no-codex… (y --no-desktop como atajo de --no-claude-desktop)
  if (flags.has(`--no-${c.id}`) || (c.id === "claude-desktop" && flags.has("--no-desktop"))) continue;
  if (!c.detect()) { say(`  · ${c.label} no está instalado; se omite.`); continue; }
  step(`${UNINSTALL ? "Quitando el MCP de" : "Registrando el MCP en"} ${c.label}`);
  if (DRY) { registered.push(c.label); continue; }
  try { c.apply(); registered.push(c.label); }
  catch (e) { warn(`No pude registrarlo en ${c.label}: ${String(e.stderr || e.message).split("\n")[0]}`); }
}

// ---------- 4. resumen y pendientes ----------
say();
if (UNINSTALL) { say("Listo. Reinicia After Effects y Claude."); process.exit(0); }

const pending = [];
for (const v of versions) if (scriptingPermission(v) === 0) { pending.push(PERMISSION_HELP); break; }
if (aeRunning()) pending.push("After Effects está abierto: ciérralo y ábrelo de nuevo para que cargue el puente.");
pending.push(registered.length ? `Reinicia ${registered.join(", ")} para que aparezca el MCP 'after-effects'.` : "No encontré ningún cliente MCP instalado (Claude, Codex, Cursor…): mira el README para registrarlo a mano.");

say(problems.length ? "Terminó con avisos (arriba)." : "Instalación lista.");
say("\nPendiente:");
pending.forEach((p, i) => say(`  ${i + 1}. ${p}`));
if (DRY) say("\n(Simulación: no se cambió nada.)");
