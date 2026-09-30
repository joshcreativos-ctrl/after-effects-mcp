#!/usr/bin/env node
// Free After Effects MCP by Videazo Super Intelligence · servidor MCP para Adobe After Effects.
// Claude → (MCP/stdio) → este servidor → (carpeta de intercambio) → puente JSX dentro de AE.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import fss from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { callAE, ensureBridge, readStatus, DIR } from "./bridge-client.mjs";
import { findLatest as findAE } from "./ae-env.mjs";

const server = new McpServer(
  { name: "after-effects", title: "Free After Effects MCP by Videazo Super Intelligence", version: "0.1.0" },
  {
    instructions: [
      "Controla Adobe After Effects (Windows) con acceso a todo su modelo de scripting, incluidos los plugins instalados.",
      "Flujo recomendado: ae_status → ae_get_comp / ae_project_tree para ver el proyecto → ae_dump_properties para ver los parámetros exactos → ae_set_property / ae_add_effect para cambiarlos.",
      "PLUGINS: ae_list_effects lista todos los efectos instalados (incluye los de terceros). Cada efecto tiene un matchName estable (no depende del idioma); úsalo con ae_add_effect. Sus parámetros salen con ae_dump_properties y se cambian con ae_set_property, igual que los nativos.",
      "Para lo que no tenga herramienta propia usa ae_execute_script (ExtendScript completo, ES3: sin let/const/flechas/JSON) o ae_run_command (comandos de menú por nombre, incluye los de plugins).",
      "Algunos plugins solo se manejan desde su propio panel o ventana (p. ej. la escena de Element 3D); ahí combina con las herramientas de computer use.",
      "Los nombres de propiedad dependen del idioma de AE; los matchName (ADBE ...) no. Prefiere matchName.",
      "Cada cambio queda en un grupo de deshacer 'Videazo MCP' (Ctrl+Z en AE).",
    ].join("\n"),
  }
);

// ---------- utilidades ----------
const MAX_TEXT = 60000;
const ok = (data) => {
  let text = typeof data === "string" ? data : JSON.stringify(data, null, 1);
  if (text === undefined) text = "null";
  if (text.length > MAX_TEXT) text = text.slice(0, MAX_TEXT) + `\n… [recortado, ${text.length - MAX_TEXT} caracteres más; pide menos profundidad o filtra]`;
  return { content: [{ type: "text", text }] };
};
const fail = (e) => ({ isError: true, content: [{ type: "text", text: String(e?.message ?? e) }] });
const tool = (name, meta, handler) =>
  server.registerTool(name, meta, async (args) => {
    try {
      return await handler(args ?? {});
    } catch (e) {
      return fail(e);
    }
  });
const run = (code, args, opts = {}) => callAE(code, { args, ...opts });

const compRef = {
  compId: z.number().int().optional().describe("id de la composición (ae_project_tree). Si falta: compName o la composición activa."),
  compName: z.string().optional().describe("nombre de la composición"),
};
const layerRef = {
  layerIndex: z.number().int().optional().describe("índice de la capa (empieza en 1)"),
  layerName: z.string().optional().describe("nombre de la capa"),
};
const propPath = z
  .union([z.string(), z.array(z.union([z.string(), z.number()]))])
  .describe("Ruta desde la capa: array de nombres/matchNames/índices, p. ej. [\"ADBE Transform Group\",\"ADBE Position\"] o \"Transform > Position\".");
const normPath = (p) => (Array.isArray(p) ? p : String(p).split(">").map((s) => s.trim()).filter(Boolean));
const propArgs = (a) => ({ ...a, path: normPath(a.path) });

// ---------- estado y arranque ----------
tool("ae_status", { title: "Estado de After Effects", description: "Abre After Effects y el puente si hace falta, y devuelve versión, proyecto abierto e ítem activo.", inputSchema: {} }, async () => {
  const r = await run(`
    var a = app.project.activeItem;
    return { version: app.version, build: app.buildName, language: app.isoLanguage,
      project: app.project.file ? app.project.file.fsName : null, numItems: app.project.numItems,
      activeItem: a ? { id: a.id, name: a.name, type: a.typeName } : null };`);
  return ok({ ...r, bridgeDir: DIR, aeInstall: findAE()?.exe ?? null });
});

