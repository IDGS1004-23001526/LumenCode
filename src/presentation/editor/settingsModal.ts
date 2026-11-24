import { invoke } from "@tauri-apps/api/core";
import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { AppState, CursorBlinking, ExtensionManifest, IconThemeManifest, ThemeManifest } from "../../domain/types";
import type { AppStore } from "../../application/reducer";
import {
  BUILTIN_THEMES,
  getAllThemes,
  parseThemeJson,
  removeCustomTheme,
  saveCustomTheme,
} from "../../infraestructure/themeRepository";
import {
  BUILTIN_ICON_THEMES,
  getAllIconThemes,
  parseIconThemeJson,
  removeCustomIconTheme,
  saveCustomIconTheme,
} from "../../infraestructure/iconThemeRepository";
import {
  getCatalogExtensions,
  installExtension,
  isExtensionInstalled,
  syncRemoveIconExtension,
  syncRemoveThemeExtension,
  uninstallExtension,
} from "../../infraestructure/extensionRepository";
import { cx, h } from "../dom";
import { iconForFile, iconForFolder } from "../icons";
import { animateFadeSlide, closePrettyModal, openPrettyModal } from "../animate";

type SectionId = "editor" | "appearance" | "extensions" | "keybindings" | "credits";

const SECTIONS: { id: SectionId; label: string; desc: string }[] = [
  { id: "editor", label: "Text Editor", desc: "Tipografía, cursor y comportamiento" },
  { id: "appearance", label: "Appearance", desc: "Paletas de color de la interfaz" },
  { id: "extensions", label: "Extensions", desc: "Temas de la comunidad y utilidades" },
  { id: "keybindings", label: "Keybindings", desc: "Atajos de teclado globales" },
  { id: "credits", label: "Créditos", desc: "Autoría y agradecimientos" },
];

const FONTS = [
  { label: "Monaspace Krypton", value: "'Monaspace Krypton', 'JetBrains Mono Variable', monospace" },
  { label: "JetBrains Mono", value: "'JetBrains Mono Variable', monospace" },
  { label: "Consolas", value: "Consolas, monospace" },
];

const BLINK_MODES: { label: string; value: CursorBlinking }[] = [
  { label: "Expand (estirar)", value: "expand" },
  { label: "Smooth (suave)", value: "smooth" },
  { label: "Phase (fase)", value: "phase" },
  { label: "Blink (clásico)", value: "blink" },
  { label: "Solid (fijo)", value: "solid" },
];

const SHORTCUTS = [
  ["Ctrl + S", "Guardar archivo activo"],
  ["Ctrl + Shift + S", "Guardar como..."],
  ["Ctrl + O", "Abrir archivo..."],
  ["Ctrl + Shift + O", "Abrir carpeta de proyecto..."],
  ["Ctrl + N", "Nuevo archivo"],
  ["Ctrl + W", "Cerrar pestaña actual"],
  ["Ctrl + B", "Mostrar u ocultar el explorador"],
  ["Ctrl + Shift + G", "Mostrar u ocultar el control de versiones"],
  ["Ctrl + `", "Mostrar u ocultar la terminal"],
  ["Ctrl + +", "Aumentar tamaño de fuente"],
  ["Ctrl + -", "Disminuir tamaño de fuente"],
  ["Ctrl + 0", "Restablecer tamaño de fuente (14px)"],
  ["Ctrl + ,", "Abrir preferencias"],
];

