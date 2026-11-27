// Interactive hourly grid for week/day calendars. Blocks can be tapped (edit sheet),
// dragged (long-press on touch, pointer drag on desktop, also across days), resized from
// the visible bottom handle, or moved with Alt+Arrow (Alt+Shift+Arrow resizes).
// Simultaneous activities are laid out side by side in lanes, each independently editable.
// Every change is committed through the same store command as the edit sheet.
import { h } from './ui.js';
import { fromMin, DAY_SHORT, fmtShort, weekday } from './dates.js';
import { dayOccurrences } from './engine/schedule.js';
import { BLOCK_STATUS_LABEL } from './data/schema.js';

const SNAP = 15;

function lanes(occs) {
  const res = new Map();
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const ends = [];
    for (const o of cluster) {
      let l = ends.findIndex((e) => e <= o.s);
      if (l === -1) { l = ends.length; ends.push(0); }
      ends[l] = o.e;
      res.set(o.id, { lane: l });
    }
    for (const o of cluster) res.get(o.id).count = ends.length;
    cluster = [];
  };
  for (const o of occs) {
    if (o.s >= clusterEnd && cluster.length) flush();
    cluster.push(o);
    clusterEnd = Math.max(clusterEnd, o.e);
  }
  if (cluster.length) flush();
  return res;
}

