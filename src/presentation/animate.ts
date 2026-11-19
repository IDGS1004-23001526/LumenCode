import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip, CustomEase);

const PRETTY_MODAL_EASE = CustomEase.create(
  "prettyModal",
  "M0,0 C0.305,0.206 0.116,0.567 0.3,0.8 0.394,0.921 0.491,1 1,1",
);

let animationsEnabled = true;
let lastPointerTrigger: HTMLElement | null = null;
let lastPointerAt = 0;

if (typeof window !== "undefined") {
  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target instanceof HTMLElement) {
        lastPointerTrigger = e.target.closest("button, [role='button'], [role='treeitem']") as HTMLElement | null ?? e.target;
        lastPointerAt = performance.now();
      }
    },
    { capture: true },
  );
  window.addEventListener(
    "keydown",
    () => {
      lastPointerTrigger = null;
      lastPointerAt = 0;
    },
    { capture: true },
  );
}

export function setAnimationsEnabled(enabled: boolean): void {
  animationsEnabled = enabled;
}

export function shouldAnimate(): boolean {
  if (!animationsEnabled) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function openPrettyModal(dialog: HTMLDialogElement, explicitOrigin?: HTMLElement | null): void {
  if (!shouldAnimate()) {
    dialog.showModal();
    return;
  }

  gsap.killTweensOf(dialog);
  dialog.classList.remove("pretty-modal-opening", "pretty-modal-closing");
  dialog.removeAttribute("style");

  const isRecentPointer = performance.now() - lastPointerAt < 200;
  const candidate = explicitOrigin ?? (isRecentPointer ? lastPointerTrigger : null);
  lastPointerTrigger = null;
  lastPointerAt = 0;
  const origin =
    candidate &&
    candidate.isConnected &&
    !dialog.contains(candidate) &&
    candidate !== document.body &&
    candidate !== document.documentElement &&
    candidate.getBoundingClientRect().width > 0
      ? candidate
      : null;

  if (origin) {
    const flipId = Math.random().toString(16).slice(2);
    dialog.dataset.flipId = flipId;
    origin.dataset.flipId = flipId;
    const originState = Flip.getState(origin);
    dialog.showModal();
    Flip.from(originState, {
      targets: dialog,
      scale: true,
      ease: PRETTY_MODAL_EASE,
      toggleClass: "pretty-modal-opening",
      duration: 0.7,
      onComplete: () => {
        dialog.removeAttribute("style");
      },
    });
    return;
  }

  delete dialog.dataset.flipId;
  dialog.showModal();
  dialog.classList.add("pretty-modal-opening");
  gsap.fromTo(
    dialog,
    { opacity: 0, scale: 0.88 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.55,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity",
      onComplete: () => {
        dialog.classList.remove("pretty-modal-opening");
      },
    },
  );
}

export function closePrettyModal(dialog: HTMLDialogElement, onClosed?: () => void): void {
  const finish = () => {
    dialog.classList.remove("pretty-modal-opening", "pretty-modal-closing");
    dialog.removeAttribute("style");
    if (dialog.open) dialog.close();
    onClosed?.();
  };

  if (!shouldAnimate() || !dialog.open) {
    finish();
    return;
  }

  gsap.killTweensOf(dialog);
  const flipId = dialog.dataset.flipId;
  const origin = flipId
    ? (document.querySelector(`[data-flip-id="${flipId}"]:not([open])`) as HTMLElement | null)
    : null;

  if (origin && origin.isConnected && origin.getBoundingClientRect().width > 0) {
    const originState = Flip.getState(origin);
    Flip.to(originState, {
      targets: dialog,
      scale: true,
      ease: PRETTY_MODAL_EASE,
      toggleClass: "pretty-modal-closing",
      duration: 0.7,
      onComplete: finish,
    });
    return;
  }

  dialog.classList.add("pretty-modal-closing");
  gsap.to(dialog, {
    opacity: 0,
    scale: 0.88,
    duration: 0.5,
    ease: PRETTY_MODAL_EASE,
    onComplete: finish,
  });
}

export function animateFadeSlide(el: HTMLElement, yOffset = 6): void {
  if (!shouldAnimate()) return;
  gsap.fromTo(
    el,
    { opacity: 0, y: yOffset },
    { opacity: 1, y: 0, duration: 0.16, ease: "power2.out", clearProps: "transform,opacity" },
  );
}

export function animateStagger(els: HTMLElement[]): void {
  if (!shouldAnimate() || els.length === 0) return;
  gsap.fromTo(
    els,
    { opacity: 0, y: 6 },
    {
      opacity: 1,
      y: 0,
      duration: 0.16,
      stagger: 0.025,
      ease: "power2.out",
      clearProps: "transform,opacity",
    },
  );
}

export function animateCaelestiaIn(el: HTMLElement): number {
  if (!shouldAnimate()) return 0;
  gsap.killTweensOf(el);
  el.classList.remove("pretty-modal-opening", "pretty-modal-closing");
  el.removeAttribute("style");

  const isRecentPointer = performance.now() - lastPointerAt < 200;
  const candidate = isRecentPointer ? lastPointerTrigger : null;
  lastPointerTrigger = null;
  lastPointerAt = 0;
  const origin =
    candidate &&
    candidate.isConnected &&
    !el.contains(candidate) &&
    candidate !== document.body &&
    candidate !== document.documentElement &&
    candidate.getBoundingClientRect().width > 0
      ? candidate
      : null;

  if (origin) {
    const flipId = Math.random().toString(16).slice(2);
    el.dataset.flipId = flipId;
    origin.dataset.flipId = flipId;
    const originState = Flip.getState(origin);
    Flip.from(originState, {
      targets: el,
      scale: true,
      ease: PRETTY_MODAL_EASE,
      toggleClass: "pretty-modal-opening",
      duration: 0.7,
      onComplete: () => {
        el.classList.remove("pretty-modal-opening");
        el.removeAttribute("style");
      },
    });
    return 0.7;
  }

  delete el.dataset.flipId;
  el.classList.add("pretty-modal-opening");
  gsap.fromTo(
    el,
    { opacity: 0, scale: 0.88 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.55,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity",
      onComplete: () => {
        el.classList.remove("pretty-modal-opening");
      },
    },
  );
  return 0.55;
}

export function animateCaelestiaOut(el: HTMLElement, onDone: () => void): number {
  const finish = () => {
    el.classList.remove("pretty-modal-opening", "pretty-modal-closing");
    el.removeAttribute("style");
    onDone();
  };

  if (!shouldAnimate()) {
    finish();
    return 0;
  }

  gsap.killTweensOf(el);
  const flipId = el.dataset.flipId;
  const origin = flipId
    ? (document.querySelector(`[data-flip-id="${flipId}"]`) as HTMLElement | null)
    : null;
  const validOrigin = origin && origin !== el && !el.contains(origin) && origin.isConnected && origin.getBoundingClientRect().width > 0
    ? origin
    : null;

  if (validOrigin) {
    const originState = Flip.getState(validOrigin);
    Flip.to(originState, {
      targets: el,
      scale: true,
      ease: PRETTY_MODAL_EASE,
      toggleClass: "pretty-modal-closing",
      duration: 0.7,
      onComplete: finish,
    });
    return 0.7;
  }

  el.classList.add("pretty-modal-closing");
  gsap.to(el, {
    opacity: 0,
    scale: 0.88,
    duration: 0.5,
    ease: PRETTY_MODAL_EASE,
    onComplete: finish,
  });
  return 0.5;
}

export function animateLayoutWithPanel(
  panelEl: HTMLElement,
  companionEl: HTMLElement | null,
  show: boolean,
  applyLayout: () => void,
  onDone?: () => void,
): void {
  if (companionEl) {
    gsap.killTweensOf(companionEl);
    companionEl.removeAttribute("style");
  }
  gsap.killTweensOf(panelEl);

  if (!shouldAnimate()) {
    panelEl.classList.remove("pretty-sync-opening", "pretty-sync-closing");
    panelEl.removeAttribute("style");
    applyLayout();
    onDone?.();
    return;
  }

  const isSidebar = panelEl.id === "sidebar";

  if (show) {
    panelEl.classList.remove("pretty-sync-closing", "pretty-sync-opening");
    panelEl.removeAttribute("style");
    applyLayout();
    const rect = panelEl.getBoundingClientRect();
    gsap.fromTo(
      panelEl,
      isSidebar
        ? { width: 0, marginRight: -8, opacity: 0 }
        : { height: 0, marginTop: 0, opacity: 0 },
      {
        ...(isSidebar ? { width: rect.width, marginRight: 0 } : { height: rect.height, marginTop: 6 }),
        opacity: 1,
        duration: 0.42,
        ease: PRETTY_MODAL_EASE,
        clearProps: "width,height,marginRight,marginTop,opacity",
        onComplete: () => {
          onDone?.();
        },
        onInterrupt: () => {
          panelEl.removeAttribute("style");
        },
      },
    );
    return;
  }

  const rect = panelEl.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) {
    applyLayout();
    onDone?.();
    return;
  }

  panelEl.classList.remove("pretty-sync-opening", "pretty-sync-closing");
  gsap.fromTo(
    panelEl,
    isSidebar
      ? { width: rect.width, marginRight: 0, opacity: 1 }
      : { height: rect.height, marginTop: 6, opacity: 1 },
    {
      ...(isSidebar ? { width: 0, marginRight: -8 } : { height: 0, marginTop: 0 }),
      opacity: 0,
      duration: 0.38,
      ease: PRETTY_MODAL_EASE,
      onComplete: () => {
        panelEl.removeAttribute("style");
        applyLayout();
        onDone?.();
      },
      onInterrupt: () => {
        panelEl.removeAttribute("style");
      },
    },
  );
}

