// Generates the versioned ChatGPT instructions for producing a `luma-work-plan` v2 JSON.
// Context: timezone, target dates and the recurring schedule that already exists (titles
// and times of recurring activities only). No tasks, notes, one-off activities or history
// are included.
import { PLAN_FORMAT, PLAN_SCHEMA_VERSION, PROMPT_VERSION, TIMEZONE, LIMITS } from '../config.js';
import { addDays, weekStart, weekday, DAY_NAMES, fmtLong } from '../dates.js';
import { PRIORITIES } from './schema.js';
import { PLAN_FIELDS } from './importPlan.js';
import { dayOccurrences } from '../engine/schedule.js';

/**
 * @param {Object} state
 * @param {{kind:'weekly'|'dailyPatch', date:string}} opts  date = any day in the target week, or the target day
 */
export function buildPlanningPrompt(state, { kind, date }) {
  const ws = weekStart(date);
  const dates = kind === 'weekly' ? Array.from({ length: 7 }, (_, i) => addDays(ws, i)) : [date];
  const planId = kind === 'weekly' ? `week-${ws}-v1` : `day-${date}-v1`;
  const dayLines = dates.map((d) => {
    const fixed = dayOccurrences(state, d).filter((o) => o.recurring && o.status !== 'canceled');
    const name = DAY_NAMES[weekday(d)];
    if (!fixed.length) return `- ${d} (${name}): אין פעילויות קבועות`;
    return `- ${d} (${name}): ${fixed.map((o) => `${o.start}-${o.end} ${o.title}`).join(' · ')}`;
  });
  const fieldLines = ['activities', 'tasks'].map((c) => `- ${c}: חובה ${PLAN_FIELDS[c].required.join(', ')}; רשות ${PLAN_FIELDS[c].optional.join(', ')}`);
  const skeleton = {
    format: PLAN_FORMAT,
    schemaVersion: PLAN_SCHEMA_VERSION,
    kind,
    planId,
    ...(kind === 'weekly' ? { weekStart: ws } : {}),
    activities: [],
    tasks: [],
  };

  return [
    `# הנחיות לתכנון עבודה עבור Luma (גרסת הנחיות ${PROMPT_VERSION}, פורמט ${PLAN_FORMAT} v${PLAN_SCHEMA_VERSION})`,
    '',
    'את/ה עוזר/ת תכנון. אתאר בשפה חופשית (בהקלדה או בהכתבה) את ' + (kind === 'weekly' ? `השבוע שמתחיל ב-${fmtLong(ws)}` : `היום ${fmtLong(date)}`) + '.',
    'המטרה: להחזיר קובץ JSON אחד בלבד שאפשר לייבא לאפליקציה. האפליקציה מציגה תצוגה מקדימה ואני מאשרת כל שינוי.',
    '',
    '## לוח הזמנים הקבוע כבר קיים',
    'באפליקציה כבר מוגדר לוח זמנים קבוע שחוזר בכל שבוע (ראו "הקשר התכנון" למטה). הוא נשמר תמיד כמו שהוא.',
    '- לא ליצור מחדש את הפעילויות הקבועות, לא לבטל, לא להזיז, לא לקצר ולא לשנות אותן.',
    '- להחזיר רק פעילויות נוספות (activities) ומשימות (tasks).',
    '- מותר שפעילות נוספת תחפוף לפעילות קבועה (למשל ישיבה בתוך זמן המענה לטלפונים). לשמור על השעות שאמרתי, בלי להזיז אותן לזמן פנוי.',
    '',
    '## כללים מחייבים',
    '1. להחזיר JSON תקין בלבד, בלי טקסט לפני או אחרי, בלי הערות ובלי Markdown מסביב.',
    '2. לא להמציא מידע: אסור להמציא שעות, משכים, מועדי יעד, כותרות או עדיפויות שלא נאמרו. ערך לא ידוע - להשמיט את השדה.',
    '3. אין בתוכנית מחיקות, סטטוסים של "הושלם", ספירות פניות או תוצאות. רק תכנון של מה שעוד לא קרה.',
    '4. תאריכים בפורמט YYYY-MM-DD ושעות HH:MM לפי שעון קיר ב-' + TIMEZONE + '. השבוע מתחיל ביום ראשון.',
    '5. תאריכים יחסיים ("מחר", "ביום שלישי") יש לפענח לפי ההקשר שלמטה. אם לא ברור - לשאול אותי לפני יצירת ה-JSON.',
    kind === 'weekly' ? `6. כל הפעילויות ותאריכי הביצוע של משימות חייבים להיות בין ${ws} ל-${addDays(ws, 6)}. מועדי יעד יכולים להיות גם אחרי השבוע.` : `6. התוכנית מתייחסת ליום ${date}. מועדי יעד יכולים להיות בתאריכים אחרים.`,
    '7. לכל פריט externalId ייחודי וקבוע (אותיות לטיניות, ספרות, נקודה, מקף, נקודתיים). אם אבקש תיקון - לשמור על אותם externalId ועל אותו planId ולשנות רק את התוכן.',
    '8. פעילות (activities) היא משהו עם שעה ביומן, כמו פגישה. חובה start, ועוד end או durationMinutes. אם המשך לא נאמר - להשמיט את שניהם (האפליקציה תבקש ממני להשלים).',
    '9. אם גם end וגם durationMinutes מופיעים, הם חייבים להתאים.',
    '10. עבודה בלי שעה - כמשימה (tasks), עם scheduledDate (תאריך ביצוע) אם נאמר, ו-deadline (מועד יעד) רק אם נאמר.',
    '11. פעילויות חוזרות אינן נתמכות בייבוא. אם ביקשתי משהו שחוזר - לכתוב לי שאוסיף אותו ידנית באפליקציה.',
    '12. לא לכלול פרטים מזהים של פונים, מספרי תיקים, תוכן מיילים או מסמכים, או מידע סודי. רק תיאורים כלליים.',
    `13. עד ${LIMITS.planItems} פריטים בסך הכול.`,
    '',
    '## מבנה הקובץ',
    `- format: "${PLAN_FORMAT}", schemaVersion: ${PLAN_SCHEMA_VERSION}, kind: "weekly" או "dailyPatch", planId (מומלץ: "${planId}")` + (kind === 'weekly' ? `, weekStart: "${ws}"` : ''),
    ...fieldLines,
    `- priority: ${PRIORITIES.join(' / ')} (high = גבוהה, medium = בינונית, low = נמוכה)`,
    '- notes: הערה קצרה (לא חובה).',
    '',
    '## הקשר התכנון - הפעילויות הקבועות' + (kind === 'weekly' ? ` בשבוע ${ws}` : ` ב-${date}`),
    ...dayLines,
    '',
    '## שלד להתחלה',
    '```json',
    JSON.stringify(skeleton, null, 2),
    '```',
    '',
    'עכשיו אתאר את התוכנית. אם חסר מידע חיוני - לשאול אותי בקצרה. בסוף להחזיר רק את ה-JSON.',
  ].join('\n');
}
