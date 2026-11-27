// DOM helpers, icons, accessible sheets/dialogs, toasts and form controls.
// User and imported strings are only ever inserted as text nodes. The `svg` attribute is
// reserved for the static icon markup defined in this file.
import { fmtDayDate, fmtLong } from './dates.js';

const ICONS = {
  house: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-6h4v6"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  squareCheck: '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="m8 12 3 3 5-6"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.5h18M8 3v3M16 3v3"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 15H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9.7 4V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1.3z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  headset: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="13" width="4" height="6" rx="1.5"/><rect x="17" y="13" width="4" height="6" rx="1.5"/><path d="M19 19c0 1.5-2 2.5-5 2.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 10.5h1.5a2.5 2.5 0 0 1 0 5H17M8 3.5v2.5M12 3.5v2.5"/>',
  users: '<circle cx="9" cy="8" r="3.3"/><path d="M3 20c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5"/><path d="M16 4.8a3.2 3.2 0 0 1 0 6.3M17.5 14.7c2 .7 3.2 2.5 3.5 5.3"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/>',
  building: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2M10 21v-3h4v3"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21z"/><path d="M4 21V5.5"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M15 3v4h4M8 12h8M8 16h5"/>',
  tool: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9L21 12l-9 9-3-3 9-9-1.6-1.6a4 4 0 0 0-5-4.9l2.6 2.6-1.4 1.4z"/>',
  alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 5 6 5 9s-5 4-5 9M17 3c0 5-5 6-5 9s5 4 5 9"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 6.5h16M9.5 6.5V4h5v2.5M6.5 6.5l1 13.5h9l1-13.5"/>',
  more: '<circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/>',
  copy: '<rect x="8" y="8" width="12.5" height="12.5" rx="2.5"/><path d="M15.5 8V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2H8"/>',
  share: '<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M5 12v6.5A2 2 0 0 0 7 20.5h10a2 2 0 0 0 2-2V12"/>',
  download: '<path d="M12 3.5v12M7 11l5 5 5-5"/><path d="M4 20.5h16"/>',
  upload: '<path d="M12 16V4.5M7 9l5-5 5 5"/><path d="M4 20.5h16"/>',
  image: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-4.5-4.5L5 20.5"/>',
  printer: '<path d="M7 9V3h10v6"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/>',
  repeat: '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M3.5 12V10a3 3 0 0 1 3-3h14"/><path d="M7 20.5 3.5 17 7 13.5"/><path d="M20.5 12v2a3 3 0 0 1-3 3h-14"/>',
  focus: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".8"/>',
  wand: '<path d="m4 20 11-11M14 4l1 2.5L17.5 7.5 15 8.5 14 11l-1-2.5L10.5 7.5 13 6.5z"/><path d="M19 13.5v3M17.5 15h3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  pin: '<path d="M9 3h6l-1 6 3 3H7l3-3z"/><path d="M12 12v9"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/>',
  grip: '<path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/>',
  scissors: '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8 8.2 20 18M8 15.8 20 6"/>',
  merge: '<path d="M7 4v5a5 5 0 0 0 5 5 5 5 0 0 1 5 5v1"/><path d="M17 4v5a5 5 0 0 1-5 5"/>',
  dup: '<rect x="8" y="8" width="12.5" height="12.5" rx="2.5"/><path d="M15.5 8V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2H8"/>',
  arrowBack: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
};

