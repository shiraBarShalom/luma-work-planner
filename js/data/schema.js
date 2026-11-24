// Canonical enumerations and Hebrew display labels for the Luma state document.
// The state document shape is documented in README ("Data model") and validated by
// data/validation.js. Keep these enums aligned with schemas/*.json and prompts/.

export const COLLECTIONS = [
  'settings', 'dayTemplates', 'weekOverrides', 'dayOverrides', 'calendarBlocks', 'occurrenceOverrides',
  'blockCompletions', 'tasks', 'recurringRules', 'dailyPriorities', 'inquiryLogs', 'targetHistory',
  'questions', 'meetings', 'meetingDecisions', 'faqEntries', 'issueLogs', 'workNotes', 'dailyReports',
  'importHistory', 'alertDismissals', 'dayNotes',
];

export const TASK_STATUSES = ['todo', 'inProgress', 'waiting', 'deferred', 'done', 'canceled'];
export const TASK_STATUS_LABEL = {
  todo: 'לביצוע', inProgress: 'בתהליך', waiting: 'ממתינה', deferred: 'נדחתה', done: 'הושלמה', canceled: 'בוטלה',
};
export const PRIORITIES = ['high', 'medium', 'low'];
export const PRIORITY_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const LOCATIONS = ['office', 'home', 'other'];
export const LOCATION_LABEL = { office: 'במשרד', home: 'מהבית', other: 'מיקום אחר' };

export const BLOCK_STATUSES = ['planned', 'done', 'partial', 'skipped', 'canceled'];
export const BLOCK_STATUS_LABEL = { planned: 'מתוכנן', done: 'הושלם', partial: 'הושלם חלקית', skipped: 'דולג', canceled: 'בוטל' };

export const TEMPLATE_ROLES = ['opening', 'inquiries', 'email1', 'break', 'teamReception', 'followup', 'email2', 'closing'];
export const ROLE_LABEL = {
  opening: 'פתיחת יום', inquiries: 'מענה לפניות', email1: 'בלוק מייל ראשון', break: 'הפסקה',
  teamReception: 'שעת קבלה לצוות ופגישה עם המנהל', followup: 'השלמת פניות וטיפול במייל', email2: 'בלוק מייל שני', closing: 'סגירת יום',
};

export const INQUIRY_KINDS = ['completed', 'allocatedTomorrow', 'transferred', 'other'];
export const INQUIRY_KIND_LABEL = {
  completed: 'פניות שטופלו', allocatedTomorrow: 'הוקצו למחר', transferred: 'הועברו / הוסלמו', other: 'טיפול אחר',
};
export const INQUIRY_CATEGORIES = ['simple', 'complex', 'unspecified'];
export const INQUIRY_CATEGORY_LABEL = { simple: 'פשוטה', complex: 'מורכבת', unspecified: 'ללא סיווג' };

export const QUESTION_AUDIENCES = ['team', 'manager'];
export const AUDIENCE_LABEL = { team: 'צוות', manager: 'מנהל' };
export const QUESTION_DIRECTIONS = ['incoming', 'outgoing'];
export const DIRECTION_LABEL = { incoming: 'שאלה שהתקבלה', outgoing: 'שאלה שלי' };
export const QUESTION_KINDS = ['question', 'topic'];
export const QUESTION_KIND_LABEL = { question: 'שאלה', topic: 'נושא לדיון' };
export const QUESTION_STATUSES = ['open', 'waiting', 'answered', 'archived'];
export const QUESTION_STATUS_LABEL = { open: 'פתוחה', waiting: 'בטיפול', answered: 'נענתה', archived: 'בארכיון' };

export const MEETING_TYPES = ['team', 'manager', 'other'];
export const MEETING_TYPE_LABEL = { team: 'ישיבת צוות', manager: 'פגישה עם המנהל', other: 'פגישה אחרת' };
export const MEETING_STATUSES = ['planned', 'held', 'canceled'];
export const MEETING_STATUS_LABEL = { planned: 'מתוכננת', held: 'התקיימה', canceled: 'בוטלה' };

export const ISSUE_STATUSES = ['open', 'reported', 'resolved'];
export const ISSUE_STATUS_LABEL = { open: 'פתוחה', reported: 'דווחה', resolved: 'נפתרה' };
export const REPORTED_TO = ['manager', 'it'];
export const REPORTED_TO_LABEL = { manager: 'מנהל', it: 'IT / תמיכה' };

export const RECURRENCE_KINDS = ['daily', 'weekly', 'monthly', 'dayType'];
export const RECURRENCE_LABEL = { daily: 'יומי', weekly: 'שבועי / כל כמה שבועות', monthly: 'חודשי', dayType: 'לפי סוג יום' };
export const DAY_TYPES = ['workday', 'office', 'home', 'phoneDuty', 'nonWorking'];
export const DAY_TYPE_LABEL = { workday: 'כל יום עבודה', office: 'ימי משרד', home: 'ימי עבודה מהבית', phoneDuty: 'ימי תורנות טלפון', nonWorking: 'ימים שאינם ימי עבודה' };
export const MONTH_OVERFLOW = ['skip', 'lastDay'];
export const CARRYOVER_POLICIES = ['none', 'latest', 'all'];
export const CARRYOVER_LABEL = {
  none: 'שגרה – ללא העברה', latest: 'להעביר רק את המופע האחרון שלא בוצע', all: 'להעביר כל מופע שלא בוצע',
};

export const EDIT_SCOPES = ['this', 'week', 'future', 'all'];
