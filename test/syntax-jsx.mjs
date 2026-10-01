// Revisa que el código ExtendScript que genera cada herramienta tenga sintaxis válida (como JavaScript).
// Atrapa errores de comillas y escapes dentro de las plantillas de server.mjs sin necesitar After Effects.
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const src = fs.readFileSync(fileURLToPath(new URL("../server.mjs", import.meta.url)), "utf8");
const marcas = ["run(`", "callAE(`"];
let revisados = 0, fallos = 0, saltados = 0;

for (const marca of marcas) {
  let desde = 0;
  for (;;) {
    const i = src.indexOf(marca, desde);
    if (i < 0) break;
    // lee la plantilla hasta la comilla invertida de cierre que no esté escapada
    let j = i + marca.length;
    while (j < src.length && src[j] !== "`") j += src[j] === "\\" ? 2 : 1;
    const crudo = src.slice(i + marca.length, j);
    desde = j + 1;
    const linea = src.slice(0, i).split("\n").length;
    let jsx;
    try { jsx = vm.runInNewContext("`" + crudo + "`", {}); }
    catch { saltados++; continue; } // plantillas con ${...} dinámicas
    revisados++;
    try { new vm.Script(`(function(){\n${jsx}\n})()`); }
    catch (e) { fallos++; console.error(`✗ server.mjs:${linea} · ${e.message}`); }
  }
}
console.log(`${revisados} bloques ExtendScript revisados (${saltados} dinámicos omitidos), ${fallos} con errores.`);
process.exit(fallos ? 1 : 0);
