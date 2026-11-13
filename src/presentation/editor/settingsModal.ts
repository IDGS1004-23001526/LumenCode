import { open as pickFile } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { AppState, CursorBlinking, ExtensionManifest, ThemeManifest } from "../../domain/types";
import type { AppStore } from "../../application/reducer";
import {
  BUILTIN_THEMES,
  getAllThemes,
  parseThemeJson,
  removeCustomTheme,
  saveCustomTheme,
} from "../../infraestructure/themeRepository";
import {
  getCatalogExtensions,
  installExtension,
  isExtensionInstalled,
  uninstallExtension,
} from "../../infraestructure/extensionRepository";
import { cx, h } from "../dom";
import { animateFadeSlide, animateModalOpen } from "../animate";

type SectionId = "editor" | "appearance" | "extensions" | "keybindings";

const SECTIONS: { id: SectionId; label: string; desc: string }[] = [
  { id: "editor", label: "Text Editor", desc: "Tipografía, cursor y comportamiento" },
  { id: "appearance", label: "Appearance", desc: "Paletas de color de la interfaz" },
  { id: "extensions", label: "Extensions", desc: "Temas de la comunidad y utilidades" },
  { id: "keybindings", label: "Keybindings", desc: "Atajos de teclado globales" },
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
  ["Ctrl + W", "Cerrar pestaña actual"],
  ["Ctrl + O", "Abrir carpeta de proyecto"],
  ["Ctrl + B", "Mostrar u ocultar el explorador"],
  ["Ctrl + `", "Mostrar u ocultar la terminal"],
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

    // 1. TEXT EDITOR
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

    // 2. APPEARANCE
    if (activeSection === "appearance" || (q && matches("tema theme apariencia paleta animaciones animations"))) {
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
      items.push(
        settingItem(
          "Animaciones de interfaz",
          "Transiciones suaves con GSAP al abrir diálogos y navegar entre vistas.",
          animToggle,
        ),
        h("div", { class: "settings-group-title" }, "Paletas de color instaladas"),
        h("div", { class: "themes-grid" }, ...themes.map((t) => renderThemeCard(t, s.settings.theme, !builtinIds.has(t.id)))),
      );
    }

    // 3. EXTENSIONS (Catálogo comunidad + Vista detalle estilo VS Code + Importar JSON)
    if (activeSection === "extensions" || (q && matches("extensions extensiones tienda tema json comunidad"))) {
      const catalog = getCatalogExtensions();
      const selectedExt = selectedExtId ? catalog.find((e) => e.id === selectedExtId) ?? null : null;

      if (selectedExt) {
        const installed = isExtensionInstalled(selectedExt);
        const isThemeActive = Boolean(selectedExt.theme && s.settings.theme === selectedExt.theme.id);
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

        if (installed && selectedExt.theme) {
          actionBtns.push(
            h(
              "button",
              {
                class: cx("btn", isThemeActive ? "ghost" : "primary"),
                disabled: isThemeActive,
                onclick: () => {
                  store.dispatch({ type: "settings/update", patch: { theme: selectedExt.theme!.id } });
                  renderBody(store.getState());
                },
              },
              isThemeActive ? "Tema activo" : "Usar tema",
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
                  h("span", { style: `color:${selectedExt.theme.colors["--syn-fn"]}` }, "function "),
                  h("span", {}, "lumen() { "),
                  h("span", { style: `color:${selectedExt.theme.colors["--syn-string"]}` }, '"ready"'),
                  h("span", {}, " }"),
                ),
              )
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
                filters: [{ name: "Lumen Theme JSON", extensions: ["json"] }],
              });
              if (typeof selected !== "string") return;
              try {
                const raw = await readTextFile(selected);
                const parsed = parseThemeJson(raw);
                if (!parsed) {
                  alert("El archivo JSON no tiene el formato válido de tema ({ name, colors }).");
                  return;
                }
                saveCustomTheme(parsed);
                store.dispatch({ type: "settings/update", patch: { theme: parsed.id } });
                renderBody(store.getState());
              } catch (e) {
                alert(`No se pudo importar el tema: ${String(e)}`);
              }
            },
          },
          "Importar tema (.json)",
        );

        const filtered = catalog.filter((ext) => {
          if (extFilter === "installed" && !isExtensionInstalled(ext)) return false;
          if (q && !`${ext.name} ${ext.author} ${ext.summary}`.toLowerCase().includes(q)) return false;
          return true;
        });

        const renderExtCard = (ext: ExtensionManifest) => {
          const installed = isExtensionInstalled(ext);
          const isThemeActive = Boolean(ext.theme && s.settings.theme === ext.theme.id);
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
                h("span", { class: "ext-badge" }, isThemeActive ? "Activo" : installed ? "Instalada" : ext.category),
              ),
              h("div", { class: "ext-desc" }, `${ext.author} · v${ext.version}`),
            ),
            swatches.length ? h("div", { class: "theme-swatches" }, ...swatches) : null,
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
                    } else if (ext.theme && !isThemeActive) {
                      store.dispatch({ type: "settings/update", patch: { theme: ext.theme.id } });
                    }
                    renderBody(store.getState());
                  },
                },
                !installed ? "Instalar" : isThemeActive ? "En uso" : "Usar tema",
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

    // 4. KEYBINDINGS
    if (activeSection === "keybindings" || (q && matches("atajos shortcuts keybindings teclado"))) {
      items.push(
        h(
          "table",
          { class: "shortcuts" },
          ...SHORTCUTS.map(([k, d]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, d))),
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
    renderBody(store.getState());
  });

  dlg.addEventListener("close", () => {
    if (store.getState().settingsOpen) close();
  });

  document.body.append(dlg);

  store.subscribe((s) => {
    if (s.settingsOpen && !dlg.open) {
      renderNav();
      renderBody(s);
      dlg.showModal();
      animateModalOpen(dlg);
      searchInput.focus();
    } else if (!s.settingsOpen && dlg.open) {
      dlg.close();
    }
  });
}