tool("ae_launch", { title: "Iniciar After Effects", description: "Abre After Effects (si está cerrado) y arranca el puente. ae_status y las demás herramientas ya lo hacen solas; úsala para forzarlo.", inputSchema: {} }, async () => {
  await ensureBridge();
  return ok({ bridge: "conectado", status: await readStatus() });
});

// ---------- script libre ----------
tool(
  "ae_execute_script",
  {
    title: "Ejecutar ExtendScript",
    description:
      "Ejecuta código ExtendScript (JS ES3) dentro de After Effects con acceso total: app, proyecto, comps, capas, efectos de plugins, system.callSystem, archivos, etc. `code` es el CUERPO de una función: usa `return` para devolver datos (números, textos, arrays y objetos simples). Están disponibles los ayudantes VZ.comp(spec), VZ.layer(comp,spec), VZ.prop(capa,ruta), VZ.describe(prop,profundidad), VZ.val, VZ.set. Sin let/const/flechas/JSON.",
    inputSchema: {
      code: z.string().describe("cuerpo de función ExtendScript"),
      undoName: z.string().optional().describe("nombre del grupo de deshacer (por defecto 'Videazo MCP')"),
      timeoutSeconds: z.number().optional().describe("máximo de espera, por defecto 60"),
    },
  },
  async ({ code, undoName, timeoutSeconds }) => ok(await callAE(code, { undo: undoName || "Videazo MCP", timeout: (timeoutSeconds || 60) * 1000 }))
);

tool(
  "ae_run_script_file",
  {
    title: "Ejecutar archivo .jsx",
    description: "Ejecuta un .jsx/.jsxbin (por ejemplo un script de un plugin o de tu carpeta Scripts) dentro de After Effects y devuelve lo que retorne.",
    inputSchema: { file: z.string().describe("ruta absoluta del script"), timeoutSeconds: z.number().optional() },
  },
  async ({ file, timeoutSeconds }) => {
    if (!fss.existsSync(file)) throw new Error(`No existe: ${file}`);
    return ok(await run(`var f = new File(A.file); if (!f.exists) throw new Error("No existe " + A.file); return $.evalFile(f);`, { file: file.replace(/\\/g, "/") }, { undo: "Videazo MCP", timeout: (timeoutSeconds || 120) * 1000 }));
  }
);

// ---------- menús y comandos (incluye los de plugins) ----------
tool(
  "ae_run_command",
  {
    title: "Ejecutar comando de menú",
    description:
      "Ejecuta un comando de menú de After Effects por su nombre exacto tal como aparece en el menú (en el idioma de AE), o por su id numérico. Sirve para menús que agregan los plugins (Efecto, Animación, Ventana, Archivo…). Devuelve el id encontrado.",
    inputSchema: { name: z.string().optional().describe("texto exacto del comando, p. ej. \"Precomponer...\""), id: z.number().int().optional().describe("id del comando (si ya lo conoces)") },
  },
  async ({ name, id }) => {
    if (!name && id === undefined) throw new Error("Indica name o id.");
    return ok(await run(`
      var id = A.id;
      if (id === undefined || id === null) { id = app.findMenuCommandId(A.name); if (!id) throw new Error("No encontré un comando de menú llamado '" + A.name + "' (usa el texto exacto del menú, en el idioma de AE)."); }
      app.executeCommand(id);
      return { executed: id };`, { name, id }, { undo: "Videazo MCP" }));
  }
);

// ---------- plugins ----------
tool(
  "ae_list_effects",
  {
    title: "Listar efectos instalados",
    description:
      "Lista los efectos/plugins que After Effects tiene cargados: nombre, matchName, categoría y versión. Incluye los de terceros (Video Copilot, Red Giant, Sapphire, etc.). Usa filter/category para acotar; thirdPartyOnly excluye los nativos de Adobe (matchName que empieza con 'ADBE').",
    inputSchema: {
      filter: z.string().optional().describe("texto a buscar en nombre o matchName (sin distinguir mayúsculas)"),
      category: z.string().optional().describe("categoría exacta"),
      thirdPartyOnly: z.boolean().optional(),
      limit: z.number().int().optional().describe("máximo de resultados, por defecto 300"),
    },
  },
  async (a) =>
    ok(
      await run(`
        var f = (A.filter || "").toLowerCase(), out = [], cats = {}, total = 0;
        for (var i = 0; i < app.effects.length; i++) {
          var e = app.effects[i];
          if (A.category && e.category !== A.category) continue;
          if (A.thirdPartyOnly && e.matchName.indexOf("ADBE") === 0) continue;
          if (f && e.displayName.toLowerCase().indexOf(f) < 0 && e.matchName.toLowerCase().indexOf(f) < 0) continue;
          total++;
          cats[e.category] = (cats[e.category] || 0) + 1;
          if (out.length < (A.limit || 300)) out.push({ name: e.displayName, matchName: e.matchName, category: e.category, version: e.version });
        }
        return { total: total, returned: out.length, categories: cats, effects: out };`, a)
    )
);

