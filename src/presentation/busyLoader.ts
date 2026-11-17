const LOADER_SVG = `
  <svg class="splash-logo git-busy-logo" viewBox="0 0 96 96">
    <rect
      class="splash-bg"
      x="14"
      y="14"
      width="68"
      height="68"
      rx="18"
      fill="var(--surface)"
      stroke="var(--border)"
      stroke-width="2"
    />
    <path
      class="splash-l"
      d="M36 30 V62 H56"
      fill="none"
      stroke="var(--fg)"
      stroke-width="6.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
    <circle class="splash-dot" cx="58" cy="35" r="5.5" fill="var(--accent)" />
  </svg>
`;

let activeCount = 0;
let overlayEl: HTMLElement | null = null;
let labelEl: HTMLElement | null = null;

function ensureOverlay(): HTMLElement {
  if (overlayEl && overlayEl.isConnected) return overlayEl;
  const wrap = document.createElement("div");
  wrap.className = "git-busy-overlay";
  wrap.tabIndex = -1;
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");

  const card = document.createElement("div");
  card.className = "git-busy-card";
  card.innerHTML = LOADER_SVG;

  const text = document.createElement("div");
  text.className = "git-busy-label";
  card.append(text);
  wrap.append(card);

  const stopKey = (e: KeyboardEvent) => {
    if (activeCount > 0) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  window.addEventListener("keydown", stopKey, { capture: true });

  overlayEl = wrap;
  labelEl = text;
  document.body.append(wrap);
  return wrap;
}

export async function withBusyLoader<T>(label: string, task: () => Promise<T>): Promise<T> {
  activeCount += 1;
  const el = ensureOverlay();
  if (labelEl) labelEl.textContent = label;
  el.hidden = false;
  el.classList.remove("hide");
  el.focus();

  try {
    return await task();
  } finally {
    activeCount = Math.max(0, activeCount - 1);
    if (activeCount === 0 && overlayEl) {
      overlayEl.classList.add("hide");
      setTimeout(() => {
        if (activeCount === 0 && overlayEl) {
          overlayEl.hidden = true;
        }
      }, 220);
    }
  }
}
