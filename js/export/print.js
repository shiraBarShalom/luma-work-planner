// Browser print layouts (print-to-PDF via the browser; no native PDF is promised).
import { h } from '../ui.js';

/** Render `content` into a dedicated print root, open the print dialog, then clean up. */
export function printContent(title, content) {
  document.querySelector('.print-root')?.remove();
  const root = h('div.print-root', { dir: 'rtl', lang: 'he' }, h('h1', title), content);
  document.body.append(root);
  document.body.classList.add('printing');
  const cleanup = () => { document.body.classList.remove('printing'); root.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => { try { window.print(); } finally { setTimeout(cleanup, 1000); } }, 50);
}

/** Text with line breaks → paragraphs for printing. */
export const textBlock = (text) => h('div', String(text).split('\n').map((l) => (l.trim() ? h('p', l) : h('br'))));
