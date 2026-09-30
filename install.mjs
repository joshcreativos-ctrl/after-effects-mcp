#!/usr/bin/env node
// Instalador de After Effects MCP (by Videazo) para Windows.
//   node install.mjs               instala y registra en Claude Code y Claude Desktop
//   node install.mjs --dry-run     muestra qué haría, sin tocar nada
//   node install.mjs --uninstall   quita todo
//   Opciones: --no-claude-code  --no-desktop
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

say(UNINSTALL ? "Desinstalando After Effects MCP…" : "Instalando After Effects MCP…");
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

// ---------- 3. registrar en Claude ----------
const nodeExe = process.execPath;

if (!flags.has("--no-claude-code")) {
  if (has("claude")) {
    step(UNINSTALL ? "Quitando el MCP de Claude Code" : "Registrando el MCP en Claude Code (alcance usuario)");
    if (!DRY) {
      try { sh("claude", ["mcp", "remove", "--scope", "user", NAME]); } catch {}
      if (!UNINSTALL) {
        try { sh("claude", ["mcp", "add", "--scope", "user", NAME, "--", `"${nodeExe}"`, `"${SERVER}"`]); }
        catch (e) { warn(`No pude registrarlo en Claude Code: ${String(e.stderr || e.message).split("\n")[0]}`); }
      }
    }
  } else {
    say("  · Claude Code no está instalado; se omite.");
  }
}

if (!flags.has("--no-desktop")) {
  const cfgDir = path.join(process.env.APPDATA || "", "Claude");
  const cfg = path.join(cfgDir, "claude_desktop_config.json");
  if (fs.existsSync(cfgDir)) {
    step(UNINSTALL ? "Quitando el MCP de Claude Desktop" : "Registrando el MCP en Claude Desktop");
    if (!DRY) {
      try {
        let json = {};
        if (fs.existsSync(cfg)) {
          fs.copyFileSync(cfg, `${cfg}.bak-videazo`);
          json = JSON.parse(fs.readFileSync(cfg, "utf8") || "{}");
        }
        json.mcpServers = json.mcpServers || {};
        if (UNINSTALL) delete json.mcpServers[NAME];
        else json.mcpServers[NAME] = { command: nodeExe, args: [SERVER] };
        fs.writeFileSync(cfg, JSON.stringify(json, null, 2));
      } catch (e) { warn(`No pude editar ${cfg}: ${e.message}`); }
    }
  } else {
    say("  · Claude Desktop no está instalado; se omite.");
  }
}

// ---------- 4. resumen y pendientes ----------
say();
if (UNINSTALL) { say("Listo. Reinicia After Effects y Claude."); process.exit(0); }

const pending = [];
for (const v of versions) if (scriptingPermission(v) === 0) { pending.push(PERMISSION_HELP); break; }
if (aeRunning()) pending.push("After Effects está abierto: ciérralo y ábrelo de nuevo para que cargue el puente.");
pending.push("Reinicia Claude (Desktop o Code) para que aparezca el MCP 'after-effects'.");

say(problems.length ? "Terminó con avisos (arriba)." : "Instalación lista.");
say("\nPendiente:");
pending.forEach((p, i) => say(`  ${i + 1}. ${p}`));
if (DRY) say("\n(Simulación: no se cambió nada.)");