tool(
  "ae_list_plugin_files",
  {
    title: "Listar archivos de plugins",
    description:
      "Recorre el disco y lista los plugins instalados: .aex de After Effects, scripts y paneles (Scripts, ScriptUI Panels, Startup), plugins compartidos de Adobe (MediaCore) y extensiones CEP. Útil para saber qué hay instalado aunque no cargue como efecto.",
    inputSchema: {},
  },
  async () => {
    const ae = findAE();
    const pf = process.env["ProgramFiles"] || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const dirs = {
      "AE Plug-ins": ae && path.join(ae.support, "Plug-ins"),
      "AE Scripts": ae && path.join(ae.support, "Scripts"),
      "AE ScriptUI Panels": ae && path.join(ae.support, "Scripts", "ScriptUI Panels"),
      "AE Startup": ae && path.join(ae.support, "Scripts", "Startup"),
      "Adobe MediaCore (compartido)": path.join(pf, "Adobe", "Common", "Plug-ins", "7.0", "MediaCore"),
      "CEP (sistema)": path.join(pf86, "Common Files", "Adobe", "CEP", "extensions"),
      "CEP (usuario)": path.join(process.env.APPDATA || "", "Adobe", "CEP", "extensions"),
    };
    const out = {};
    for (const [label, dir] of Object.entries(dirs)) {
      if (!dir || !fss.existsSync(dir)) continue;
      const items = [];
      const walk = async (d, depth) => {
        if (label.startsWith("CEP")) {
          // Una entrada por extensión (su carpeta), no cada archivo de dentro.
          for (const e of await fs.readdir(d, { withFileTypes: true })) if (e.isDirectory()) items.push(e.name);
          return;
        }
        for (const e of await fs.readdir(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) {
            if (depth < 2 && label !== "AE Plug-ins") await walk(full, depth + 1);
            else if (label === "AE Plug-ins" || depth === 0) items.push(path.relative(dir, full) + path.sep);
          } else if (/\.(aex|jsx|jsxbin|js|plugin|prm|dll|mxx)$/i.test(e.name)) items.push(path.relative(dir, full));
        }
      };
      try { await walk(dir, 0); } catch {}
      out[label] = { path: dir, count: items.length, items: items.slice(0, 200) };
    }
    return ok(out);
  }
);

// ---------- proyecto y composiciones ----------
tool("ae_project_tree", { title: "Árbol del proyecto", description: "Muestra carpetas, comps y footage del proyecto abierto (con ids).", inputSchema: {} }, async () =>
  ok(await run(`return { file: app.project.file ? app.project.file.fsName : null, items: VZ.tree(app.project.rootFolder) };`))
);

tool(
  "ae_get_comp",
  { title: "Ver composición", description: "Datos de una composición y todas sus capas (índice, nombre, tipo, tiempos, padre y efectos con matchName).", inputSchema: { ...compRef, includeLayers: z.boolean().optional().describe("por defecto true") } },
  async (a) => ok(await run(`return VZ.compInfo(VZ.comp(A), A.includeLayers !== false);`, a))
);

tool(
  "ae_create_comp",
  {
    title: "Crear composición",
    description: "Crea una composición nueva y la abre en el visor.",
    inputSchema: {
      name: z.string(),
      width: z.number().int().default(1920),
      height: z.number().int().default(1080),
      frameRate: z.number().default(30),
      duration: z.number().default(10).describe("segundos"),
      pixelAspect: z.number().default(1),
      backgroundColor: z.array(z.number()).length(3).optional().describe("[r,g,b] de 0 a 1"),
    },
  },
  async (a) =>
    ok(await run(`
      var c = app.project.items.addComp(A.name, A.width, A.height, A.pixelAspect, A.duration, A.frameRate);
      if (A.backgroundColor) c.bgColor = A.backgroundColor;
      c.openInViewer();
      return VZ.compInfo(c, false);`, a, { undo: "Videazo MCP" }))
);

