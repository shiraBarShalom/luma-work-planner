// Neutral default configuration and the fixed weekly schedule. No personal records, no
// example tasks and no meetings are seeded. The weekly schedule is a set of ordinary
// recurring activities (Sunday-Thursday) with stable IDs, so seeding and migration can
// never create duplicates; recurring activities are automatically protected from
// automated changes (see store.js).
import { STATE_FORMAT, SCHEMA_VERSION, TIMEZONE } from './config.js';
import { uid } from './ids.js';
import { zonedParts } from './dates.js';

export const DEFAULT_TEMPLATE_ID = 'tpl-default';
/** Category used for activities the user adds. Categories are internal (not shown in the UI). */
export const ACTIVITY_CATEGORY = 'activity';
export const SUN_TO_THU = [0, 1, 2, 3, 4];

export function defaultCategories() {
  return [
    { id: ACTIVITY_CATEGORY, label: 'פעילות', color: '#286C96', roles: [], plannerWeight: 0, archived: false },
    { id: 'inquiries', label: 'פניות', color: '#286C96', roles: [], plannerWeight: 0, archived: false },
    { id: 'email', label: 'מייל', color: '#4F86B5', roles: [], plannerWeight: 0, archived: false },
    { id: 'team', label: 'צוות', color: '#34745D', roles: [], plannerWeight: 0, archived: false },
    { id: 'planning', label: 'הכנה למחר', color: '#6D5BA8', roles: [], plannerWeight: 0, archived: false },
    { id: 'admin', label: 'כללי', color: '#526273', roles: [], plannerWeight: 0, archived: false },
    { id: 'meeting', label: 'פגישות', color: '#A0527A', roles: [], plannerWeight: 0, archived: false },
    { id: 'routine', label: 'שגרה', color: '#7D8FA3', roles: [], plannerWeight: 0, archived: false },
    { id: 'break', label: 'הפסקה', color: '#C29A6B', roles: [], plannerWeight: 0, archived: false },
  ];
}

/**
 * The permanent weekly schedule (Sunday-Thursday). `key` is stable and becomes part of
 * the activity ID (`default-<key>`), which makes seeding and migration idempotent.
 */
export const WEEKLY_SCHEDULE = Object.freeze([
  { key: 'opening', start: '08:45', end: '09:00', title: 'פתיחת יום', categoryId: 'routine', notes: 'בלי מייל. בחירת שלושה דברים שחייבים להיגמר היום.' },
  { key: 'phones', start: '09:00', end: '13:00', title: 'מענה לטלפונים ולפניות ב-CRM', categoryId: 'inquiries', notes: '' },
  { key: 'break', start: '13:00', end: '14:00', title: 'הפסקה', categoryId: 'break', notes: '' },
  { key: 'team', start: '14:00', end: '14:15', title: 'זמן קבלה לשאלות של הצוות', categoryId: 'team', notes: '' },
  { key: 'callbacks', start: '14:15', end: '14:30', title: 'חזרה טלפונית לפונים', categoryId: 'inquiries', notes: '' },
  { key: 'email', start: '14:30', end: '15:45', title: 'טיפול במיילים', categoryId: 'email', notes: '' },
  { key: 'allocation', start: '15:45', end: '16:15', title: 'הקצאת פניות לצוות למחר', categoryId: 'planning', notes: '' },
  { key: 'closing', start: '16:15', end: '16:30', title: 'סגירת יום', categoryId: 'planning', notes: 'רשימת מה שנשאר פתוח.' },
]);
export const scheduleBlockId = (key) => `default-${key}`;

