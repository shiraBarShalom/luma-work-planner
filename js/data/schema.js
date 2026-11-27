// Canonical enumerations and Hebrew display labels for the Luma state document.
// The document is validated by data/validation.js; keep these enums aligned with
// schemas/*.json and the import contract. Collections and enums of retired features
// (questions, meetings, FAQ, issues, notes, day reports, count events, routine templates)
// are kept so existing data and backups stay valid.

export const COLLECTIONS = [
  'settings', 'dayTemplates', 'weekOverrides', 'dayOverrides', 'calendarBlocks', 'occurrenceOverrides',
  'blockCompletions', 'tasks', 'recurringRules', 'dailyPriorities', 'inquiryCounts', 'inquiryLogs', 'targetHistory',
  'questions', 'meetings', 'meetingDecisions', 'faqEntries', 'issueLogs', 'workNotes', 'dailyReports',
  'importHistory', 'alertDismissals', 'dayNotes',
];

export const TASK_STATUSES = ['todo', 'inProgress', 'waiting', 'deferred', 'done', 'canceled'];
export const PRIORITIES = ['high', 'medium', 'low'];
export const PRIORITY_LABEL = { high: 'גבוהה', medium: 'בינונית', low: 'נמוכה' };
export const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export const BLOCK_STATUSES = ['planned', 'done', 'partial', 'skipped', 'canceled'];
export const BLOCK_STATUS_LABEL = { planned: 'מתוכנן', done: 'הושלם', partial: 'הושלם חלקית', skipped: 'דולג', canceled: 'בוטל' };

// Legacy (v1) enums: still validated in stored data and accepted in v1 plan files.
export const LOCATIONS = ['office', 'home', 'other'];
export const TEMPLATE_ROLES = ['opening', 'inquiries', 'email1', 'break', 'teamReception', 'followup', 'email2', 'closing'];
export const INQUIRY_KINDS = ['completed', 'allocatedTomorrow', 'transferred', 'other'];
export const INQUIRY_CATEGORIES = ['simple', 'complex', 'unspecified'];
export const QUESTION_AUDIENCES = ['team', 'manager'];
export const QUESTION_DIRECTIONS = ['incoming', 'outgoing'];
export const QUESTION_KINDS = ['question', 'topic'];
export const QUESTION_STATUSES = ['open', 'waiting', 'answered', 'archived'];
export const MEETING_TYPES = ['team', 'manager', 'other'];
export const MEETING_STATUSES = ['planned', 'held', 'canceled'];
export const ISSUE_STATUSES = ['open', 'reported', 'resolved'];
export const REPORTED_TO = ['manager', 'it'];
export const CARRYOVER_POLICIES = ['none', 'latest', 'all'];