export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[name] || ICONS.dot}</svg>`;
}

/** Hyperscript: h('div.card#id', {onclick, class, style, svg, dataset, aria-*}, ...children) */
export function h(tag, attrs, ...children) {
  const idMatch = /#([^.#]+)/.exec(tag);
  const idPart = idMatch ? idMatch[1] : null;
  const [name, ...cls] = tag.replace(/#[^.#]+/, '').split('.');
  const el = document.createElement(name || 'div');
  if (idPart) el.id = idPart;
  if (cls.length) el.className = cls.join(' ');
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { children.unshift(attrs); attrs = null; }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) el.style.setProperty(sk, sv); else el.style[sk] = sv; } }
      else if (k === 'svg') el.innerHTML = v; // static icon markup only
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'text') el.textContent = v;
      else if (k in el && !k.includes('-') && k !== 'list' && k !== 'form' && k !== 'type' || k === 'value' || k === 'checked') {
        try { el[k] = v; } catch { el.setAttribute(k, v); }
      } else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** Replace an element's children, skipping null/false entries (never renders "null"). */
export const setChildren = (el, ...children) => el.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false));

export const ic = (name, size) => h('span.icw', { svg: icon(name, size), 'aria-hidden': 'true' });
/** Left-to-right isolated span for times, dates and ratios inside RTL text. */
export const ltr = (text) => h('bdi.ltr', { dir: 'ltr' }, text);

export function btn(label, onclick, cls = '', iconName = null, attrs = {}) {
  return h('button.btn' + (cls ? '.' + cls.split(' ').filter(Boolean).join('.') : ''), { type: 'button', onclick, ...attrs }, iconName ? ic(iconName, 18) : null, label ? h('span', label) : null);
}
export function iconBtn(iconName, label, onclick, cls = '') {
  return h('button.icon-btn' + (cls ? '.' + cls.split(' ').filter(Boolean).join('.') : ''), { type: 'button', onclick, 'aria-label': label, title: label, svg: icon(iconName, 22) });
}

// ---------- sheets / dialogs ----------
const stack = [];
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible bottom sheet / dialog. Focus is trapped, Escape closes, focus is restored.
 * @returns {{close:Function, el:HTMLElement, set:Function, body:HTMLElement}}
 */
export function openSheet({ title, body, footer, onClose, labelledBy, beforeClose }) {
  const prevFocus = document.activeElement;
  const titleId = 'sh-' + Math.random().toString(36).slice(2, 8);
  const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': labelledBy || titleId });
  const backdrop = h('div.backdrop', { onclick: (e) => { if (e.target === backdrop) api.close(); } }, panel);
  const grab = h('div.sheet-grab', { 'aria-hidden': 'true' });
  const head = h('div.sheet-head', h('h2', { id: titleId }, title || ''), iconBtn('x', 'סגירה', () => api.close()));
  const content = h('div.sheet-body');
  const foot = h('div.sheet-foot');
  panel.append(grab, head, content, foot);
  const set = (b, f) => {
    content.replaceChildren(...[].concat(b || []).flat(Infinity).filter(Boolean));
    const fb = [].concat(f || []).flat(Infinity).filter(Boolean);
    foot.replaceChildren(...fb);
    foot.hidden = !fb.length;
  };
  set(body, footer);
  // Swipe down on the grab handle to dismiss.
  let y0 = null;
  grab.addEventListener('pointerdown', (e) => { y0 = e.clientY; grab.setPointerCapture?.(e.pointerId); });
  grab.addEventListener('pointerup', (e) => { if (y0 != null && e.clientY - y0 > 70) api.close(); y0 = null; });
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...panel.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
  // Keep the sheet (and its save button) above the on-screen keyboard.
  const vv = window.visualViewport;
  const fit = () => {
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    panel.style.setProperty('--kb', kb + 'px');
    panel.style.maxHeight = kb ? `${Math.round(vv.height - 8)}px` : '';
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  panel.addEventListener('focusin', (e) => { if (e.target.matches?.('input, textarea, select')) setTimeout(() => e.target.scrollIntoView?.({ block: 'nearest' }), 250); });
  let closed = false;
  const api = {
    el: panel, body: content, set,
    setTitle: (t) => { head.querySelector('h2').textContent = t; },
    close(result) {
      if (closed) return;
      if (beforeClose && result === undefined && beforeClose() === false) return;
      closed = true;
      vv?.removeEventListener('resize', fit);
      vv?.removeEventListener('scroll', fit);
      backdrop.classList.remove('open');
      const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion')) || 0;
      setTimeout(() => backdrop.remove(), ms);
      stack.splice(stack.indexOf(api), 1);
      if (prevFocus && prevFocus.isConnected && prevFocus.focus) prevFocus.focus({ preventScroll: true });
      onClose && onClose(result);
    },
  };
  stack.push(api);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('open'));
  setTimeout(() => {
    const f = panel.querySelector('[autofocus]') || panel.querySelector('.sheet-body ' + FOCUSABLE) || head.querySelector('button');
    f && f.focus({ preventScroll: true });
  }, 30);
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && stack.length) { e.preventDefault(); stack[stack.length - 1].close(); }
});
export const closeAllSheets = () => [...stack].forEach((s) => s.close(null));
export const sheetOpen = () => stack.length > 0;

export function confirmDialog(text, { ok = 'אישור', cancel = 'ביטול', danger = false, title = 'לאשר?' } = {}) {
  return new Promise((resolve) => {
    let res = false;
    const lines = String(text).split('\n').map((l) => h('p', l));
    const sh = openSheet({
      title, onClose: () => resolve(res), body: h('div.stack', lines),
      footer: [btn(cancel, () => sh.close(), 'ghost'), btn(ok, () => { res = true; sh.close(true); }, danger ? 'danger' : 'primary')],
    });
  });
}

export function choose(title, options, { text } = {}) {
  return new Promise((resolve) => {
    let res = null;
    const sh = openSheet({
      title, onClose: () => resolve(res),
      body: [text ? h('p.muted', text) : null, h('div.choice-list', options.filter(Boolean).map((o) =>
        h('button.choice' + (o.danger ? '.danger' : ''), { type: 'button', onclick: () => { res = o.value; sh.close(true); } }, o.icon ? ic(o.icon) : null, h('span', h('b', o.label), o.sub ? h('small', o.sub) : null))))],
    });
  });
}

// ---------- toast ----------
let toastEl, toastTimer;
export function toast(msg, { action, timeout = 4200, error = false } = {}) {
  toastEl?.remove();
  clearTimeout(toastTimer);
  const el = h('div.toast' + (error ? '.error' : ''), { role: error ? 'alert' : 'status', 'aria-live': error ? 'assertive' : 'polite' },
    h('span', msg), action ? h('button', { type: 'button', onclick: () => { action.fn(); el.remove(); } }, action.label) : null);
  toastEl = el;
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  toastTimer = setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, timeout);
}

// ---------- form helpers ----------
export function field(label, control, hint) {
  const target = control.input || control;
  const id = target.id || 'f-' + Math.random().toString(36).slice(2, 8);
  target.id = id;
  return h('div.field', h('label.field-label', { for: id }, label), control, hint ? h('small.field-hint', hint) : null);
}

/**
 * Date field: shows the date in natural Hebrew ("יום שישי, 27 בנובמבר 2026") with the
 * native date picker laid transparently on top, so the picker opens on tap on every
 * device while the text never depends on the device locale or overflows its box.
 * `.value` gets/sets the ISO date; `.input` is the native control (for labels/tests).
 */
export function dateInput(value, { label = 'תאריך', onchange = null, clearable = false, placeholder = 'בחירת תאריך', short = false, attrs = {} } = {}) {
  const inp = h('input.date-native', { type: 'date', 'aria-label': label, ...attrs });
  inp.value = value || '';
  const text = h('span.date-text', { 'aria-hidden': 'true' });
  const clear = clearable ? h('button.date-clear', { type: 'button', 'aria-label': `ניקוי ${label}`, svg: icon('x', 18), onclick: () => { inp.value = ''; sync(); onchange && onchange(''); } }) : null;
  const wrap = h('div.date-field', text, inp, clear);
  function sync() {
    text.textContent = inp.value ? (short ? fmtDayDate(inp.value) : fmtLong(inp.value)) : placeholder;
    wrap.classList.toggle('empty', !inp.value);
    if (clear) clear.hidden = !inp.value;
  }
  inp.addEventListener('change', () => { sync(); onchange && onchange(inp.value); });
  inp.addEventListener('input', sync);
  sync();
  Object.defineProperty(wrap, 'value', { get: () => inp.value, set: (v) => { inp.value = v || ''; sync(); } });
  wrap.input = inp;
  return wrap;
}

/** Time field (HH:MM), left-to-right so digits never reorder in RTL. */
export const timeInput = (value, attrs = {}) => input('time', value, { dir: 'ltr', ...attrs });
export const input = (type, value, attrs = {}) => {
  const el = h('input.input', { ...attrs });
  el.type = type;
  el.value = value ?? '';
  return el;
};
export const textarea = (value, attrs = {}) => { const el = h('textarea.input', { rows: 3, ...attrs }); el.value = value ?? ''; return el; };
export function select(options, value, attrs = {}) {
  const el = h('select.input', attrs, options.map((o) => h('option', { value: o.value ?? '' }, o.label)));
  el.value = value ?? '';
  return el;
}
/** Segmented radio group. */
export function seg(options, value, onchange, label = '') {
  const wrap = h('div.seg', { role: 'radiogroup', 'aria-label': label });
  const render = (v) => {
    const none = !options.some((x) => x.value === v);
    wrap.replaceChildren(...options.map((o, idx) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(o.value === v), tabIndex: o.value === v || (none && idx === 0) ? 0 : -1,
      onclick: () => { wrap.value = o.value; render(o.value); onchange && onchange(o.value); },
      onkeydown: (e) => {
        const i = options.findIndex((x) => x.value === v);
        const dir = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0; // RTL
        if (!dir) return;
        e.preventDefault();
        const n = options[(i + dir + options.length) % options.length];
        wrap.value = n.value; render(n.value); onchange && onchange(n.value);
        wrap.querySelector('[aria-checked="true"]')?.focus();
      },
    }, o.label)));
  };
  wrap.value = value;
  render(value);
  return wrap;
}
export function dayPicker(days, onchange) {
  const L = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
  const N = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  const wrap = h('div.daypick', { role: 'group', 'aria-label': 'ימים בשבוע' });
  wrap.value = [...days];
  const render = () => wrap.replaceChildren(...L.map((l, i) => h('button', {
    type: 'button', 'aria-pressed': String(wrap.value.includes(i)), 'aria-label': `יום ${N[i]}`,
    onclick: () => { wrap.value = wrap.value.includes(i) ? wrap.value.filter((x) => x !== i) : [...wrap.value, i].sort(); render(); onchange && onchange(wrap.value); },
  }, l)));
  render();
  return wrap;
}
export function check(label, checked, onchange, attrs = {}) {
  const cb = h('input', { type: 'checkbox', ...attrs });
  cb.checked = !!checked;
  cb.addEventListener('change', () => onchange && onchange(cb.checked));
  return h('label.check', cb, h('span', label));
}
export const empty = (text, iconName = 'checkCircle') => h('div.empty', ic(iconName, 20), h('span', text));
export function section(title, opts = {}, ...children) {
  const id = 's-' + Math.random().toString(36).slice(2, 8);
  return h('section.section', { 'aria-labelledby': id, ...(opts.attrs || {}) },
    h('div.section-head', h('h2', { id }, title, opts.count != null ? h('span.count', ` (${opts.count})`) : null), opts.action || null), ...children);
}
