// A small confetti burst when the daily inquiry target is reached. Once per calendar day
// (remembered per device), never on reopen, never again after going down and up, and
// nothing at all when reduced motion is on. Pieces are plain elements animated with the
// Web Animations API (allowed by the strict CSP) and removed after about two seconds.
import { loadUi, saveUi } from './uiPrefs.js';

const PIECES = 26;
const DURATION = 1700;

function reducedMotion() {
  if (document.documentElement.dataset.motion === 'reduce') return true;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** Celebrate reaching the target on `date` unless it was already celebrated that day. */
export function celebrateOnce(date) {
  if (loadUi('celebratedOn', null) === date) return false;
  saveUi('celebratedOn', date);
  if (reducedMotion() || typeof Element.prototype.animate !== 'function') return true;
  // Wait for the re-render so the burst starts from the ring that is on screen.
  requestAnimationFrame(() => burst(document.querySelector('.counter .ring')));
  return true;
}

function burst(anchor) {
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  const cs = getComputedStyle(document.documentElement);
  const colors = ['--primary', '--primary-strong', '--success', '--warning', '--primary-soft']
    .map((v) => cs.getPropertyValue(v).trim()).filter(Boolean);
  const layer = document.createElement('div');
  layer.className = 'confetti';
  layer.setAttribute('aria-hidden', 'true');
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < PIECES; i++) {
    const p = document.createElement('span');
    const angle = (Math.PI * 2 * i) / PIECES + Math.random() * 0.4;
    const dist = 60 + Math.random() * 70;
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist * 0.8 - 30;
    p.style.left = `${cx}px`;
    p.style.top = `${cy}px`;
    p.style.background = colors[i % colors.length] || '#286C96';
    if (i % 3 === 0) p.style.borderRadius = '50%';
    const spin = (Math.random() * 360 - 180) | 0;
    p.animate([
      { transform: 'translate(-50%, -50%) scale(0.4) rotate(0deg)', opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7}px)) scale(1) rotate(${spin / 2}deg)`, opacity: 1, offset: 0.25 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 70}px)) scale(0.9) rotate(${spin}deg)`, opacity: 0 },
    ], { duration: DURATION + Math.random() * 300, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'forwards' });
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), DURATION + 400);
}
