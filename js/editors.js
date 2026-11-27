// The two editors used everywhere in the app (activity and task) plus quick add.
// All writes go through store commands via run().
import { h, btn, openSheet, field, input, textarea, select, seg, dayPicker, choose, confirmDialog, dateInput, timeInput, setChildren } from './ui.js';
import { S, run, nowCtx } from './app.js';
import { toMin, fromMin, weekday, isValidDate, isValidTime } from './dates.js';
import { PRIORITY_LABEL } from './data/schema.js';
import { findOccurrence } from './engine/schedule.js';
import { recurrenceLabel } from './engine/recurrence.js';

const formError = () => h('p.form-error', { role: 'alert', 'aria-live': 'assertive' });

// ---------------- recurrence ----------------
const REPEAT_OPTIONS = [
  { value: 'none', label: 'ללא חזרה' },
  { value: 'daily', label: 'כל יום' },
  { value: 'workday', label: 'בכל יום עבודה' },
  { value: 'weekly', label: 'כל שבוע' },
  { value: 'custom', label: 'חזרה מותאמת אישית' },
];

/** Map a stored recurrence to an editor choice. Rules the editor cannot express stay as 'keep'. */
function repeatChoice(r, date) {
  if (!r) return { choice: 'none', days: [weekday(date)] };
  const interval = r.interval || 1;
  if (r.kind === 'daily' && interval === 1) return { choice: r.workdaysOnly ? 'workday' : 'daily', days: [weekday(date)] };
  if (r.kind === 'dayType' && r.dayType === 'workday') return { choice: 'workday', days: [weekday(date)] };
  if (r.kind === 'weekly' && interval === 1) {
    const days = [...(r.weekdays || [])].sort();
    if (days.length === 1 && days[0] === weekday(date)) return { choice: 'weekly', days };
    return { choice: 'custom', days };
  }
  return { choice: 'keep', days: [weekday(date)], label: recurrenceLabel(r) };
}

/** Recurrence control: a select, plus weekday buttons only for the custom option. */
function repeatField(current, dateOf) {
  const init = repeatChoice(current, dateOf());
  const options = init.choice === 'keep' ? [{ value: 'keep', label: init.label }, ...REPEAT_OPTIONS] : REPEAT_OPTIONS;
  const sel = select(options, init.choice);
  const days = dayPicker(init.days);
  const extra = h('div');
  const draw = () => setChildren(extra, sel.value === 'custom' ? field('ימים', days) : null);
  sel.addEventListener('change', draw);
  draw();
  const wrap = h('div.stack', field('חזרה', sel), extra);
  /** @returns {undefined|null|Object} undefined = unchanged, null = no repeat */
  wrap.read = () => {
    const v = sel.value;
    if (v === 'keep') return undefined;
    if (v === 'none') return null;
    if (v === 'daily') return { kind: 'daily', interval: 1 };
    if (v === 'workday') return { kind: 'dayType', dayType: 'workday' };
    if (v === 'weekly') return { kind: 'weekly', interval: 1, weekdays: [weekday(dateOf())] };
    return { kind: 'weekly', interval: 1, weekdays: days.value.length ? days.value : [weekday(dateOf())] };
  };
  wrap.changedFrom = (orig) => {
    const v = sel.value;
    if (v === 'keep') return false;
    const now = repeatChoice(wrap.read() ? { ...wrap.read(), startDate: dateOf() } : null, dateOf());
    const before = repeatChoice(orig, dateOf());
    return now.choice !== before.choice || (now.choice === 'custom' && now.days.join() !== before.days.join());
  };
  return wrap;
}

// ---------------- activity ----------------
/**
 * Add an activity, or edit an existing occurrence. The same short form everywhere:
 * title, date, start, end, notes, recurrence.
 */