tool(
  "ae_import_files",
  {
    title: "Importar archivos",
    description: "Importa archivos (video, imagen, audio, .aep, secuencias) al proyecto. Devuelve los ids de los ítems.",
    inputSchema: { files: z.array(z.string()).min(1).describe("rutas absolutas"), asSequence: z.boolean().optional().describe("importar como secuencia de imágenes") },
  },
  async (a) => {
    for (const f of a.files) if (!fss.existsSync(f)) throw new Error(`No existe: ${f}`);
    return ok(await run(`
      var out = [];
      for (var i = 0; i < A.files.length; i++) {
        var io = new ImportOptions(new File(A.files[i]));
        if (A.asSequence) io.sequence = true;
        var it = app.project.importFile(io);
        out.push({ id: it.id, name: it.name, type: it.typeName });
      }
      return out;`, { ...a, files: a.files.map((f) => f.replace(/\\/g, "/")) }, { undo: "Videazo MCP", timeout: 180000 }));
  }
);

tool(
  "ae_add_layer",
  {
    title: "Agregar capa",
    description: "Agrega una capa a una composición: text, solid, adjustment, null, shape, camera, light, o un ítem del proyecto (footage/comp) con itemId.",
    inputSchema: {
      ...compRef,
      kind: z.enum(["text", "solid", "adjustment", "null", "shape", "camera", "light", "item"]),
      name: z.string().optional(),
      text: z.string().optional().describe("contenido, para kind=text"),
      color: z.array(z.number()).length(3).optional().describe("[r,g,b] 0-1, para solid"),
      itemId: z.number().int().optional().describe("id del ítem, para kind=item"),
      startTime: z.number().optional(),
      duration: z.number().optional(),
    },
  },
  async (a) =>
    ok(await run(`
      var c = VZ.comp(A), l, d = A.duration || c.duration;
      if (A.kind === "text") l = c.layers.addText(A.text || "");
      else if (A.kind === "solid") l = c.layers.addSolid(A.color || [1, 1, 1], A.name || "Sólido", c.width, c.height, c.pixelAspect, d);
      else if (A.kind === "adjustment") { l = c.layers.addSolid([1, 1, 1], A.name || "Capa de ajuste", c.width, c.height, c.pixelAspect, d); l.adjustmentLayer = true; }
      else if (A.kind === "null") l = c.layers.addNull(d);
      else if (A.kind === "shape") l = c.layers.addShape();
      else if (A.kind === "camera") l = c.layers.addCamera(A.name || "Cámara", [c.width / 2, c.height / 2]);
      else if (A.kind === "light") l = c.layers.addLight(A.name || "Luz", [c.width / 2, c.height / 2]);
      else { var it = app.project.itemByID(A.itemId); if (!it) throw new Error("No hay ítem con id " + A.itemId); l = c.layers.add(it); }
      if (A.name && A.kind !== "solid" && A.kind !== "adjustment") l.name = A.name;
      if (A.startTime !== undefined) l.startTime = A.startTime;
      return { comp: c.name, index: l.index, name: l.name, kind: l.matchName };`, a, { undo: "Videazo MCP" }))
);

tool("ae_save_project", { title: "Guardar proyecto", description: "Guarda el proyecto; con path lo guarda como un .aep nuevo.", inputSchema: { path: z.string().optional() } }, async ({ path: p }) =>
  ok(await run(`if (A.path) app.project.save(new File(A.path)); else app.project.save(); return app.project.file ? app.project.file.fsName : null;`, { path: p?.replace(/\\/g, "/") }))
);

