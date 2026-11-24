// Neutral default configuration. Everything here is editable seed data, not business logic:
// work days, locations, hours, phone-duty coverage, the daily template, targets and the
// closing checklist are all changed through Settings. No personal records, no example
// tasks and no formal team meetings are seeded.
import { STATE_FORMAT, SCHEMA_VERSION, TIMEZONE } from './config.js';
import { uid } from './ids.js';

export const DEFAULT_TEMPLATE_ID = 'tpl-default';

export function defaultCategories() {
  return [
    { id: 'inquiries', label: 'פניות', color: '#286C96', roles: ['inquiries', 'followup'], plannerWeight: 2, archived: false },
    { id: 'email', label: 'מייל ומעקבים', color: '#4F86B5', roles: ['email1', 'email2'], plannerWeight: 1, archived: false },
    { id: 'crm', label: 'העברות ל-CRM', color: '#6F8FB8', roles: ['email1', 'email2'], plannerWeight: 1, batchAtEnd: true, archived: false },
    { id: 'team', label: 'צוות ומנהל', color: '#34745D', roles: ['teamReception'], plannerWeight: 1, archived: false },
    { id: 'documents', label: 'מסמכים', color: '#9A620E', roles: ['followup'], plannerWeight: 1, archived: false },
    { id: 'followups', label: 'מעקבים', color: '#B07A3B', roles: ['followup', 'email2'], plannerWeight: 1, archived: false },
    { id: 'planning', label: 'הכנה למחר', color: '#6D5BA8', roles: ['closing'], plannerWeight: 1, archived: false },
    { id: 'admin', label: 'כללי', color: '#526273', roles: ['followup'], plannerWeight: 0, archived: false },
    { id: 'meeting', label: 'פגישות', color: '#A0527A', roles: [], plannerWeight: 0, archived: false },
    { id: 'routine', label: 'שגרה', color: '#7D8FA3', roles: ['opening'], plannerWeight: 0, archived: false },
    { id: 'break', label: 'הפסקה', color: '#C29A6B', roles: ['break'], plannerWeight: 0, archived: false },
  ];
}

export function defaultTemplateBlocks() {
  return [
    {
      role: 'opening', title: 'פתיחת יום', start: '09:00', end: '09:15', categoryId: 'routine', protected: false, flexible: false, minMinutes: 10, anchor: 'start',
      instructions: ['בלי מייל בפתיחת היום', 'בחירת שלוש משימות חיוניות להיום'],
    },
    {
      role: 'inquiries', title: 'מענה לפניות', start: '09:15', end: '12:00', categoryId: 'inquiries', protected: false, flexible: true, minMinutes: 60, anchor: null,
      instructions: ['ביום תורנות: פניות פשוטות בעזרת התשובות הנפוצות המאושרות', 'ביום ללא תורנות: פניות מורכבות שדורשות בירור', 'הטלפון האישי מחוץ להישג יד כשמתאים'],
    },
    {
      role: 'email1', title: 'בלוק מייל ראשון', start: '12:00', end: '13:00', categoryId: 'email', protected: false, flexible: true, minMinutes: 30, anchor: null,
      instructions: ['Outlook, WhatsApp ומעקבים טלפוניים', 'העברות ל-CRM בריכוז לקראת סוף הבלוק'],
    },
    {
      role: 'break', title: 'הפסקה', start: '13:00', end: '14:00', categoryId: 'break', protected: true, flexible: false, minMinutes: 60, anchor: null,
      instructions: [],
    },
    {
      role: 'teamReception', title: 'שעת קבלה לצוות ופגישה עם המנהל', start: '14:00', end: '14:15', categoryId: 'team', protected: false, flexible: false, minMinutes: 15, anchor: null,
      instructions: ['לרכז שאלות מהצוות לחלון הזה', 'נושאים פתוחים למנהל', 'שאלה שחוזרת – להעביר לתשובות הנפוצות'],
    },
    {
      role: 'followup', title: 'השלמת פניות וטיפול במייל', start: '14:15', end: '15:30', categoryId: 'documents', protected: false, flexible: true, minMinutes: 30, anchor: null,
      instructions: ['השלמת יעד הפניות או טיפול במסמכים ובמעקבים', 'תקלת סנכרון שחוזרת – לרשום ביומן התקלות ולהסלים למנהל או ל-IT'],
    },
    {
      role: 'email2', title: 'בלוק מייל שני', start: '15:30', end: '16:00', categoryId: 'email', protected: false, flexible: true, minMinutes: 15, anchor: null,
      instructions: ['השלמת עבודה הקשורה למייל ולמעקבים'],
    },
    {
      role: 'closing', title: 'סגירת יום', start: '16:00', end: '16:30', categoryId: 'planning', protected: false, flexible: false, minMinutes: 15, anchor: 'end',
      instructions: ['הקצאת פניות למחר', 'סקירת עבודה פתוחה', 'רישום מה הושלם היום'],
    },
  ];
}

export function defaultSettings() {
  return {
    locale: 'he-IL',
    timezone: TIMEZONE,
    displayName: 'כרמית',
    theme: 'auto',
    reducedMotion: 'auto',
    defaultTemplateId: DEFAULT_TEMPLATE_ID,
    workHours: { start: '09:00', end: '16:30' },
    phoneDutyWindow: { start: '09:00', end: '12:00' },
    // Index = weekday (0 = Sunday). Location, duty and hours are independent fields.
    weekly: [
      { isWorking: true, location: 'office', phoneDuty: true, workStart: null, workEnd: null },
      { isWorking: true, location: 'office', phoneDuty: true, workStart: null, workEnd: null },
      { isWorking: true, location: 'office', phoneDuty: true, workStart: null, workEnd: null },
      { isWorking: true, location: 'office', phoneDuty: true, workStart: null, workEnd: null },
      { isWorking: true, location: 'home', phoneDuty: true, workStart: null, workEnd: null },
      { isWorking: false, location: null, phoneDuty: false, workStart: null, workEnd: null },
      { isWorking: false, location: null, phoneDuty: false, workStart: null, workEnd: null },
    ],
    categories: defaultCategories(),
    planner: { assumedEstimateMinutes: 30, useAssumedEstimate: true, deadlineSoonDays: 2, clusterDays: 3, clusterCount: 3 },
    closingChecklist: [
      { id: 'allocate', label: 'הקציתי את הפניות למחר' },
      { id: 'open-work', label: 'רשמתי מה נשאר פתוח' },
      { id: 'accomplished', label: 'סימנתי מה הצלחתי היום' },
    ],
    backup: { reminderDays: 7, lastExportAt: null, lastExportKind: null },
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
    showGuidance: true,
  };
}

export function defaultTemplates() {
  return [{
    id: DEFAULT_TEMPLATE_ID,
    name: 'יום עבודה רגיל',
    versions: [{ id: 'v1', effectiveFrom: '2000-01-01', nominalStart: '09:00', nominalEnd: '16:30', blocks: defaultTemplateBlocks() }],
  }];
}

/** A complete, valid, empty state document. */
export function createInitialState(nowIso) {
  return {
    metadata: {
      product: 'luma', format: STATE_FORMAT, schemaVersion: SCHEMA_VERSION, revision: 0,
      createdAt: nowIso, updatedAt: nowIso, deviceId: uid(),
    },
    settings: defaultSettings(),
    dayTemplates: defaultTemplates(),
    weekOverrides: {},
    dayOverrides: {},
    calendarBlocks: [],
    occurrenceOverrides: {},
    blockCompletions: {},
    tasks: [],
    recurringRules: [],
    dailyPriorities: {},
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
