// Videazo · puente de After Effects (ExtendScript, ES3).
// Corre dentro de After Effects, revisa una carpeta cada 100 ms, ejecuta lo que
// le manda el servidor MCP y escribe el resultado.
// Lo instala el instalador de Videazo en la carpeta Scripts/Startup del usuario, así
// arranca solo con After Effects. También sirve Archivo > Scripts > Ejecutar archivo.
$.global.VZ_BRIDGE_VERSION = 2;
$.global.VZ_start = function () {
  var G = $.global;

  // Necesita el permiso de scripting de After Effects (escribir archivos y acceder a la red).
  try {
    var allowed = app.preferences.getPrefAsLong("Main Pref Section v2", "Pref_SCRIPTING_FILE_NETWORK_SECURITY");
    if (allowed !== 1) {
      if (!G.VZ_ALERTED) {
        G.VZ_ALERTED = true;
        var lang = "en";
        try { lang = String(app.isoLanguage).substr(0, 2); } catch (e0) {}
        var M = {
    es: ["Videazo MCP necesita activar un ajuste de After Effects (una sola vez):", "Editar > Preferencias > Scripts y expresiones", "y activa \"Permitir que las secuencias de comandos puedan escribir archivos y acceder a la red\".", "Despu\u00e9s reinicia After Effects."],
    en: ["Videazo MCP needs one After Effects setting turned on (only once):", "Edit > Preferences > Scripting & Expressions", "and turn on \"Allow Scripts to Write Files and Access Network\".", "Then restart After Effects."],
    fr: ["Videazo MCP a besoin d'un r\u00e9glage d'After Effects (une seule fois) :", "\u00c9dition > Pr\u00e9f\u00e9rences > Scripts et expressions", "et active \u00ab Autoriser les scripts \u00e0 \u00e9crire des fichiers et \u00e0 acc\u00e9der au r\u00e9seau \u00bb.", "Ensuite, red\u00e9marre After Effects."],
    pt: ["O Videazo MCP precisa que voc\u00ea ative um ajuste do After Effects (uma \u00fanica vez):", "Editar > Prefer\u00eancias > Scripts e express\u00f5es", "e ative \"Permitir que os scripts gravem arquivos e acessem a rede\".", "Depois reinicie o After Effects."],
    zh: ["Videazo MCP \u9700\u8981\u4f60\u5f00\u542f After Effects \u7684\u4e00\u9879\u8bbe\u7f6e\uff08\u4ec5\u9700\u4e00\u6b21\uff09\uff1a", "\u7f16\u8f91 > \u9996\u9009\u9879 > \u811a\u672c\u548c\u8868\u8fbe\u5f0f", "\u5e76\u52fe\u9009\u201c\u5141\u8bb8\u811a\u672c\u5199\u5165\u6587\u4ef6\u548c\u8bbf\u95ee\u7f51\u7edc\u201d\u3002", "\u7136\u540e\u91cd\u542f After Effects\u3002"],
    zz: []
  };
        var m = M[lang] || M.en;
        alert(m[0] + "\n\n" + m[1] + "\n" + m[2] + "\n\n" + m[3]);
      }
      return;
    }
  } catch (e) {}

  var DIR = G.VZ_DIR || (Folder.userData.fsName.replace(/\\/g, "/") + "/Videazo/ae-bridge");
  new Folder(Folder.userData.fsName + "/Videazo").create();
  var INBOX = DIR + "/inbox";
  var OUTBOX = DIR + "/outbox";
  new Folder(DIR).create();
  new Folder(INBOX).create();
  new Folder(OUTBOX).create();

  // Si el puente ya corría, esta ejecución lo reemplaza (las tareas viejas se apagan solas).
  G.VZ_GEN = (G.VZ_GEN || 0) + 1;
  var gen = G.VZ_GEN;
  var lastBeat = 0;

  // ---------- archivos y JSON (ExtendScript no trae JSON) ----------
  function readText(f) {
    f.encoding = "UTF-8";
    if (!f.open("r")) return null;
    var s = f.read();
    f.close();
    return s;
  }
  function writeAtomic(dir, name, text) {
    var tmp = new File(dir + "/" + name + ".tmp");
    tmp.encoding = "UTF-8";
    tmp.open("w");
    tmp.write(text);
    tmp.close();
    var target = new File(dir + "/" + name);
    if (target.exists) target.remove();
    tmp.rename(name);
  }
  function esc(s) {
    return '"' + s.replace(/[\\"\u0000-\u001f\u2028\u2029]/g, function (c) {
      if (c === '"') return '\\"';
      if (c === "\\") return "\\\\";
      if (c === "\n") return "\\n";
      if (c === "\r") return "\\r";
      if (c === "\t") return "\\t";
      return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
    }) + '"';
  }
  function ser(v, d) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return String(v);
    if (t === "string") return esc(v);
    if (t === "function") return "null";
    if (d > 16) return '"[demasiado profundo]"';
    if (v instanceof Array || v.constructor === Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(ser(v[i], d + 1));
      return "[" + a.join(",") + "]";
    }
    if (v instanceof File || v instanceof Folder) return esc(v.fsName);
    if (v.constructor === Object) {
      var parts = [];
      for (var k in v) {
        var x;
        try { x = v[k]; } catch (e) { continue; }
        if (typeof x === "function") continue;
        parts.push(esc(k) + ":" + ser(x, d + 1));
      }
      return "{" + parts.join(",") + "}";
    }
    return esc(String(v)); // objetos de After Effects: solo su nombre
  }
  G.VZ_ser = function (v) { return ser(v, 0); };

  // ---------- ayudas para las herramientas ----------
  var VZ = G.VZ = {};

  VZ.comp = function (s) {
    s = s || {};
    var i, it;
    if (s.compId !== undefined && s.compId !== null) {
      it = app.project.itemByID(s.compId);
      if (it instanceof CompItem) return it;
      throw new Error("No hay composición con id " + s.compId);
    }
    if (s.compName) {
      for (i = 1; i <= app.project.numItems; i++) {
        it = app.project.item(i);
        if (it instanceof CompItem && it.name === s.compName) return it;
      }
      throw new Error("No hay composición llamada '" + s.compName + "'");
    }
    if (app.project.activeItem instanceof CompItem) return app.project.activeItem;
    throw new Error("No hay composición activa: indica compId o compName.");
  };

  VZ.layer = function (comp, s) {
    s = s || {};
    if (s.layerIndex !== undefined && s.layerIndex !== null) {
      if (s.layerIndex < 1 || s.layerIndex > comp.numLayers) throw new Error("layerIndex fuera de rango (1-" + comp.numLayers + ")");
      return comp.layer(s.layerIndex);
    }
    if (s.layerName) {
      var l = comp.layer(s.layerName);
      if (l) return l;
      throw new Error("No hay capa llamada '" + s.layerName + "'");
    }
    throw new Error("Indica layerIndex o layerName.");
  };

  VZ.prop = function (root, path) {
    var p = root;
    for (var i = 0; i < path.length; i++) {
      var next = null;
      try { next = p.property(path[i]); } catch (e) {}
      if (!next) throw new Error("No existe '" + path[i] + "' en la ruta [" + path.join(" > ") + "]");
      p = next;
    }
    return p;
  };

  var VT = {};
  VT[PropertyValueType.NO_VALUE] = "NO_VALUE";
  VT[PropertyValueType.ThreeD_SPATIAL] = "ThreeD_SPATIAL";
  VT[PropertyValueType.ThreeD] = "ThreeD";
  VT[PropertyValueType.TwoD_SPATIAL] = "TwoD_SPATIAL";
  VT[PropertyValueType.TwoD] = "TwoD";
  VT[PropertyValueType.OneD] = "OneD";
  VT[PropertyValueType.COLOR] = "COLOR";
  VT[PropertyValueType.CUSTOM_VALUE] = "CUSTOM_VALUE";
  VT[PropertyValueType.MARKER] = "MARKER";
  VT[PropertyValueType.LAYER_INDEX] = "LAYER_INDEX";
  VT[PropertyValueType.MASK_INDEX] = "MASK_INDEX";
  VT[PropertyValueType.SHAPE] = "SHAPE";
  VT[PropertyValueType.TEXT_DOCUMENT] = "TEXT_DOCUMENT";

  VZ.val = function (p) {
    var t = p.propertyValueType;
    if (t === PropertyValueType.NO_VALUE || t === PropertyValueType.CUSTOM_VALUE) return null;
    var v = p.value;
    if (t === PropertyValueType.SHAPE) {
      return { vertices: v.vertices, inTangents: v.inTangents, outTangents: v.outTangents, closed: v.closed };
    }
    if (t === PropertyValueType.TEXT_DOCUMENT) {
      var o = {}, keys = ["text", "font", "fontSize", "fillColor", "strokeColor", "applyFill", "applyStroke", "strokeWidth", "justification", "tracking", "leading"];
      for (var i = 0; i < keys.length; i++) { try { o[keys[i]] = v[keys[i]]; } catch (e) {} }
      return o;
    }
    if (t === PropertyValueType.MARKER) return { comment: v.comment, duration: v.duration };
    return v;
  };

  VZ.set = function (p, value) {
    var t = p.propertyValueType;
    if (t === PropertyValueType.SHAPE) {
      var s = new Shape();
      s.vertices = value.vertices; s.inTangents = value.inTangents; s.outTangents = value.outTangents;
      s.closed = value.closed !== false;
      p.setValue(s);
    } else if (t === PropertyValueType.TEXT_DOCUMENT) {
      var td = p.value;
      if (typeof value === "string") value = { text: value };
      for (var k in value) td[k] = value[k];
      p.setValue(td);
    } else {
      p.setValue(value);
    }
  };

  // Describe una propiedad o grupo (recursivo). Sirve igual para efectos de terceros.
  VZ.describe = function (p, depth) {
    var e = { name: p.name, matchName: p.matchName, index: p.propertyIndex };
    if (p.propertyType === PropertyType.PROPERTY) {
      e.kind = "property";
      e.valueType = VT[p.propertyValueType];
      try { e.value = VZ.val(p); } catch (x) { e.value = "[no legible]"; }
      try { if (p.canSetExpression && p.expression) { e.expression = p.expression; e.expressionEnabled = p.expressionEnabled; } } catch (x1) {}
      e.numKeys = p.numKeys;
      try { if (p.hasMin) e.min = p.minValue; if (p.hasMax) e.max = p.maxValue; } catch (x2) {}
    } else {
      e.kind = p.propertyType === PropertyType.INDEXED_GROUP ? "indexedGroup" : "group";
      try { if (p.canSetEnabled) e.enabled = p.enabled; } catch (x3) {}
      e.numProperties = p.numProperties;
      if (depth > 0) {
        e.children = [];
        for (var i = 1; i <= p.numProperties; i++) e.children.push(VZ.describe(p.property(i), depth - 1));
      }
    }
    return e;
  };

  VZ.compInfo = function (c, withLayers) {
    var o = { id: c.id, name: c.name, width: c.width, height: c.height, pixelAspect: c.pixelAspect,
      frameRate: c.frameRate, duration: c.duration, time: c.time, numLayers: c.numLayers,
      workAreaStart: c.workAreaStart, workAreaDuration: c.workAreaDuration };
    if (withLayers) {
      o.layers = [];
      for (var i = 1; i <= c.numLayers; i++) {
        var l = c.layer(i), fx = [];
        try {
          var g = l.property("ADBE Effect Parade");
          if (g) for (var j = 1; j <= g.numProperties; j++) fx.push({ name: g.property(j).name, matchName: g.property(j).matchName, enabled: g.property(j).enabled });
        } catch (e) {}
        o.layers.push({ index: l.index, name: l.name, kind: l.matchName, enabled: l.enabled, solo: l.solo, locked: l.locked,
          shy: l.shy, inPoint: l.inPoint, outPoint: l.outPoint, startTime: l.startTime,
          parent: l.parent ? l.parent.index : null, threeD: l.threeDLayer === true, effects: fx });
      }
    }
    return o;
  };

  VZ.tree = function (folder) {
    var out = [];
    for (var i = 1; i <= folder.numItems; i++) {
      var it = folder.item(i), e = { id: it.id, name: it.name, type: it.typeName };
      if (it instanceof FolderItem) e.items = VZ.tree(it);
      else if (it instanceof CompItem) { e.width = it.width; e.height = it.height; e.frameRate = it.frameRate; e.duration = it.duration; e.numLayers = it.numLayers; }
      else {
        try { if (it.mainSource && it.mainSource.file) e.file = it.mainSource.file.fsName; } catch (x) {}
        try { e.width = it.width; e.height = it.height; e.duration = it.duration; } catch (x2) {}
      }
      out.push(e);
    }
    return out;
  };

  // ---------- bucle principal ----------
  function run(req) {
    var res = { id: req.id };
    var opened = false;
    try {
      if (req.undo) { app.beginUndoGroup(req.undo); opened = true; }
      var v = eval(req.code);
      res.ok = true;
      res.result = v;
    } catch (e) {
      res.ok = false;
      res.error = String(e && e.message ? e.message : e);
      try { res.line = e.line; } catch (x) {}
    }
    if (opened) { try { app.endUndoGroup(); } catch (x2) {} }
    var text;
    try { text = ser(res, 0); } catch (e2) { text = ser({ id: req.id, ok: false, error: "No se pudo serializar el resultado: " + e2 }, 0); }
    writeAtomic(OUTBOX, req.id + ".json", text);
  }

  G.VZ_tick = function (g) {
    if (g !== G.VZ_GEN) return; // hay un puente más nuevo
    try {
      var now = new Date().getTime();
      if (now - lastBeat > 1000) {
        lastBeat = now;
        var proj = "";
        try { proj = app.project.file ? app.project.file.fsName : ""; } catch (e) {}
        writeAtomic(DIR, "status.json", ser({ ts: now, gen: gen, version: app.version, bridgeVersion: G.VZ_BRIDGE_VERSION, project: proj }, 0));
      }
      var files = new Folder(INBOX).getFiles("*.json");
      files.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
      for (var i = 0; i < files.length; i++) {
        var txt = readText(files[i]);
        files[i].remove();
        if (!txt) continue;
        var req;
        try { req = eval("(" + txt + ")"); } catch (pe) { continue; }
        run(req);
      }
    } catch (err) {}
    app.scheduleTask("VZ_tick(" + g + ")", 100, false);
  };

  G.VZ_tick(gen);
};
// Se difiere un momento: como script de inicio corre antes de que AE termine de arrancar.
app.scheduleTask("VZ_start()", 3000, false);
