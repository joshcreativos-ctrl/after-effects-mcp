# After Effects MCP

*by [Videazo](https://videazo.si)*

Deja que **Claude** controle **Adobe After Effects**: proyectos, comps, capas, efectos, expresiones, render y **cualquier plugin instalado** (los parámetros de un plugin salen y se cambian igual que los nativos).

> English: an MCP server that lets Claude drive Adobe After Effects (Windows), including every installed third-party effect plugin. Install with `npx github:joshcreativos-ctrl/after-effects-mcp`. See the tool list below.

## Instalar (Windows)

**Requisitos:** After Effects (probado en la 2026; otras versiones pueden funcionar pero no se han probado) y [Node.js 18+](https://nodejs.org).

**Opción A · doble clic.** Descarga el ZIP (botón *Code → Download ZIP*), descomprímelo y abre **`Instalar.cmd`**. Si no tienes Node, te ofrece instalarlo.

**Opción B · una línea.**
```
npx github:joshcreativos-ctrl/after-effects-mcp
```

No pide administrador. Hace tres cosas:
1. Copia el puente a la carpeta de inicio **del usuario** de After Effects (`%APPDATA%\Adobe\After Effects\<versión>\Scripts\Startup`). Arranca solo con After Effects.
2. Copia el servidor a `%LOCALAPPDATA%\Videazo\ae-mcp` e instala sus dependencias.
3. Lo registra en **Claude Code** y **Claude Desktop** (los que tengas instalados).

**Después, una sola vez:**
- En After Effects: `Edición > Preferencias > Scripting y expresiones` → activa **"Permitir que los scripts escriban archivos y accedan a la red"**. Es un ajuste de seguridad de Adobe: solo lo activa el usuario, a propósito.
- Reinicia After Effects y Claude.

Prueba: pídele a Claude *"usa ae_status"*.

Opciones del instalador: `--dry-run` (simula), `--uninstall` (o `Desinstalar.cmd`), `--no-claude-code`, `--no-desktop`.

## Si lo instala el Claude del usuario

1. Ejecutar `node install.mjs --dry-run` y mostrar el resultado.
2. Con el sí del usuario, ejecutar `node install.mjs`.
3. Pedirle al usuario que active el permiso de scripting (arriba) y reinicie After Effects y Claude.
4. Comprobar con la herramienta `ae_status`.

## Herramientas

| Herramienta | Qué hace |
|---|---|
| `ae_status` / `ae_launch` | Abre After Effects si hace falta y devuelve versión y proyecto |
| `ae_execute_script` | Ejecuta ExtendScript completo (acceso total) |
| `ae_run_script_file` | Ejecuta un `.jsx`/`.jsxbin` (por ejemplo el de un plugin) |
| `ae_run_command` | Ejecuta comandos de menú por nombre, incluidos los que agregan los plugins |
| `ae_list_effects` | Lista todos los efectos y plugins cargados con su `matchName` |
| `ae_list_plugin_files` | Lista los plugins, scripts y extensiones instalados en disco |
| `ae_project_tree`, `ae_get_comp` | Ver proyecto, comps y capas |
| `ae_create_comp`, `ae_import_files`, `ae_add_layer`, `ae_save_project` | Construir el proyecto |
| `ae_dump_properties` | Ver todos los parámetros de una capa o efecto (nativo o de plugin) |
| `ae_set_property` | Cambiar valor, expresión y keyframes de cualquier propiedad |
| `ae_add_effect` | Agregar un efecto o plugin por `matchName` y fijar sus parámetros |
| `ae_capture_frame` | Renderiza un fotograma y me lo devuelve como imagen |
| `ae_render` | Render sin interfaz con `aerender` |

Los plugins que solo se manejan desde su propia ventana (por ejemplo la escena de Element 3D) se combinan con control de pantalla.

## Cómo funciona

`Claude → MCP (stdio) → carpeta de intercambio (%APPDATA%\Videazo\ae-bridge) → puente ExtendScript dentro de After Effects`.
El puente revisa la carpeta cada 100 ms, ejecuta la orden y devuelve el resultado. Cada cambio queda en un grupo de deshacer **"Videazo MCP"** (Ctrl+Z en After Effects).

## Problemas comunes

| Síntoma | Solución |
|---|---|
| "El puente no está instalado" | Ejecuta el instalador y reinicia After Effects |
| "no permite que los scripts escriban archivos" | Activa el ajuste de Preferencias (arriba) y reinicia After Effects |
| "abierto pero el puente no responde" | After Effects no ejecuta scripts con un cuadro de diálogo abierto: ciérralo. Si no hay ninguno, reinícialo |
| Sale un aviso de "bloqueo / modo seguro" | Elige iniciar normal. No cierres After Effects a la fuerza |

## Desarrollo

```
npm install
npm run check          # revisa la sintaxis
npm test -- ae_status  # prueba una herramienta contra tu After Effects
```

Detalles: el puente (`bridge/videazo_bridge.jsx`) es ExtendScript (ES3): sin `let`/`const`/flechas/`JSON`. After Effects lo carga al iniciar desde `Scripts/Startup`.

## Seguridad

`ae_execute_script` ejecuta código con acceso total a After Effects y al equipo (ExtendScript puede lanzar comandos del sistema). Úsalo solo con un Claude en el que confías. El servidor no abre puertos de red: se comunica por una carpeta local del usuario.

## Licencia

[MIT](LICENSE) © 2026 Josh Creativos (Videazo)
