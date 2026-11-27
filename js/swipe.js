// Horizontal swipe for date navigation (agenda, calendar day/week/month).
// RTL convention: time runs right to left, so moving the finger to the right brings the
// next period in from the left, and moving it to the left goes back.
// Swipes are ignored when they start on an activity (drag/resize), a form control, near a
// screen edge (system gestures), while a sheet is open, while a grid drag is active, or
// when they scrolled a horizontally scrollable grid (only a grid already at its edge yields
// to navigation). Listeners are passive, so vertical scrolling is never blocked.
import { sheetOpen } from './ui.js';

const MIN_DISTANCE = 64;   // px
const MAX_DURATION = 700;  // ms
const EDGE = 24;           // px kept free for iOS edge gestures
const IGNORE = 'input, textarea, select, button.tg-blk, .tg-rs, .date-field, [data-no-swipe]';

/**
 * @param {HTMLElement} el
 * @param {{next: () => void, prev: () => void}} nav
 */
export function attachSwipe(el, { next, prev }) {
  let st = null;
  el.addEventListener('touchstart', (e) => {
    st = null;
    if (e.touches.length !== 1 || sheetOpen()) return;
    const t = e.touches[0];
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    // The date in the navigation bar opens its picker only on a tap, so a swipe there navigates.
    if (e.target.closest?.(IGNORE) && !e.target.closest('.nav-date')) return;
    const scroller = e.target.closest?.('.tg');
    st = { x: t.clientX, y: t.clientY, at: Date.now(), scroller, left: scroller ? scroller.scrollLeft : 0 };
  }, { passive: true });
  el.addEventListener('touchcancel', () => { st = null; }, { passive: true });
  el.addEventListener('touchend', (e) => {
    const s = st;
    st = null;
    if (!s || e.changedTouches.length !== 1) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x, dy = t.clientY - s.y;
    if (Math.abs(dx) < MIN_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.8 || Date.now() - s.at > MAX_DURATION) return;
    if (document.querySelector('.tg.is-dragging') || sheetOpen()) return;
    if (s.scroller && Math.abs(s.scroller.scrollLeft - s.left) > 1) return; // the grid scrolled instead
    if (dx > 0) next(); else prev();
  }, { passive: true });
}

/** Navigate by replacing the hash, remembering the direction for the page transition. */
export function goTo(hash, dir) {
  document.documentElement.dataset.navDir = dir;
  location.hash = hash;
}