export function openBlockEditor(occId = null, { date = nowCtx().date, start = null } = {}) {
  const state = S();
  const o = occId ? findOccurrence(state, occId) : null;
  const isNew = !o;
  const s0 = start ?? 9 * 60;
  const title = input('text', o?.title || '', { maxlength: 300, required: true, autofocus: isNew, autocomplete: 'off', enterkeyhint: 'done' });
  const d = dateInput(o?.date || date, { label: 'תאריך' });
  const st = timeInput(o?.start || fromMin(s0));
  const en = timeInput(o?.end || fromMin(Math.min(s0 + 60, 23 * 60 + 59)));
  const notes = textarea(o?.notes || '', { maxlength: 5000, rows: 2 });
  const series = o?.kind === 'series' ? state.calendarBlocks.find((b) => b.id === o.sourceId) : null;
  const rec = o?.kind === 'routine' ? null : repeatField(series ? series.recurrence : null, () => d.value || date);
  const err = formError();
  const body = [field('כותרת', title), field('תאריך', d), h('div.grid2', field('התחלה', st), field('סיום', en)), field('הערות', notes), rec, err];

  const save = async () => {
    err.textContent = '';
    if (!title.value.trim()) { err.textContent = 'יש להזין כותרת'; title.focus(); return; }
    if (!isValidDate(d.value)) { err.textContent = 'יש לבחור תאריך'; return; }
    if (!isValidTime(st.value) || !isValidTime(en.value) || toMin(en.value) <= toMin(st.value)) { err.textContent = 'שעת הסיום חייבת להיות אחרי שעת ההתחלה'; return; }
    if (isNew) {
      const recurrence = rec.read() ?? null;
      if (await run('addBlock', { date: d.value, start: st.value, end: en.value, title: title.value, notes: notes.value, recurrence }, { success: 'הפעילות נוספה' })) sh.close(true);
      return;
    }
    const changes = {};
    if (title.value.trim() !== o.title) changes.title = title.value;
    if (st.value !== o.start) changes.start = st.value;
    if (en.value !== o.end) changes.end = en.value;
    if (notes.value.trim() !== (o.notes || '')) changes.notes = notes.value;
    if (d.value !== o.date) changes.date = d.value;
    const recChanged = rec ? rec.changedFrom(series ? series.recurrence : null) : false;
    if (!Object.keys(changes).length && !recChanged) { sh.close(true); return; }
    const payload = { occId: o.id, changes };
    if (recChanged) payload.recurrence = rec.read();
    if (o.kind === 'series') {
      if (recChanged && changes.date) { err.textContent = 'אפשר לשנות תאריך או חזרה - כל אחד בנפרד'; return; }
      if (changes.date) payload.scope = 'this';
      else if (recChanged) payload.scope = 'future';
      else {
        const scope = await choose('לשנות את הפעילות החוזרת', [
          { value: 'this', label: 'רק הפעם' },
          { value: 'future', label: 'גם בפעמים הבאות' },
        ]);
        if (!scope) return;
        payload.scope = scope;
      }
    }
    if (await run('updateOccurrence', payload, { success: 'הפעילות עודכנה' })) sh.close(true);
  };
  const remove = async () => {
    let scope = 'this';
    if (o.kind === 'series') {
      scope = await choose('מחיקת פעילות חוזרת', [{ value: 'this', label: 'רק הפעם' }, { value: 'future', label: 'מהפעם הזו והלאה', danger: true }]);
      if (!scope) return;
    }
    if (scope === 'future' && !(await confirmDialog(`למחוק את ״${o.title}״ מהיום הזה והלאה?`, { danger: true, ok: 'מחיקה', title: 'מחיקת פעילות' }))) return;
    if (await run('deleteOccurrence', { occId: o.id, scope }, { success: 'הפעילות נמחקה' })) sh.close(true);
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const sh = openSheet({
    title: isNew ? 'הוספת פעילות' : 'עריכת פעילות',
    body,
    footer: [o ? btn('מחיקה', remove, 'ghost danger-text') : null, btn(isNew ? 'הוספה' : 'שמירה', save, 'primary')],
  });
  return sh;
}

// ---------------- task ----------------
const PRIORITY_OPTIONS = ['high', 'medium', 'low'].map((p) => ({ value: p, label: PRIORITY_LABEL[p] }));

/** Add or edit a task: description, priority, execution date, optional deadline and note. */
export function openTaskEditor(task = null, { date = nowCtx().date, defaults = {}, onSaved } = {}) {
  const isNew = !task;
  const src = task || defaults;
  const title = input('text', src.title || '', { maxlength: 300, autocomplete: 'off', required: true, autofocus: isNew, 'aria-required': 'true', enterkeyhint: 'done' });
  const priority = seg(PRIORITY_OPTIONS, src.priority || 'medium', null, 'עדיפות');
  const scheduled = dateInput(isNew ? (src.scheduledDate ?? date) : (task.status === 'deferred' ? task.resumeOn : task.scheduledDate) || '', { label: 'תאריך ביצוע', short: true, clearable: !isNew && !task.scheduledDate });
  const deadline = dateInput(src.deadline || '', { label: 'מועד יעד', short: true, clearable: true, placeholder: 'ללא' });
  const note = textarea(src.details || '', { maxlength: 5000, rows: 2 });
  const err = formError();

  const save = async () => {
    err.textContent = '';
    if (!title.value.trim()) { err.textContent = 'יש להזין תיאור למשימה'; title.setAttribute('aria-invalid', 'true'); title.focus(); return; }
    if (isNew && !isValidDate(scheduled.value)) { err.textContent = 'יש לבחור תאריך ביצוע'; return; }
    const payload = { title: title.value, priority: priority.value, scheduledDate: scheduled.value || null, deadline: deadline.value || null, details: note.value };
    let res;
    if (isNew) res = await run('addTask', { ...payload, priorityFor: defaults.priorityFor }, { success: 'המשימה נוספה' });
    else {
      const patch = { ...payload };
      const currentDue = task.status === 'deferred' ? task.resumeOn : task.scheduledDate;
      if ((patch.scheduledDate || null) === (currentDue || null)) delete patch.scheduledDate;
      res = await run('updateTask', { id: task.id, patch }, { success: 'המשימה עודכנה' });
    }
    if (res) { sh.close(true); onSaved && onSaved(res); }
  };
  const remove = async () => {
    if (await run('deleteTask', { id: task.id }, { success: 'המשימה נמחקה' })) sh.close(true);
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
  const sh = openSheet({
    title: isNew ? 'הוספת משימה' : 'עריכת משימה',
    body: [field('תיאור המשימה', title), field('עדיפות', priority), h('div.grid2', field('תאריך ביצוע', scheduled), field('מועד יעד', deadline)), field('הערה', note), err],
    footer: [!isNew && !task.virtual && !task.recurringRuleId ? btn('מחיקה', remove, 'ghost danger-text') : null, btn(isNew ? 'הוספה' : 'שמירה', save, 'primary')],
  });
  return sh;
}

/** Quick add from the header: a task or an activity. */
export async function quickAdd(date = nowCtx().date) {
  const v = await choose('הוספה', [
    { value: 'task', label: 'הוספת משימה', icon: 'squareCheck' },
    { value: 'block', label: 'הוספת פעילות', icon: 'calendar' },
  ]);
  if (v === 'task') openTaskEditor(null, { date });
  if (v === 'block') openBlockEditor(null, { date });
}
