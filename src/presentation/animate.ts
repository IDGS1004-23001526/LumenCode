import gsap from "gsap";

let animationsEnabled = true;

export function setAnimationsEnabled(enabled: boolean): void {
  animationsEnabled = enabled;
}

export function shouldAnimate(): boolean {
  if (!animationsEnabled) return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function animateModalOpen(el: HTMLElement): void {
  if (!shouldAnimate()) return;
  gsap.fromTo(
    el,
    { opacity: 0, scale: 0.97, y: 8 },
    { opacity: 1, scale: 1, y: 0, duration: 0.2, ease: "power2.out", clearProps: "transform,opacity" },
  );
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
