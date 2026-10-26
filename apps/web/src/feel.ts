/**
 * Press feedback without a library: a ripple that starts where the pointer touched any button, link or card, and a
 * light tilt on cards that follow the pointer. Both are delegated from the document, cost nothing while idle, and are
 * skipped under reduced motion or on coarse pointers (the tilt). Styles live in global.css (.rippleWave, [data-tilt]).
 */
const RIPPLE_TARGETS = 'button:not(:disabled), a[class], [data-ripple]';
const SKIP = 'input, select, textarea, [data-no-ripple]';
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export function installFeel(): () => void {
  const ripple = (event: PointerEvent) => {
    if (event.button !== 0 || reducedMotion()) return;
    const origin = event.target as Element | null;
    if (!origin || origin.closest(SKIP)) return;
    const target = origin.closest<HTMLElement>(RIPPLE_TARGETS);
    if (!target) return;
    const box = target.getBoundingClientRect();
    const size = Math.hypot(box.width, box.height) * 2;
    const wave = document.createElement('span');
    wave.className = 'rippleWave';
    wave.style.width = wave.style.height = `${size}px`;
    wave.style.left = `${event.clientX - box.left - size / 2}px`;
    wave.style.top = `${event.clientY - box.top - size / 2}px`;
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.dataset.rippling = '';
    target.appendChild(wave);
    wave.addEventListener('animationend', () => { wave.remove(); if (!target.querySelector('.rippleWave')) delete target.dataset.rippling; }, { once: true });
  };
  const tilt = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>('[data-tilt]');
    if (!card || !finePointer() || reducedMotion()) return;
    const box = card.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width - .5;
    const y = (event.clientY - box.top) / box.height - .5;
    card.style.setProperty('--tilt-x', `${(-y * 2.5).toFixed(2)}deg`);
    card.style.setProperty('--tilt-y', `${(x * 2.5).toFixed(2)}deg`);
  };
  const untilt = (event: PointerEvent) => {
    const card = (event.target as Element | null)?.closest<HTMLElement>('[data-tilt]');
    if (!card || card.contains(event.relatedTarget as Node | null)) return;
    card.style.removeProperty('--tilt-x');
    card.style.removeProperty('--tilt-y');
  };
  document.addEventListener('pointerdown', ripple, { passive: true });
  document.addEventListener('pointermove', tilt, { passive: true });
  document.addEventListener('pointerout', untilt, { passive: true });
  return () => { document.removeEventListener('pointerdown', ripple); document.removeEventListener('pointermove', tilt); document.removeEventListener('pointerout', untilt); };
}
