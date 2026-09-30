// Prueba rápida del servidor: npm test -- <herramienta> '<json de argumentos>'
// Sin argumentos lista las herramientas. Ejemplo: npm test -- ae_status
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const server = fileURLToPath(new URL("../server.mjs", import.meta.url));
const client = new Client({ name: "test", version: "0.0.1" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
const [tool, json] = process.argv.slice(2);
if (!tool) {
  const { tools } = await client.listTools();
  console.log(tools.map((t) => t.name).join("\n"));
} else {
  const r = await client.callTool({ name: tool, arguments: json ? JSON.parse(json) : {} }, undefined, { timeout: 180000 });
  for (const c of r.content) console.log(c.type === "text" ? c.text : `[${c.type} ${c.mimeType}, ${c.data.length} bytes]`);
  if (r.isError) process.exitCode = 1;
}
await client.close();
