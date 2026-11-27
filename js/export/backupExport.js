// Full-backup export. The export is recorded only once the file was shared or handed to
// the browser for download (never reported as saved before that).
import { S, run, nowCtx } from '../app.js';
import { clock } from '../clock.js';
import { shareOrDownload } from './share.js';
import { createBackup, backupFileName } from '../data/backup.js';

export const PRIVACY_NOTE = 'קובץ הגיבוי אינו מוצפן. לפני שיתוף מחוץ למכשיר כדאי לוודא שאין בו מידע רגיש.';

export async function exportBackup() {
  const text = JSON.stringify(createBackup(S(), clock.iso()), null, 1);
  const r = await shareOrDownload([{ blob: new Blob([text], { type: 'application/json' }), name: backupFileName(nowCtx().date) }], { title: 'גיבוי Luma' });
  if (r === 'shared' || r === 'downloaded') await run('markBackupExported', { kind: r }, { silent: true });
  return r;
}