export function timeGrid(state, days, { today, nowMinute, onTap, onEmpty, onChange, ppm = 1.0667 } = {}) {
  const all = days.map((d) => dayOccurrences(state, d));
  let start = 8 * 60, end = 17 * 60;
  for (const list of all) for (const o of list) { start = Math.min(start, Math.floor(o.s / 60) * 60); end = Math.max(end, Math.ceil(o.e / 60) * 60); }
  start = Math.max(0, Math.floor(start / 60) * 60);
  end = Math.min(24 * 60, Math.ceil(end / 60) * 60);
  const height = (end - start) * ppm;
  const catColor = (id) => state.settings.categories.find((c) => c.id === id)?.color || '#526273';
  const root = h('div.tg', { style: { '--days': String(days.length), '--hour': `${60 * ppm}px` }, role: 'group', 'aria-label': 'לוח שעות' });
  // A single day is already named by the date navigation above it; only weeks get a header row.
  if (days.length > 1) root.append(h('div.tg-head', h('div'), days.map((d) => h('a.tg-dh' + (d === today ? '.today' : ''), { href: `#/agenda/${d}`, 'aria-label': `יום ${DAY_SHORT[weekday(d)]} ${fmtShort(d)}${d === today ? ', היום' : ''}` },
    h('span', DAY_SHORT[weekday(d)]), h('b', fmtShort(d))))));
  else root.classList.add('single');
  const hoursCol = h('div.tg-hours', { style: { height: height + 'px' }, 'aria-hidden': 'true' });
  for (let m = start + 60; m < end; m += 60) hoursCol.append(h('span', { style: { top: (m - start) * ppm + 'px' } }, fromMin(m)));
  const body = h('div.tg-body', hoursCol);
  const cols = [];
  days.forEach((d, i) => {
    const col = h('div.tg-col', { dataset: { date: d }, style: { height: height + 'px', backgroundPosition: `0 ${(60 - (start % 60)) % 60 * ppm}px` } });
    const L = lanes(all[i]);
    for (const o of all[i]) {
      const { lane, count } = L.get(o.id);
      const len = o.e - o.s;
      const draggable = onChange && o.status !== 'done';
      const blk = h('button.tg-blk' + (o.status !== 'planned' ? '.' + o.status : '') + (count > 1 ? '.lane' : ''), {
        type: 'button',
        dataset: { id: o.id, s: o.s, e: o.e, drag: draggable ? '1' : '' },
        'aria-label': `${o.title}, ${o.start} עד ${o.end}${o.status !== 'planned' ? ', ' + BLOCK_STATUS_LABEL[o.status] : ''}`,
        'aria-keyshortcuts': draggable ? 'Alt+ArrowUp Alt+ArrowDown Alt+Shift+ArrowUp Alt+Shift+ArrowDown' : null,
        style: {
          top: (o.s - start) * ppm + 'px', height: Math.max(len * ppm - 2, 18) + 'px',
          insetInlineStart: `calc(${(lane / count) * 100}% + 2px)`, width: `calc(${100 / count}% - 6px)`, '--c': catColor(o.categoryId),
        },
      }, h('span.t', o.title), len * ppm >= 36 ? h('span.m', h('bdi', `${o.start}-${o.end}`)) : null, draggable && len * ppm >= 30 ? h('span.tg-rs', { 'aria-hidden': 'true' }) : null);
      col.append(blk);
    }
    if (d === today && nowMinute >= start && nowMinute <= end) col.append(h('div.tg-now', { style: { top: (nowMinute - start) * ppm + 'px' } }));
    cols.push(col);
    body.append(col);
  });
  root.append(body);

  // ---- interactions ----
  let cur = null, suppressClick = false;
  const colAt = (x) => cols.find((c) => { const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right; });
  const activate = (st) => {
    st.active = true;
    st.blk.classList.add('dragging');
    root.classList.add('is-dragging');
    try { st.blk.setPointerCapture(st.pid); } catch { /* ignore */ }
    if (navigator.vibrate) navigator.vibrate(8);
  };
  const finish = (commit) => {
    const st = cur;
    cur = null;
    if (!st) return;
    clearTimeout(st.timer);
    root.classList.remove('is-dragging');
    if (!st.active) return;
    st.blk.classList.remove('dragging');
    if (!st.moved) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 60);
    if (commit && (st.ns !== st.s0 || st.ne !== st.e0 || st.date !== st.date0)) onChange(st.id, st.date, st.ns, st.ne, st.resize);
    else st.blk.style.top = (st.s0 - start) * ppm + 'px';
  };
  root.addEventListener('pointerdown', (e) => {
    const blk = e.target.closest('.tg-blk');
    if (!blk || !blk.dataset.drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const resize = !!e.target.closest('.tg-rs');
    const col = blk.closest('.tg-col');
    cur = { blk, resize, pid: e.pointerId, x0: e.clientX, y0: e.clientY, active: false, id: blk.dataset.id, s0: +blk.dataset.s, e0: +blk.dataset.e, ns: +blk.dataset.s, ne: +blk.dataset.e, date0: col.dataset.date, date: col.dataset.date, touch: e.pointerType !== 'mouse' };
    if (resize) { activate(cur); e.preventDefault(); }
    else if (cur.touch) { const st = cur; st.timer = setTimeout(() => { if (cur === st) activate(st); }, 420); }
  });
  root.addEventListener('pointermove', (e) => {
    const st = cur;
    if (!st || e.pointerId !== st.pid) return;
    const dx = e.clientX - st.x0, dy = e.clientY - st.y0;
    if (!st.active) {
      if (st.touch && Math.hypot(dx, dy) > 8) { clearTimeout(st.timer); cur = null; return; } // a scroll, not a drag
      if (!st.touch && Math.hypot(dx, dy) > 5) activate(st); else return;
    }
    e.preventDefault();
    st.moved = true;
    const dm = Math.round(dy / ppm / SNAP) * SNAP;
    if (st.resize) {
      st.ne = Math.min(24 * 60 - 1, Math.max(st.s0 + SNAP, st.e0 + dm));
      st.blk.style.height = Math.max((st.ne - st.s0) * ppm - 2, 18) + 'px';
    } else {
      const len = st.e0 - st.s0;
      st.ns = Math.max(0, Math.min(24 * 60 - 1 - len, st.s0 + dm));
      st.ne = st.ns + len;
      st.blk.style.top = (st.ns - start) * ppm + 'px';
      const c = colAt(e.clientX);
      if (c && c.dataset.date !== st.date) { st.date = c.dataset.date; c.append(st.blk); st.blk.style.insetInlineStart = '2px'; st.blk.style.width = 'calc(100% - 6px)'; }
    }
    const m = st.blk.querySelector('.m bdi');
    if (m) m.textContent = `${fromMin(st.ns)}-${fromMin(st.ne)}`;
  });
  root.addEventListener('pointerup', () => finish(true));
  root.addEventListener('pointercancel', () => finish(false));
  root.addEventListener('touchmove', (e) => { if (cur && cur.active) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('.tg-blk')) e.preventDefault(); });
  root.addEventListener('click', (e) => {
    if (suppressClick) { e.preventDefault(); return; }
    const blk = e.target.closest('.tg-blk');
    if (blk) { onTap && onTap(blk.dataset.id); return; }
    const col = e.target.closest('.tg-col');
    if (col && onEmpty) {
      const r = col.getBoundingClientRect();
      const m = Math.floor(((e.clientY - r.top) / ppm + start) / SNAP) * SNAP;
      onEmpty(col.dataset.date, m);
    }
  });
  root.addEventListener('keydown', (e) => {
    const blk = e.target.closest('.tg-blk');
    if (!blk || !blk.dataset.drag || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const d = e.key === 'ArrowUp' ? -SNAP : SNAP;
    const s0 = +blk.dataset.s, e0 = +blk.dataset.e;
    const date = blk.closest('.tg-col').dataset.date;
    if (e.shiftKey) onChange(blk.dataset.id, date, s0, Math.max(s0 + SNAP, e0 + d), true);
    else onChange(blk.dataset.id, date, s0 + d, e0 + d, false);
  });
  return root;
}