export function mountSettingsModal(store: AppStore) {
  let activeSection: SectionId = "editor";
  let query = "";
  let selectedExtId: string | null = null;
  let extFilter: "all" | "installed" = "all";

  const searchInput = h("input", {
    class: "field settings-search",
    type: "search",
    placeholder: "Buscar ajustes...",
    spellcheck: "false",
  }) as HTMLInputElement;

  const navEl = h("nav", { class: "settings-nav" });
  const contentEl = h("div", { class: "settings-content" });
  const close = () => store.dispatch({ type: "settings/open", open: false });

  const dlg = h(
    "dialog",
    { class: "modal settings-shell" },
    h(
      "div",
      { class: "settings-layout" },
      h(
        "aside",
        { class: "settings-sidebar" },
        h("div", { class: "settings-brand" }, "Preferencias"),
        searchInput,
        navEl,
      ),
      h(
        "section",
        { class: "settings-main" },
        h(
          "header",
          { class: "settings-topbar" },
          h("div", { class: "settings-crumb", id: "settings-crumb" }),
          h("button", { class: "icon-btn", title: "Cerrar (Esc)", onclick: close }, "×"),
        ),
        contentEl,
      ),
    ),
  ) as HTMLDialogElement;

  const settingItem = (title: string, desc: string, control: HTMLElement) =>
    h(
      "div",
      { class: "setting-card" },
      h("div", { class: "setting-info" }, h("div", { class: "setting-title" }, title), h("div", { class: "setting-desc" }, desc)),
      h("div", { class: "setting-control" }, control),
    );

  const renderThemeCard = (t: ThemeManifest, activeId: string, isCustom: boolean) => {
    const isActive = t.id === activeId;
    const swatches = ["--bg", "--surface", "--accent", "--syn-keyword", "--syn-string"].map((k) =>
      h("span", { class: "swatch", style: `background:${t.colors[k] ?? "#ccc"}` }),
    );

    return h(
      "div",
      { class: cx("theme-card", isActive && "active") },
      h("div", { class: "theme-swatches" }, ...swatches),
      h(
        "div",
        { class: "theme-meta" },
        h("div", { class: "theme-name" }, t.name),
        h("div", { class: "theme-author" }, `${t.author} · ${t.dark ? "Oscuro" : "Claro"}`),
      ),
      h(
        "div",
        { class: "theme-actions" },
        h(
          "button",
          {
            class: cx("btn", isActive ? "ghost" : "primary"),
            disabled: isActive,
            onclick: () => {
              store.dispatch({ type: "settings/update", patch: { theme: t.id } });
              renderBody(store.getState());
            },
          },
          isActive ? "Activo" : "Aplicar",
        ),
        isCustom
          ? h(
              "button",
              {
                class: "btn ghost",
                title: "Desinstalar tema",
                onclick: () => {
                  removeCustomTheme(t.id);
                  syncRemoveThemeExtension(t.id);
                  if (isActive) store.dispatch({ type: "settings/update", patch: { theme: "lumen-light" } });
                  renderBody(store.getState());
                },
              },
              "Quitar",
            )
          : null,
      ),
    );
  };

  const renderIconPreview = (it: IconThemeManifest) => {
    const samples = [
      iconForFolder("src", true, it),
      iconForFolder("routes", false, it),
      iconForFolder("utils", false, it),
      iconForFile("App.tsx", it),
      iconForFile("package.json", it),
      iconForFile("main.rs", it),
    ];
    return h(
      "div",
      { class: "theme-swatches icon-preview-row" },
      ...samples.map((svg) => {
        const span = h("span", { class: "icon-preview-chip" });
        span.innerHTML = svg;
        return span;
      }),
    );
  };

  const renderIconThemeCard = (it: IconThemeManifest, activeId: string, isCustom: boolean) => {
    const isActive = it.id === activeId;
    return h(
      "div",
      { class: cx("theme-card", isActive && "active") },
      renderIconPreview(it),
      h(
        "div",
        { class: "theme-meta" },
        h("div", { class: "theme-name" }, it.name),
        h("div", { class: "theme-author" }, `${it.author} · Iconos`),
      ),
      h(
        "div",
        { class: "theme-actions" },
        h(
          "button",
          {
            class: cx("btn", isActive ? "ghost" : "primary"),
            disabled: isActive,
            onclick: () => {
              store.dispatch({ type: "settings/update", patch: { iconTheme: it.id } });
              renderBody(store.getState());
            },
          },
          isActive ? "Activo" : "Aplicar",
        ),
        isCustom
          ? h(
              "button",
              {
                class: "btn ghost",
                title: "Desinstalar paquete de iconos",
                onclick: () => {
                  removeCustomIconTheme(it.id);
                  syncRemoveIconExtension(it.id);
                  if (isActive) store.dispatch({ type: "settings/update", patch: { iconTheme: "lumen-icons" } });
                  renderBody(store.getState());
                },
              },
              "Quitar",
            )
          : null,
      ),
    );
  };

  function renderNav() {
    navEl.replaceChildren(
      ...SECTIONS.map((sec) =>
        h(
          "button",
          {
            class: cx("settings-nav-item", activeSection === sec.id && "active"),
            onclick: () => {
              activeSection = sec.id;
              query = "";
              searchInput.value = "";
              renderNav();
              renderBody(store.getState());
            },
          },
          sec.label,
        ),
      ),
    );
  }

  function renderBody(s: AppState) {
    const secInfo = SECTIONS.find((x) => x.id === activeSection)!;
    const crumb = dlg.querySelector("#settings-crumb");
    if (crumb) crumb.textContent = query ? `Resultados para "${query}"` : `${secInfo.label} — ${secInfo.desc}`;

    const q = query.trim().toLowerCase();
    const matches = (text: string) => !q || text.toLowerCase().includes(q);
    const items: HTMLElement[] = [];

    // TEXT EDITOR
    if (activeSection === "editor" || q) {
      if (matches("fuente font family tipografía")) {
        const font = h("select", { class: "field" }, ...FONTS.map((f) => h("option", { value: f.value }, f.label))) as HTMLSelectElement;
        font.value = s.settings.fontFamily;
        font.addEventListener("change", () => store.dispatch({ type: "settings/update", patch: { fontFamily: font.value } }));
        items.push(settingItem("Font Family", "Tipografía monoespaciada utilizada en el editor y la terminal.", font));
      }

      if (matches("tamaño size font")) {
        const size = h("input", { class: "field", type: "number", min: 10, max: 28, value: s.settings.fontSize }) as HTMLInputElement;
        size.addEventListener("input", () => {
          const n = Number(size.value);
          if (n >= 10 && n <= 28) store.dispatch({ type: "settings/update", patch: { fontSize: n } });
        });
        items.push(settingItem("Font Size", "Tamaño base del texto en píxeles (10 – 28 px).", size));
      }

      if (matches("cursor blinking parpadeo expand smooth")) {
        const blink = h("select", { class: "field" }, ...BLINK_MODES.map((b) => h("option", { value: b.value }, b.label))) as HTMLSelectElement;
        blink.value = s.settings.cursorBlinking;
        blink.addEventListener("change", () =>
          store.dispatch({ type: "settings/update", patch: { cursorBlinking: blink.value as CursorBlinking } }),
        );
        items.push(settingItem("Cursor Blinking", "Estilo de animación del parpadeo del cursor.", blink));
      }

      if (matches("smooth caret cursor animacion fluido")) {
        const smooth = h(
          "select",
          { class: "field" },
          h("option", { value: "on" }, "On (fluido)"),
          h("option", { value: "off" }, "Off (desactivado)"),
        ) as HTMLSelectElement;
        smooth.value = s.settings.cursorSmooth ? "on" : "off";
        smooth.addEventListener("change", () =>
          store.dispatch({ type: "settings/update", patch: { cursorSmooth: smooth.value === "on" } }),
        );
        items.push(settingItem("Cursor Smooth Caret", "Interpola suavemente el desplazamiento del cursor al escribir o navegar.", smooth));
      }

      if (matches("tab size indentacion espacios")) {
        const tabSize = h(
          "select",
          { class: "field" },
          h("option", { value: "2" }, "2 espacios"),
          h("option", { value: "4" }, "4 espacios"),
        ) as HTMLSelectElement;
        tabSize.value = String(s.settings.tabSize);
        tabSize.addEventListener("change", () =>
          store.dispatch({ type: "settings/update", patch: { tabSize: Number(tabSize.value) } }),
        );
        items.push(settingItem("Tab Size", "Número de espacios por nivel de indentación.", tabSize));
      }

      if (matches("word wrap ajuste linea")) {
        const wrap = h(
          "select",
          { class: "field" },
          h("option", { value: "off" }, "Off"),
          h("option", { value: "on" }, "On"),
        ) as HTMLSelectElement;
        wrap.value = s.settings.wordWrap ? "on" : "off";
        wrap.addEventListener("change", () =>
          store.dispatch({ type: "settings/update", patch: { wordWrap: wrap.value === "on" } }),
        );
        items.push(settingItem("Word Wrap", "Ajusta líneas largas al ancho visible del editor.", wrap));
      }
    }

    // APPEARANCE
    if (activeSection === "appearance" || (q && matches("tema theme apariencia paleta iconos icons animaciones animations"))) {
      const animToggle = h("input", {
        type: "checkbox",
        checked: s.settings.animations ?? true,
        onchange: () =>
          store.dispatch({
            type: "settings/update",
            patch: { animations: animToggle.checked },
          }),
      }) as HTMLInputElement;

      const themes = getAllThemes();
      const builtinIds = new Set(BUILTIN_THEMES.map((b) => b.id));
      const iconThemes = getAllIconThemes();
      const builtinIconIds = new Set(BUILTIN_ICON_THEMES.map((b) => b.id));

      items.push(
        settingItem(
          "Animaciones de interfaz",
          "Activado por defecto, si presenta problemas de rendimiento, desactivalo",
          animToggle,
        ),
        h("div", { class: "settings-group-title" }, "Paletas de color instaladas"),
        h("div", { class: "themes-grid" }, ...themes.map((t) => renderThemeCard(t, s.settings.theme, !builtinIds.has(t.id)))),
        h("div", { class: "settings-group-title" }, "Paquetes de iconos instalados"),
        h(
          "div",
          { class: "themes-grid" },
          ...iconThemes.map((it) => renderIconThemeCard(it, s.settings.iconTheme, !builtinIconIds.has(it.id))),
        ),
      );
    }

    // EXTENSIONS 
    const catalogForSearch = getCatalogExtensions();
    const matchesAnyExtension = Boolean(
      q && catalogForSearch.some((e) => matches(`${e.name} ${e.author} ${e.summary} ${e.category}`)),
    );
    if (
      activeSection === "extensions" ||
      matchesAnyExtension ||
      (q && matches("extensions extensiones tienda tema iconos icons json comunidad"))
    ) {
      const catalog = catalogForSearch;
      const selectedExt = selectedExtId ? catalog.find((e) => e.id === selectedExtId) ?? null : null;

      if (selectedExt) {
        const installed = isExtensionInstalled(selectedExt);
        const isThemeActive = Boolean(selectedExt.theme && s.settings.theme === selectedExt.theme.id);
        const isIconActive = Boolean(selectedExt.iconTheme && s.settings.iconTheme === selectedExt.iconTheme.id);
        const isActive = isThemeActive || isIconActive;
        const swatches = selectedExt.theme
          ? ["--bg", "--surface", "--accent", "--syn-keyword", "--syn-string"].map((k) =>
              h("span", { class: "swatch", style: `background:${selectedExt.theme!.colors[k] ?? "#ccc"}` }),
            )
          : [];

        const actionBtns: HTMLElement[] = [];
        if (!selectedExt.builtin) {
          actionBtns.push(
            h(
              "button",
              {
                class: cx("btn", installed ? "ghost" : "primary"),
                onclick: () => {
                  if (installed) {
                    uninstallExtension(selectedExt);
                    if (isThemeActive) {
                      store.dispatch({ type: "settings/update", patch: { theme: "lumen-light" } });
                    }
                    if (isIconActive) {
                      store.dispatch({ type: "settings/update", patch: { iconTheme: "lumen-icons" } });
                    }
                  } else {
                    installExtension(selectedExt);
                  }
                  renderBody(store.getState());
                },
              },
              installed ? "Desinstalar" : "Instalar",
            ),
          );
        }

        if (installed && (selectedExt.theme || selectedExt.iconTheme)) {
          actionBtns.push(
            h(
              "button",
              {
                class: cx("btn", isActive ? "ghost" : "primary"),
                disabled: isActive,
                onclick: () => {
                  if (selectedExt.theme) {
                    store.dispatch({ type: "settings/update", patch: { theme: selectedExt.theme.id } });
                  } else if (selectedExt.iconTheme) {
                    store.dispatch({ type: "settings/update", patch: { iconTheme: selectedExt.iconTheme.id } });
                  }
                  renderBody(store.getState());
                },
              },
              isActive ? "En uso" : selectedExt.iconTheme ? "Usar iconos" : "Usar tema",
            ),
          );
        }

        const previewBlock = selectedExt.screenshots?.length
          ? h(
              "div",
              { class: "ext-screenshots" },
              ...selectedExt.screenshots.map((src) => h("img", { src, alt: selectedExt.name, class: "ext-screenshot" })),
            )
          : selectedExt.theme
            ? h(
                "div",
                {
                  class: "ext-preview-box",
                  style: `background:${selectedExt.theme.colors["--bg"]}; color:${selectedExt.theme.colors["--fg"]}; border-color:${selectedExt.theme.colors["--border"]}`,
                },
                h(
                  "div",
                  {
                    class: "ext-preview-sidebar",
                    style: `background:${selectedExt.theme.colors["--surface"]}; border-color:${selectedExt.theme.colors["--border"]}`,
                  },
                  h("span", { style: `color:${selectedExt.theme.colors["--accent"]}` }, "● src/"),
                  h("span", { style: `color:${selectedExt.theme.colors["--fg-muted"]}` }, "  main.ts"),
                ),
                h(
                  "div",
                  { class: "ext-preview-code" },
                  h("span", { style: `color:${selectedExt.theme.colors["--syn-keyword"]}` }, "export "),
                  h("span", { style: `color:${selectedExt.theme.colors["--syn-function"] ?? selectedExt.theme.colors["--syn-fn"]}` }, "function "),
                  h("span", {}, "lumen() { "),
                  h("span", { style: `color:${selectedExt.theme.colors["--syn-string"]}` }, '"ready"'),
                  h("span", {}, " }"),
                ),
              )
            : selectedExt.iconTheme
              ? renderIconPreview(selectedExt.iconTheme)
              : null;

        items.push(
          h(
            "div",
            { class: "ext-detail" },
            h(
              "button",
              {
                class: "btn ghost ext-back-btn",
                onclick: () => {
                  selectedExtId = null;
                  renderBody(store.getState());
                },
              },
              "← Volver al catálogo",
            ),
            h(
              "div",
              { class: "ext-detail-header" },
              h(
                "div",
                { class: "ext-detail-meta" },
                h(
                  "div",
                  { class: "ext-detail-title" },
                  selectedExt.name,
                  h("span", { class: "ext-badge" }, selectedExt.category),
                  installed ? h("span", { class: "ext-badge" }, "Instalada") : null,
                ),
                h("div", { class: "ext-desc" }, `${selectedExt.author} · v${selectedExt.version}`),
                swatches.length ? h("div", { class: "theme-swatches" }, ...swatches) : null,
              ),
              h("div", { class: "ext-detail-actions" }, ...actionBtns),
            ),
            previewBlock,
            h("div", { class: "settings-group-title" }, "Descripción"),
            h("div", { class: "ext-readme" }, selectedExt.readme),
          ),
        );
      } else {
        const importBtn = h(
          "button",
          {
            class: "btn primary",
            onclick: async () => {
              const selected = await pickFile({
                multiple: false,
                filters: [{ name: "Lumen Theme / Icons JSON", extensions: ["json"] }],
              });
              if (typeof selected !== "string") return;
              try {
                const raw = await readTextFile(selected);
                const parsedIcon = parseIconThemeJson(raw);
                if (parsedIcon) {
                  saveCustomIconTheme(parsedIcon);
                  store.dispatch({ type: "settings/update", patch: { iconTheme: parsedIcon.id } });
                  renderBody(store.getState());
                  return;
                }
                const parsedTheme = parseThemeJson(raw);
                if (parsedTheme) {
                  saveCustomTheme(parsedTheme);
                  store.dispatch({ type: "settings/update", patch: { theme: parsedTheme.id } });
                  renderBody(store.getState());
                  return;
                }
                alert("El archivo JSON no corresponde a un tema de color ni a un paquete de iconos válido.");
              } catch (e) {
                alert(`No se pudo importar el archivo: ${String(e)}`);
              }
            },
          },
          "Importar (.json)",
        );

        const filtered = catalog.filter((ext) => {
          if (extFilter === "installed" && !isExtensionInstalled(ext)) return false;
          if (q && !`${ext.name} ${ext.author} ${ext.summary} ${ext.category}`.toLowerCase().includes(q)) return false;
          return true;
        });

        const renderExtCard = (ext: ExtensionManifest) => {
          const installed = isExtensionInstalled(ext);
          const isThemeActive = Boolean(ext.theme && s.settings.theme === ext.theme.id);
          const isIconActive = Boolean(ext.iconTheme && s.settings.iconTheme === ext.iconTheme.id);
          const isActive = isThemeActive || isIconActive;
          const swatches = ext.theme
            ? ["--bg", "--surface", "--accent", "--syn-keyword", "--syn-string"].map((k) =>
                h("span", { class: "swatch", style: `background:${ext.theme!.colors[k] ?? "#ccc"}` }),
              )
            : [];

          return h(
            "div",
            {
              class: "ext-card ext-card-clickable",
              onclick: () => {
                selectedExtId = ext.id;
                renderBody(store.getState());
              },
            },
            h(
              "div",
              {},
              h(
                "div",
                { class: "ext-title" },
                ext.name,
                h("span", { class: "ext-badge" }, isActive ? "Activo" : installed ? "Instalada" : ext.category),
              ),
              h("div", { class: "ext-desc" }, `${ext.author} · v${ext.version}`),
            ),
            swatches.length ? h("div", { class: "theme-swatches" }, ...swatches) : null,
            ext.iconTheme ? renderIconPreview(ext.iconTheme) : null,
            h("div", { class: "ext-desc" }, ext.summary),
            h(
              "div",
              { class: "theme-actions" },
              h(
                "button",
                {
                  class: cx("btn", installed ? "ghost" : "primary"),
                  onclick: (ev: Event) => {
                    ev.stopPropagation();
                    if (!installed) {
                      installExtension(ext);
                      if (ext.theme) store.dispatch({ type: "settings/update", patch: { theme: ext.theme.id } });
                      if (ext.iconTheme) store.dispatch({ type: "settings/update", patch: { iconTheme: ext.iconTheme.id } });
                    } else if (!isActive) {
                      if (ext.theme) store.dispatch({ type: "settings/update", patch: { theme: ext.theme.id } });
                      if (ext.iconTheme) store.dispatch({ type: "settings/update", patch: { iconTheme: ext.iconTheme.id } });
                    }
                    renderBody(store.getState());
                  },
                },
                !installed ? "Instalar" : isActive ? "En uso" : ext.iconTheme ? "Usar iconos" : "Usar tema",
              ),
            ),
          );
        };

        items.push(
          h(
            "div",
            { class: "ext-toolbar" },
            h(
              "div",
              { class: "ext-filter-pills" },
              h(
                "button",
                {
                  class: cx("btn", extFilter === "all" ? "primary" : "ghost"),
                  onclick: () => {
                    extFilter = "all";
                    renderBody(store.getState());
                  },
                },
                "Todas",
              ),
              h(
                "button",
                {
                  class: cx("btn", extFilter === "installed" ? "primary" : "ghost"),
                  onclick: () => {
                    extFilter = "installed";
                    renderBody(store.getState());
                  },
                },
                "Instaladas",
              ),
            ),
            importBtn,
          ),
          h("div", { class: "settings-group-title" }, "Catálogo de la comunidad"),
          h("div", { class: "extensions-list" }, ...filtered.map(renderExtCard)),
        );
      }
    }

    // KEYBINDINGS
    if (activeSection === "keybindings" || (q && matches("atajos shortcuts keybindings teclado"))) {
      items.push(
        h(
          "table",
          { class: "shortcuts" },
          ...SHORTCUTS.map(([k, d]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, d))),
        ),
      );
    }

    // CREDITOS
    if (activeSection === "credits" || (q && matches("creditos autor github ogeidev gracias"))) {
      const logoBadge = h("div", { class: "credits-logo" });
      logoBadge.innerHTML = `<svg width="36" height="36" viewBox="0 0 96 96"><rect x="10" y="10" width="76" height="76" rx="20" fill="var(--bg)" stroke="var(--border)" stroke-width="2.5"/><path d="M36 30 V62 H56" fill="none" stroke="var(--fg)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="58" cy="35" r="5.8" fill="var(--accent)"/></svg>`;

      const ghIcon = h("span", { class: "credits-gh-icon" });
      ghIcon.innerHTML = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>`;

      const githubBtn = h(
        "button",
        {
          class: "credits-gh-btn",
          onclick: () => void invoke("open_external_url", { url: "https://github.com/IDGS1004-23001526" }),
        },
        ghIcon,
        h("span", {}, "Perfil de GitHub · @Ogeidev"),
        h("span", { class: "credits-arrow" }, "↗"),
      );

      items.push(
        h(
          "div",
          { class: "credits-hero" },
          h(
            "div",
            { class: "credits-head" },
            logoBadge,
            h(
              "div",
              { class: "credits-brand" },
              h(
                "div",
                { class: "credits-title-row" },
                h("span", { class: "credits-name" }, "LumenCode"),
                h("span", { class: "credits-pill" }, "v0.2.1"),
              ),
              h(
                "div",
                { class: "credits-owner" },
                "Creado por ",
                h("strong", { class: "credits-handle" }, "@Ogeidev"),
                " · Propietario y autor legítimo",
              ),
            ),
          ),
          h("div", { class: "credits-actions" }, githubBtn),
        ),
        h(
          "div",
          { class: "credits-thanks" },
          h("div", { class: "credits-thanks-title" }, "Gracias por programar con LumenCode"),
          h(
            "p",
            { class: "credits-thanks-body" },
            "Muchas gracias de corazón por darle una oportunidad a este editor y usarlo en tus proyectos. Cada detalle fue pensado con cariño y dedicación para ofrecerte un espacio rápido, limpio y cómodo donde construir tus ideas.",
          ),
        ),
      );
    }

    if (items.length === 0) {
      items.push(h("div", { class: "placeholder" }, "No se encontraron ajustes que coincidan con tu búsqueda."));
    }

    contentEl.replaceChildren(...items);
    animateFadeSlide(contentEl);
  }

  searchInput.addEventListener("input", () => {
    query = searchInput.value;
    if (selectedExtId && query.trim()) selectedExtId = null;
    renderBody(store.getState());
  });

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });

  dlg.addEventListener("close", () => {
    isClosing = false;
    if (store.getState().settingsOpen) close();
  });

  document.body.append(dlg);

  let isClosing = false;

  store.subscribe((s) => {
    if (s.settingsOpen && !dlg.open) {
      isClosing = false;
      renderNav();
      renderBody(s);
      openPrettyModal(dlg);
      searchInput.focus();
    } else if (!s.settingsOpen && dlg.open && !isClosing) {
      isClosing = true;
      closePrettyModal(dlg, () => {
        isClosing = false;
      });
    }
  });
}
