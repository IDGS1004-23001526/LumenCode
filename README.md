# Lumen

Editor de código minimalista y nativo, hecho con **Tauri 2** (backend en Rust, sin Electron) y **CodeMirror 6** como motor de edición.


## Requisitos

- [Rust](https://rustup.rs) (estable)
- Node.js 20 o superior
- Dependencias del sistema de Tauri: <https://v2.tauri.app/start/prerequisites/>
  - Windows: WebView2 (ya viene en Windows 10/11) y las Build Tools de Visual Studio (C++)
  - Linux: `webkit2gtk-4.1`, `libgtk-3-dev`, etc. (la guía lista los paquetes por distro)
  - macOS: Xcode Command Line Tools

## Empezar

```bash
npm install

# Genera los íconos de la app (una sola vez). Usa cualquier PNG cuadrado de 1024x1024.
npx tauri icon ruta/a/tu-logo.png

npm run tauri dev      # modo desarrollo con recarga en vivo
npm run tauri build    # instalador / ejecutable de producción
```

La primera compilación de Rust tarda unos minutos; después es incremental.

## Atajos

| Atajo          | Acción            |
| -------------- | ----------------- |
| `Ctrl/Cmd + O` | Abrir archivo     |
| `Ctrl/Cmd + S` | Guardar           |
| `Ctrl+Shift+S` | Guardar como      |
| `Ctrl/Cmd + N` | Nuevo             |
| `Ctrl/Cmd + F` | Buscar            |
| `Ctrl/Cmd + Z` | Deshacer          |

El resto de atajos vienen de CodeMirror (selección múltiple con `Alt+clic`, plegado de código, autocompletado, etc.).

## Estructura

```
lumen/
├─ index.html              # estructura de la ventana (barra de título, editor, barra de estado)
├─ src/
│  ├─ main.ts              # lógica de la app: abrir/guardar, estado, atajos, ventana
│  ├─ editor.ts            # configuración de CodeMirror: lenguajes, tema, resaltado
│  └─ styles.css           # paleta y estilos (todo el color sale de variables CSS)
└─ src-tauri/
   ├─ Cargo.toml           # dependencias de Rust
   ├─ tauri.conf.json      # ventana sin bordes nativos, bundle, etc.
   ├─ capabilities/        # permisos que el frontend puede usar
   └─ src/
      ├─ main.rs           # punto de entrada
      └─ lib.rs            # registro de plugins (dialog, fs); aquí irán tus comandos Rust
```

## Personalizar

- **Colores y tipografía:** edita las variables al inicio de `src/styles.css`. El resaltado de sintaxis usa las variables `--syn-*`.
- **Más lenguajes:** instala el paquete `@codemirror/lang-xxx` y añade un `case` en `languageFor()` dentro de `src/editor.ts`.
- **Lógica en Rust:** añade funciones con `#[tauri::command]` en `src-tauri/src/lib.rs`, regístralas con `.invoke_handler(tauri::generate_handler![...])` y llámalas desde TypeScript con `invoke()` de `@tauri-apps/api/core`.

## Ideas para siguientes pasos

1. Pestañas con varios archivos abiertos
2. Explorador de carpetas (un comando en Rust que liste directorios)
3. Paleta de comandos (`Ctrl+P`)
4. Soporte LSP para autocompletado y errores reales
5. Terminal integrada (crate `portable-pty`)
6. Selector de temas