export function animateCaelestiaItems(els: HTMLElement[]): void {
  if (!shouldAnimate() || els.length === 0) return;
  const targets = els.slice(0, 20);
  gsap.killTweensOf(targets);
  gsap.fromTo(
    targets,
    { opacity: 0, scale: 0.96, filter: "blur(4px)" },
    {
      opacity: 1,
      scale: 1,
      filter: "blur(0px)",
      duration: 0.35,
      stagger: 0.015,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity,filter",
    },
  );
}

export function animateCaelestiaItemsOut(els: HTMLElement[]): void {
  if (!shouldAnimate() || els.length === 0) return;
  const ghosts: HTMLElement[] = [];
  for (const el of els.slice(0, 20)) {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const ghost = el.cloneNode(true) as HTMLElement;
    ghost.style.position = "fixed";
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.margin = "0";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "20";
    document.body.append(ghost);
    ghosts.push(ghost);
  }
  if (ghosts.length === 0) return;
  gsap.to(ghosts, {
    opacity: 0,
    scale: 0.94,
    y: -4,
    filter: "blur(4px)",
    duration: 0.28,
    stagger: { each: 0.012, from: "end" },
    ease: PRETTY_MODAL_EASE,
    onComplete: () => {
      for (const g of ghosts) g.remove();
    },
  });
}