// ---------- propiedades y efectos (nativos y de plugins) ----------
tool(
  "ae_dump_properties",
  {
    title: "Ver propiedades",
    description:
      "Vuelca el árbol de propiedades de una capa (o de una ruta dentro de ella) con name, matchName, valor, expresión, keyframes y límites. Con path=[\"ADBE Effect Parade\"] ves todos los efectos y sus parámetros, incluidos los de plugins de terceros. Es la forma de descubrir los matchName exactos.",
    inputSchema: { ...compRef, ...layerRef, path: propPath.optional().describe("vacío = toda la capa"), depth: z.number().int().min(0).max(8).optional().describe("niveles hacia abajo, por defecto 3") },
  },
  async (a) =>
    ok(await run(`
      var c = VZ.comp(A), l = VZ.layer(c, A);
      var root = A.path && A.path.length ? VZ.prop(l, A.path) : l;
      return VZ.describe(root, A.depth === undefined ? 3 : A.depth);`, { ...a, path: a.path ? normPath(a.path) : [] }))
);

tool(
  "ae_set_property",
  {
    title: "Cambiar propiedad",
    description:
      "Cambia una propiedad de capa o de efecto (nativo o de plugin): valor fijo, expresión y/o keyframes. Valores: número, [x,y], [x,y,z], color [r,g,b,a] 0-1; texto como string u objeto {text,font,fontSize,fillColor…}; formas como {vertices,inTangents,outTangents,closed}. Los tiempos van en segundos.",
    inputSchema: {
      ...compRef,
      ...layerRef,
      path: propPath,
      value: z.any().optional().describe("valor fijo"),
      expression: z.string().optional().describe("expresión; \"\" la quita"),
      clearKeyframes: z.boolean().optional().describe("borrar keyframes existentes antes de aplicar"),
      keyframes: z
        .array(z.object({ time: z.number(), value: z.any(), inEase: z.enum(["linear", "hold", "bezier"]).optional(), outEase: z.enum(["linear", "hold", "bezier"]).optional() }))
        .optional(),
    },
  },
  async (a) =>
    ok(await run(`
      var c = VZ.comp(A), l = VZ.layer(c, A), p = VZ.prop(l, A.path);
      if (p.propertyType !== PropertyType.PROPERTY) throw new Error("La ruta apunta a un grupo, no a una propiedad. Usa ae_dump_properties para ver los parámetros.");
      var i;
      if (A.clearKeyframes) for (i = p.numKeys; i >= 1; i--) p.removeKey(i);
      if (A.value !== undefined && A.value !== null) VZ.set(p, A.value);
      if (A.keyframes) {
        var ip = { linear: KeyframeInterpolationType.LINEAR, hold: KeyframeInterpolationType.HOLD, bezier: KeyframeInterpolationType.BEZIER };
        for (i = 0; i < A.keyframes.length; i++) {
          var k = A.keyframes[i];
          p.setValueAtTime(k.time, k.value);
          if (k.inEase || k.outEase) {
            var idx = p.nearestKeyIndex(k.time);
            p.setInterpolationTypeAtKey(idx, ip[k.inEase || "bezier"], ip[k.outEase || "bezier"]);
          }
        }
      }
      if (A.expression !== undefined) { p.expression = A.expression; }
      return VZ.describe(p, 0);`, propArgs(a), { undo: "Videazo MCP" }))
);

tool(
  "ae_add_effect",
  {
    title: "Agregar efecto",
    description:
      "Agrega un efecto (nativo o de plugin) a una capa por su matchName (ver ae_list_effects) y opcionalmente fija parámetros. Cada parámetro se identifica por nombre, matchName o índice dentro del efecto (ver ae_dump_properties).",
    inputSchema: {
      ...compRef,
      ...layerRef,
      matchName: z.string().describe("p. ej. \"ADBE Gaussian Blur 2\" o el matchName de un plugin"),
      name: z.string().optional().describe("nombre visible del efecto en la capa"),
      params: z.array(z.object({ key: z.union([z.string(), z.number()]), value: z.any() })).optional(),
    },
  },
  async (a) =>
    ok(await run(`
      var c = VZ.comp(A), l = VZ.layer(c, A);
      var parade = l.property("ADBE Effect Parade");
      if (!parade) throw new Error("Esta capa no admite efectos.");
      var fx = parade.addProperty(A.matchName);
      if (!fx) throw new Error("No se pudo agregar '" + A.matchName + "'. ¿Está instalado? Revisa ae_list_effects.");
      if (A.name) fx.name = A.name;
      var notes = [];
      if (A.params) for (var i = 0; i < A.params.length; i++) {
        try { var p = fx.property(A.params[i].key); if (!p) throw new Error("no existe"); VZ.set(p, A.params[i].value); }
        catch (e) { notes.push("No se pudo fijar '" + A.params[i].key + "': " + e); }
      }
      var d = VZ.describe(fx, 0); d.notes = notes; d.layer = l.name; d.hint = "Usa ae_dump_properties con path [\"ADBE Effect Parade\", \"" + fx.name + "\"] para ver sus parametros.";
      return d;`, a, { undo: "Videazo MCP" }))
);

