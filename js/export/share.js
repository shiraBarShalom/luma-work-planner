// Share / download / copy with honest outcomes: success is reported only after the
// browser action resolves (share) or the file has been handed to the browser (download).
import { toast, openSheet, h, btn, textarea } from '../ui.js';

export function safeFileName(name) {
  return String(name).replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-').replace(/\s+/g, '-').slice(0, 120) || 'luma-export';
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      toast('הועתק ללוח');
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    ta.remove();
    if (ok) { toast('הועתק ללוח'); return true; }
  } catch { /* fall through */ }
  // Manual fallback: show the text selected for the user to copy.
  const area = textarea(text, { rows: 10, readonly: true, 'aria-label': 'טקסט להעתקה' });
  const sh = openSheet({ title: 'העתקה ידנית', body: [h('p.muted.small', 'ההעתקה האוטומטית לא זמינה בדפדפן הזה. אפשר לסמן ולהעתיק ידנית.'), area], footer: [btn('סגירה', () => sh.close(), 'primary')] });
  setTimeout(() => { area.focus(); area.select(); }, 60);
  return false;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFileName(filename);
  a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

/**
 * Share files if the browser supports file sharing; otherwise download.
 * @returns {Promise<'shared'|'downloaded'|'canceled'|'failed'>}
 */
export async function shareOrDownload(files, { title = 'Luma', text = '' } = {}) {
  const list = files.map((f) => new File([f.blob], safeFileName(f.name), { type: f.blob.type }));
  try {
    if (navigator.canShare && navigator.share && navigator.canShare({ files: list })) {
      await navigator.share({ files: list, title, text });
      toast('השיתוף הושלם');
      return 'shared';
    }
  } catch (e) {
    if (e && e.name === 'AbortError') { toast('השיתוף בוטל'); return 'canceled'; }
    // fall back to download
  }
  try {
    for (const f of files) downloadBlob(f.blob, f.name);
    toast(files.length > 1 ? `${files.length} קבצים הוכנו להורדה` : 'הקובץ הוכן להורדה');
    return 'downloaded';
  } catch {
    toast('לא ניתן היה להכין את הקובץ', { error: true });
    return 'failed';
  }
}