export function animateContextMenuIn(el: HTMLElement): void {
  if (!shouldAnimate()) return;
  gsap.killTweensOf(el);
  el.classList.remove("pretty-sync-closing");
  el.classList.add("pretty-sync-opening");
  gsap.fromTo(
    el,
    { opacity: 0, scale: 0.9, y: -6, transformOrigin: "top left" },
    {
      opacity: 1,
      scale: 1,
      y: 0,
      duration: 0.28,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity,transformOrigin",
      onComplete: () => {
        el.classList.remove("pretty-sync-opening");
      },
    },
  );
}

export function animateContextMenuOut(el: HTMLElement, onDone: () => void): void {
  if (!shouldAnimate()) {
    onDone();
    return;
  }
  gsap.killTweensOf(el);
  el.classList.remove("pretty-sync-opening");
  el.classList.add("pretty-sync-closing");
  gsap.to(el, {
    opacity: 0,
    scale: 0.9,
    y: -6,
    transformOrigin: "top left",
    duration: 0.22,
    ease: PRETTY_MODAL_EASE,
    onComplete: onDone,
  });
}

export function animateTabIn(el: HTMLElement): void {
  if (!shouldAnimate()) return;
  gsap.killTweensOf(el);
  el.classList.remove("pretty-sync-closing");
  el.classList.add("pretty-sync-opening");
  gsap.fromTo(
    el,
    { opacity: 0, scale: 0.85 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.5,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity",
      onComplete: () => {
        el.classList.remove("pretty-sync-opening");
      },
    },
  );
}

export function animateTabOut(el: HTMLElement): void {
  if (!shouldAnimate()) {
    el.remove();
    return;
  }
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    el.remove();
    return;
  }
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.margin = "0";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "30";
  ghost.classList.add("pretty-sync-closing");
  document.body.append(ghost);
  gsap.to(ghost, {
    opacity: 0,
    scale: 0.82,
    duration: 0.5,
    ease: PRETTY_MODAL_EASE,
    onComplete: () => ghost.remove(),
  });
}