// ---------- ver el resultado ----------
tool(
  "ae_capture_frame",
  {
    title: "Capturar fotograma",
    description: "Renderiza un fotograma de una composición a PNG y me lo devuelve como imagen, para revisar visualmente el resultado.",
    inputSchema: { ...compRef, time: z.number().optional().describe("segundos; por defecto el tiempo actual de la comp") },
  },
  async (a) => {
    const dir = path.join(DIR, "frames");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `frame-${Date.now()}.png`);
    const info = await run(`
      var c = VZ.comp(A);
      var t = (A.time === undefined || A.time === null) ? c.time : A.time;
      if (typeof c.saveFrameToPng !== "function") throw new Error("Esta versión de After Effects no tiene saveFrameToPng.");
      c.saveFrameToPng(t, new File(A.file));
      return { comp: c.name, time: t };`, { ...a, file: file.replace(/\\/g, "/") }, { timeout: 120000 });
    // AE crea el archivo antes de terminar de escribirlo: esperar a que tenga tamaño y deje de crecer.
    let last = -1;
    for (let i = 0; i < 100; i++) {
      const size = fss.existsSync(file) ? fss.statSync(file).size : 0;
      if (size > 0 && size === last) break;
      last = size;
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!(last > 0)) throw new Error("After Effects no generó el PNG (¿la comp está vacía o el renderizado falló?).");
    const data = (await fs.readFile(file)).toString("base64");
    return { content: [{ type: "text", text: JSON.stringify(info) }, { type: "image", data, mimeType: "image/png" }] };
  }
);

tool(
  "ae_render",
  {
    title: "Renderizar con aerender",
    description: "Renderiza sin interfaz con aerender.exe (el proyecto debe estar guardado). Devuelve el final de la salida. Para videos largos sube timeoutMinutes.",
    inputSchema: {
      project: z.string().describe("ruta del .aep"),
      comp: z.string().optional().describe("nombre de la comp; sin esto usa la cola de render del proyecto"),
      output: z.string().optional().describe("ruta del archivo de salida"),
      renderSettingsTemplate: z.string().optional(),
      outputModuleTemplate: z.string().optional(),
      startFrame: z.number().int().optional(),
      endFrame: z.number().int().optional(),
      multiProcess: z.boolean().optional(),
      timeoutMinutes: z.number().optional().describe("por defecto 30"),
    },
  },
  async (a) => {
    const ae = findAE();
    if (!ae) throw new Error("No encontré After Effects.");
    const exe = path.join(ae.support, "aerender.exe");
    const args = ["-project", a.project];
    if (a.comp) args.push("-comp", a.comp);
    if (a.output) args.push("-output", a.output);
    if (a.renderSettingsTemplate) args.push("-RStemplate", a.renderSettingsTemplate);
    if (a.outputModuleTemplate) args.push("-OMtemplate", a.outputModuleTemplate);
    if (a.startFrame !== undefined) args.push("-s", String(a.startFrame));
    if (a.endFrame !== undefined) args.push("-e", String(a.endFrame));
    if (a.multiProcess) args.push("-mp");
    const child = spawn(exe, args, { windowsHide: true });
    let log = "";
    child.stdout.on("data", (d) => (log += d));
    child.stderr.on("data", (d) => (log += d));
    const limit = (a.timeoutMinutes || 30) * 60000;
    const code = await new Promise((resolve) => {
      const t = setTimeout(() => { child.kill(); resolve("timeout"); }, limit);
      child.on("close", (c) => { clearTimeout(t); resolve(c); });
    });
    return ok({ exitCode: code, output: a.output ?? null, log: log.split(/\r?\n/).slice(-40).join("\n") });
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
