// Generates the versioned ChatGPT instructions for producing a `luma-work-plan` v1 JSON.
// Context comes only from non-sensitive settings (work calendar, template roles, category
// IDs, timezone, target dates). No tasks, notes, questions or history are included.
import { PLAN_FORMAT, PLAN_SCHEMA_VERSION, PROMPT_VERSION, TIMEZONE, LIMITS } from '../config.js';
import { addDays, weekStart, DAY_NAMES, fmtLong } from '../dates.js';
import { TEMPLATE_ROLES, PRIORITIES, LOCATIONS, QUESTION_AUDIENCES, QUESTION_DIRECTIONS, MEETING_TYPES } from './schema.js';
import { PLAN_FIELDS } from './importPlan.js';
import { effectiveDay, routineBlocks, templateVersionFor } from '../engine/dayTemplates.js';
import { effectiveTarget } from '../engine/inquiries.js';

const LOC_HE = { office: 'משרד', home: 'בית', other: 'אחר' };

/**
 * @param {Object} state
 * @param {{kind:'weekly'|'dailyPatch', date:string}} opts  date = any day in the target week, or the target day
 */
export function buildPlanningPrompt(state, { kind, date }) {
  const ws = weekStart(date);
  const dates = kind === 'weekly' ? Array.from({ length: 7 }, (_, i) => addDays(ws, i)) : [date];
  const planId = kind === 'weekly' ? `week-${ws}-v1` : `day-${date}-v1`;
  const dayLines = dates.map((d) => {
    const e = effectiveDay(state, d);
    if (!e.isWorking) return `- ${d} (${DAY_NAMES[e.weekday]}): לא יום עבודה`;
    return `- ${d} (${DAY_NAMES[e.weekday]}): יום עבודה, ${LOC_HE[e.location] || e.location}, ${e.workStart}–${e.workEnd}, ` +
      `${e.phoneDuty ? `תורנות טלפון ${e.phoneStart}–${e.phoneEnd}` : 'ללא תורנות טלפון'}, יעד פניות ${effectiveTarget(state, d).target}, ` +
      `בלוקים קבועים: ${routineBlocks(state, d).blocks.length}`;
  });
  const ver = templateVersionFor(state, state.settings.defaultTemplateId, dates[0]);
  const roleLines = (ver?.blocks || []).filter((b) => TEMPLATE_ROLES.includes(b.role)).map((b) => `- ${b.role}: ${b.start}–${b.end} ${b.title}${b.protected ? ' (מוגן)' : ''}`);
  const catLines = state.settings.categories.filter((c) => !c.archived).map((c) => `- ${c.id}: ${c.label}`);
  const tplLines = state.dayTemplates.map((t) => `- ${t.id}: ${t.name}`);
  const fieldLines = ['days', 'blocks', 'meetings', 'tasks', 'questions'].map((c) =>
    `- ${c}: חובה ${PLAN_FIELDS[c].required.join(', ')}; רשות ${PLAN_FIELDS[c].optional.join(', ')}`);

  const skeleton = {
    format: PLAN_FORMAT,
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind,
    planId,
    ...(kind === 'weekly' ? { weekStart: ws } : {}),
    days: [],
    blocks: [],
    meetings: [],
    tasks: [],
    questions: [],
  };

  return [
    `# הנחיות לתכנון עבודה עבור Luma (גרסת הנחיות ${PROMPT_VERSION}, פורמט ${PLAN_FORMAT} v${PLAN_SCHEMA_VERSION})`,
    '',
    'את/ה עוזר/ת תכנון. אתאר בשפה חופשית (בהקלדה או בהכתבה) את ' + (kind === 'weekly' ? `השבוע שמתחיל ב־${fmtLong(ws)}` : `היום ${fmtLong(date)}`) + '.',
    'המטרה: להחזיר קובץ JSON אחד בלבד שאפשר לייבא לאפליקציה. האפליקציה תציג תצוגה מקדימה ואני אאשר כל שינוי.',
    '',
    '## כללים מחייבים',
    '1. להחזיר JSON תקין בלבד, בלי טקסט לפני או אחרי, בלי הערות ובלי Markdown מסביב.',
    '2. לא להמציא מידע: אסור להמציא משכים, מועדי יעד, תורנויות, כותרות, עדיפויות או שעות שלא נאמרו. ערך לא ידוע – להשמיט את השדה (או null היכן שמותר).',
    '3. null פירושו "לא ידוע" – לעולם לא מחיקה ולא אפס.',
    '4. אין בתוכנית פעולות מחיקה, סטטוסים של "הושלם", ספירות פניות או תוצאות היסטוריות. רק תכנון של מה שעוד לא קרה.',
    '5. תאריכים בפורמט YYYY-MM-DD ושעות HH:MM לפי שעון קיר ב־' + TIMEZONE + '. השבוע מתחיל ביום ראשון.',
    '6. תאריכים יחסיים ("מחר", "ביום שלישי") יש לפענח לפי ההקשר שלמטה. אם לא ברור – לשאול אותי לפני יצירת ה־JSON.',
    kind === 'weekly' ? `7. כל ימים, בלוקים, פגישות ותאריכי ביצוע של משימות חייבים להיות בין ${ws} ל־${addDays(ws, 6)}. מועדי יעד ומעקבים יכולים להיות גם אחרי השבוע.` : `7. התוכנית מתייחסת ליום ${date}. מועדי יעד ומעקבים יכולים להיות בתאריכים אחרים.`,
    '8. לכל פריט externalId ייחודי וקבוע (אותיות לטיניות, ספרות, נקודה, מקף, נקודתיים). אם אבקש תיקון – לשמור על אותם externalId ועל אותו planId ולשנות רק את התוכן.',
    '9. פגישה עם שעת התחלה חייבת end או durationMinutes; אם המשך לא נאמר – להשמיט את שתיהן (האפליקציה תבקש ממני להשלים). פגישה בלי מועד ידוע – בלי date ו־start.',
    '10. אם גם end וגם durationMinutes מופיעים, הם חייבים להתאים.',
    '11. עבודה בלי שעה מוגדרת – כמשימה (tasks) ולא כבלוק.',
    '12. לא לכלול פרטים מזהים של פונים, מספרי תיקים, תוכן מיילים או מסמכים, או מידע סודי. רק תיאורים כלליים של עבודה.',
    '13. לא ליצור ישיבות צוות קבועות מראש. פגישה נכנסת רק אם אמרתי שהיא נקבעה.',
    `14. עד ${LIMITS.planItems} פריטים בסך הכול.`,
    '',
    '## מבנה הקובץ',
    `- format: "${PLAN_FORMAT}", schemaVersion: ${PLAN_SCHEMA_VERSION}, kind: "weekly" או "dailyPatch", planId (מומלץ: "${planId}")` + (kind === 'weekly' ? `, weekStart: "${ws}"` : ''),
    ...fieldLines,
    '',
    '## ערכים מותרים',
    `- location: ${LOCATIONS.join(' / ')}`,
    `- priority: ${PRIORITIES.join(' / ')}`,
    `- meetingType: ${MEETING_TYPES.join(' / ')}`,
    `- audience: ${QUESTION_AUDIENCES.join(' / ')} ; direction: ${QUESTION_DIRECTIONS.join(' / ')}`,
    `- role / preferredRole (תפקידי בלוקים בתבנית): ${TEMPLATE_ROLES.join(' / ')}`,
    '- taskRefs (בבלוק) מפנה ל־externalId של משימות באותה תוכנית; agendaRefs (בפגישה) ל־externalId של שאלות; meetingRef (בשאלה) ל־externalId של פגישה.',
    '- subtasks: מערך של כותרות טקסט.',
    '- days משנה רק את מה שצוין: isWorking, location, phoneDuty, phoneStart, phoneEnd, workStart, workEnd, inquiryTarget, templateId.',
    '',
    '## קטגוריות (categoryId)',
    ...catLines,
    '',
    '## תבניות יום (templateId)',
    ...tplLines,
    '',
    '## תבנית היום הרגילה (לפי role)',
    ...roleLines,
    '',
    '## הקשר התכנון' + (kind === 'weekly' ? ` – שבוע ${ws}` : ` – ${date}`),
    ...dayLines,
    '',
    '## שלד להתחלה',
    '```json',
    JSON.stringify(skeleton, null, 2),
    '```',
    '',
    'עכשיו אתאר את התוכנית. אם חסר מידע חיוני – לשאול אותי בקצרה. בסוף להחזיר רק את ה־JSON.',
  ].join('\n');
}