export function captureTabsFlip(els: HTMLElement[]): Flip.FlipState | null {
  if (!shouldAnimate() || els.length === 0) return null;
  return Flip.getState(els);
}

export function playTabsFlip(state: Flip.FlipState | null, targets: HTMLElement[]): void {
  if (!state || !shouldAnimate() || targets.length === 0) return;
  Flip.from(state, {
    targets,
    duration: 0.5,
    ease: PRETTY_MODAL_EASE,
    clearProps: "transform",
  });
}

export function animateEditorContentIn(el: HTMLElement): void {
  if (!shouldAnimate()) return;
  gsap.killTweensOf(el);
  el.classList.remove("pretty-sync-closing");
  el.classList.add("pretty-sync-opening");
  gsap.fromTo(
    el,
    { opacity: 0, scale: 0.97 },
    {
      opacity: 1,
      scale: 1,
      duration: 0.5,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity",
      onComplete: () => {
        el.classList.remove("pretty-sync-opening");
      },
    },
  );
}

export function animateEditorContentOut(el: HTMLElement): void {
  if (!shouldAnimate()) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return;
  const wrapper = document.createElement("div");
  wrapper.style.position = "fixed";
  wrapper.style.left = `${rect.left}px`;
  wrapper.style.top = `${rect.top}px`;
  wrapper.style.width = `${rect.width}px`;
  wrapper.style.height = `${rect.height}px`;
  wrapper.style.margin = "0";
  wrapper.style.overflow = "hidden";
  wrapper.style.pointerEvents = "none";
  wrapper.style.zIndex = "25";
  wrapper.classList.add("pretty-sync-closing");
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.style.width = "100%";
  ghost.style.height = "100%";
  wrapper.append(ghost);
  document.body.append(wrapper);
  gsap.to(wrapper, {
    opacity: 0,
    scale: 0.94,
    duration: 0.5,
    ease: PRETTY_MODAL_EASE,
    onComplete: () => wrapper.remove(),
  });
}

export function animateGitPopoverIn(el: HTMLElement, anchor: HTMLElement | null): void {
  if (!shouldAnimate()) return;
  gsap.killTweensOf(el);
  const elRect = el.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect();
  const originX = anchorRect
    ? Math.max(0, Math.min(elRect.width, anchorRect.left + anchorRect.width / 2 - elRect.left))
    : elRect.width - 20;
  const dx = anchorRect ? anchorRect.left + anchorRect.width / 2 - (elRect.left + originX) : 0;
  const dy = anchorRect ? anchorRect.top + anchorRect.height / 2 - elRect.top : -12;

  gsap.fromTo(
    el,
    {
      opacity: 0,
      scale: 0.18,
      x: dx,
      y: dy,
      borderRadius: "28px",
      filter: "blur(6px)",
      transformOrigin: `${originX}px 0px`,
    },
    {
      opacity: 1,
      scale: 1,
      x: 0,
      y: 0,
      borderRadius: "10px",
      filter: "blur(0px)",
      duration: 0.36,
      ease: PRETTY_MODAL_EASE,
      clearProps: "transform,opacity,borderRadius,filter,transformOrigin",
    },
  );
}

export function animateGitPopoverOut(
  el: HTMLElement,
  anchor: HTMLElement | null,
  onDone: () => void,
): void {
  const finish = () => {
    el.removeAttribute("style");
    onDone();
  };
  if (!shouldAnimate()) {
    finish();
    return;
  }
  gsap.killTweensOf(el);
  const elRect = el.getBoundingClientRect();
  const anchorRect = anchor?.getBoundingClientRect();
  const originX = anchorRect
    ? Math.max(0, Math.min(elRect.width, anchorRect.left + anchorRect.width / 2 - elRect.left))
    : elRect.width - 20;
  const dx = anchorRect ? anchorRect.left + anchorRect.width / 2 - (elRect.left + originX) : 0;
  const dy = anchorRect ? anchorRect.top + anchorRect.height / 2 - elRect.top : -12;

  gsap.to(el, {
    opacity: 0,
    scale: 0.18,
    x: dx,
    y: dy,
    borderRadius: "28px",
    filter: "blur(6px)",
    transformOrigin: `${originX}px 0px`,
    duration: 0.28,
    ease: "power2.in",
    onComplete: finish,
  });
}