/** Recurring calendar blocks for the weekly schedule, starting on `startDate`. */
export function weeklyScheduleBlocks(startDate, nowIso) {
  return WEEKLY_SCHEDULE.map((s) => ({
    id: scheduleBlockId(s.key), date: startDate, start: s.start, end: s.end, title: s.title, categoryId: s.categoryId,
    role: null, notes: s.notes, pinned: false,
    recurrence: { kind: 'weekly', interval: 1, weekdays: [...SUN_TO_THU], startDate, endDate: null, exceptions: [] },
    source: 'default', seedKey: `weekly-schedule:${s.key}`, movedFrom: null, protected: false, flexible: false, minMinutes: 0,
    instructions: [], createdAt: nowIso, updatedAt: nowIso,
  }));
}

export function defaultNotificationSettings() {
  return { activityStart: false, showDetails: false };
}

export function defaultSettings() {
  return {
    locale: 'he-IL',
    timezone: TIMEZONE,
    // No name ships with the app; a name already stored in local data keeps being used.
    displayName: '',
    theme: 'auto',
    reducedMotion: 'auto',
    defaultTemplateId: DEFAULT_TEMPLATE_ID,
    // Internal working-day calendar used for task carryover (Sunday-Thursday). Not shown in the UI.
    workHours: { start: '08:45', end: '16:30' },
    phoneDutyWindow: { start: '09:00', end: '13:00' },
    weekly: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ isWorking: i <= 4, location: i <= 4 ? 'office' : null, phoneDuty: false, workStart: null, workEnd: null })),
    // Legacy routine templates are not generated on or after this date (null = never generated).
    routineEndsOn: null,
    categories: defaultCategories(),
    planner: { assumedEstimateMinutes: 30, useAssumedEstimate: true, deadlineSoonDays: 2, clusterDays: 3, clusterCount: 3 },
    closingChecklist: [{ id: 'open-work', label: 'רשמתי מה נשאר פתוח' }],
    backup: { reminderDays: 7, lastExportAt: null, lastExportKind: null },
    notifications: defaultNotificationSettings(),
    header: {
      useAlternateDawn: false,
      rules: [
        { from: '05:00', to: '08:00', image: 'dawn', greeting: 'בוקר טוב' },
        { from: '08:00', to: '12:00', image: 'day', greeting: 'בוקר טוב' },
        { from: '12:00', to: '17:00', image: 'day', greeting: 'צהריים טובים' },
        { from: '17:00', to: '20:00', image: 'sunset', greeting: 'ערב טוב' },
        { from: '20:00', to: '05:00', image: 'night', greeting: 'לילה טוב' },
      ],
    },
    taskTemplates: [],
    showGuidance: false,
  };
}

/** An empty routine template (kept for document compatibility; the schedule lives in calendarBlocks). */
export function defaultTemplates() {
  return [{
    id: DEFAULT_TEMPLATE_ID,
    name: 'יום עבודה רגיל',
    versions: [{ id: 'v1', effectiveFrom: '2000-01-01', nominalStart: '08:45', nominalEnd: '16:30', blocks: [] }],
  }];
}

/** A complete, valid state document with the weekly schedule starting today. */
export function createInitialState(nowIso) {
  const today = zonedParts(new Date(nowIso)).date;
  return {
    metadata: {
      product: 'luma', format: STATE_FORMAT, schemaVersion: SCHEMA_VERSION, revision: 0,
      createdAt: nowIso, updatedAt: nowIso, deviceId: uid(),
    },
    settings: defaultSettings(),
    dayTemplates: defaultTemplates(),
    weekOverrides: {},
    dayOverrides: {},
    calendarBlocks: weeklyScheduleBlocks(today, nowIso),
    occurrenceOverrides: {},
    blockCompletions: {},
    tasks: [],
    recurringRules: [],
    dailyPriorities: {},
    inquiryCounts: {},
    inquiryLogs: [],
    targetHistory: { defaults: [{ effectiveFrom: '2000-01-01', target: 10, setAt: nowIso }] },
    questions: [],
    meetings: [],
    meetingDecisions: [],
    faqEntries: [],
    issueLogs: [],
    workNotes: [],
    dailyReports: {},
    importHistory: [],
    alertDismissals: {},
    dayNotes: {},
  };
}
