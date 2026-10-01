#!/usr/bin/env node
// Instalador de Free After Effects MCP by Videazo Super Intelligence (Windows).
//   node install.mjs               instala y registra en Claude Code y Claude Desktop
//   node install.mjs --dry-run     muestra qué haría, sin tocar nada
//   node install.mjs --uninstall   quita todo
//   Opciones: --no-claude-code --no-claude-desktop --no-codex --no-cursor --no-gemini --no-windsurf
//   Idioma:   --lang=es|en|fr|pt|zh (por defecto, el idioma de Windows)
// No pide administrador: todo va a carpetas del usuario.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BRIDGE_FILE, findInstalls, startupDir, startupFile, scriptingPermission } from "./ae-env.mjs";
import { pickLang, makeT } from "./install-i18n.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const flags = new Set(process.argv.slice(2));
const DRY = flags.has("--dry-run");
const UNINSTALL = flags.has("--uninstall");
const NAME = "after-effects";
const HOME = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || "", "AppData", "Local"), "Videazo", "ae-mcp");
const SERVER = path.join(HOME, "server.mjs");
const FILES = ["server.mjs", "bridge-client.mjs", "ae-env.mjs", "install.mjs", "install-i18n.mjs", "package.json", "README.md", "LICENSE", "Instalar.cmd", "Desinstalar.cmd", path.join("bridge", BRIDGE_FILE)];

const t = makeT(pickLang());
const say = (m = "") => console.log(m);
const step = (m) => say(`${DRY ? t("dry_prefix") : ""}${m}`);
const problems = [];
const warn = (m) => { problems.push(m); say(`  ! ${m}`); };

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: true, ...opts });
}
const has = (cmd) => { try { sh("where", [cmd]); return true; } catch { return false; } };
const aeRunning = () => { try { return /AfterFX\.exe/i.test(sh("tasklist", ["/FI", '"IMAGENAME eq AfterFX.exe"', "/NH"])); } catch { return false; } };

if (process.platform !== "win32") { say(t("only_windows")); process.exit(1); }
if (Number(process.versions.node.split(".")[0]) < 18) { say(t("node_old", { v: process.versions.node })); process.exit(1); }

const installs = findInstalls();
if (!installs.length) { say(t("no_ae")); process.exit(1); }
const versions = [...new Set(installs.map((i) => i.version).filter(Boolean))];

say(UNINSTALL ? t("uninstall_title") : t("install_title"));
say(`${t("ae_found", { list: installs.map((i) => `${i.name} (${i.version ?? "?"})`).join(", ") })}\n`);

// ---------- 1. puente dentro de After Effects (carpeta de inicio del usuario) ----------
for (const v of versions) {
  const target = startupFile(v);
  if (UNINSTALL) {
    step(t("bridge_remove", { path: target }));
    if (!DRY) fs.rmSync(target, { force: true });
  } else {
    step(t("bridge_install", { v, path: target }));
    if (!DRY) {
      fs.mkdirSync(startupDir(v), { recursive: true });
      fs.copyFileSync(path.join(here, "bridge", BRIDGE_FILE), target);
    }
  }
}

// ---------- 2. servidor MCP en una carpeta estable ----------
if (UNINSTALL) {
  if (path.resolve(here) !== path.resolve(HOME)) {
    step(t("home_remove", { path: HOME }));
    if (!DRY) fs.rmSync(HOME, { recursive: true, force: true });
  }
} else if (path.resolve(here) !== path.resolve(HOME)) {
  step(t("server_copy", { path: HOME }));
  if (!DRY) {
    for (const f of FILES) {
      const dest = path.join(HOME, f);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(here, f), dest);
    }
  }
}
if (!UNINSTALL) {
  step(t("npm_install"));
  if (!DRY) {
    try { sh("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], { cwd: HOME }); }
    catch (e) { warn(t("npm_fail", { msg: String(e.stderr || e.message).split("\n")[0] })); }
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
  if (!c.detect()) { say(`  · ${t("not_installed", { label: c.label })}`); continue; }
  step(t(UNINSTALL ? "unregister" : "register", { label: c.label }));
  if (DRY) { registered.push(c.label); continue; }
  try { c.apply(); registered.push(c.label); }
  catch (e) { warn(t("register_fail", { label: c.label, msg: String(e.stderr || e.message).split("\n")[0] })); }
}

// ---------- 4. resumen y pendientes ----------
say();
if (UNINSTALL) { say(t("uninstall_done")); process.exit(0); }

const pending = [];
for (const v of versions) if (scriptingPermission(v) === 0) { pending.push(t("perm_help")); break; }
if (aeRunning()) pending.push(t("ae_open"));
pending.push(registered.length ? t("restart_clients", { list: registered.join(", ") }) : t("no_clients"));

say(problems.length ? t("done_warn") : t("done_ok"));
say(`\n${t("pending")}`);
pending.forEach((p, i) => say(`  ${i + 1}. ${p}`));
if (DRY) say(`\n${t("dry_note")}`);
