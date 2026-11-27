// Synthetic schema-v1 document (as written by Luma 1.x). Fictional data only.
import { createInitialState } from '../js/seed.js';

const V1_TEMPLATE_BLOCKS = [
  ['opening', '09:00', '09:15', 'פתיחת יום', 'routine'],
  ['inquiries', '09:15', '12:00', 'מענה לפניות', 'inquiries'],
  ['email1', '12:00', '13:00', 'בלוק מייל ראשון', 'email'],
  ['break', '13:00', '14:00', 'הפסקה', 'break'],
  ['teamReception', '14:00', '14:15', 'שעת קבלה לצוות', 'team'],
  ['followup', '14:15', '15:30', 'השלמת פניות', 'admin'],
  ['email2', '15:30', '16:00', 'בלוק מייל שני', 'email'],
  ['closing', '16:00', '16:30', 'סגירת יום', 'planning'],
].map(([role, start, end, title, categoryId]) => ({ role, start, end, title, categoryId, protected: role === 'break', flexible: false, minMinutes: 0, anchor: null, instructions: [] }));

/** A v1 document with history: routine completions, count events, a meeting, a question and a task. */
export function v1Document() {
  const s = createInitialState('2026-11-20T08:00:00.000Z');
  s.metadata.schemaVersion = 1;
  s.metadata.revision = 41;
  delete s.inquiryCounts;
  delete s.settings.routineEndsOn;
  delete s.settings.notifications;
  s.settings.categories = s.settings.categories.filter((c) => c.id !== 'activity');
  s.settings.weekly[1].phoneDuty = true;
  s.calendarBlocks = [];
  s.dayTemplates[0].versions[0].blocks = V1_TEMPLATE_BLOCKS;
  s.blockCompletions['r:tpl-default:opening@2026-11-24'] = { status: 'done', actualMinutes: null, updatedAt: '2026-11-24T07:20:00.000Z' };
  s.inquiryLogs = [
    { id: 'ev1', workDate: '2026-11-24', kind: 'completed', category: 'simple', quantity: 3, correctsId: null, at: '2026-11-24T08:00:00.000Z' },
    { id: 'ev2', workDate: '2026-11-24', kind: 'completed', category: 'complex', quantity: 2, correctsId: null, at: '2026-11-24T09:00:00.000Z' },
    { id: 'ev3', workDate: '2026-11-24', kind: 'completed', category: 'simple', quantity: -1, correctsId: 'ev1', at: '2026-11-24T09:05:00.000Z' },
    { id: 'ev4', workDate: '2026-11-24', kind: 'allocatedTomorrow', category: 'unspecified', quantity: 4, correctsId: null, at: '2026-11-24T14:00:00.000Z' },
  ];
  s.questions = [{ id: 'q1', kind: 'question', audience: 'team', direction: 'incoming', title: 'שאלה כללית לדוגמה', detail: '', priority: 'medium', categoryId: null, status: 'open', answer: '', answeredOn: null, recurring: false, followUpOn: null, faqId: null, createdDate: '2026-11-23', createdAt: '2026-11-23T08:00:00.000Z', updatedAt: '2026-11-23T08:00:00.000Z' }];
  s.meetings = [
    { id: 'm1', title: 'ישיבת צוות לדוגמה', meetingType: 'team', date: '2026-12-01', start: '10:30', end: null, durationMinutes: 30, location: '', notes: '', agenda: ['q1'], status: 'planned', createdAt: '2026-11-23T08:00:00.000Z', updatedAt: '2026-11-23T08:00:00.000Z' },
    { id: 'm2', title: 'פגישה בלי מועד', meetingType: 'manager', date: null, start: null, end: null, durationMinutes: null, location: '', notes: '', agenda: [], status: 'planned', createdAt: '2026-11-23T08:00:00.000Z', updatedAt: '2026-11-23T08:00:00.000Z' },
  ];
  s.tasks = [{
    id: 't1', title: 'משימה ישנה', details: 'פרטים', categoryId: 'admin', priority: 'high', status: 'todo', originalScheduledDate: '2026-11-24', scheduledDate: '2026-11-24', deadline: null,
    estimateMinutes: 45, actualMinutes: null, subtasks: [{ id: 's1', title: 'תת-משימה', done: false }], recurringRuleId: null, occurrenceDate: null, assignedBlock: 'mtg:m1', assignmentManual: true, pinned: false,
    preferredRole: 'followup', meetingId: null, questionId: null, waiting: null, resumeOn: null, source: { kind: 'manual' }, scheduleHistory: [], createdAt: '2026-11-24T08:00:00.000Z', updatedAt: '2026-11-24T08:00:00.000Z', completedAt: null, completedOn: null, canceledOn: null,
  }];
  s.workNotes = [{ id: 'n1', title: 'רשומה', body: 'טקסט כללי', categoryId: null, pinned: false, archived: false, taskId: null, createdAt: '2026-11-23T08:00:00.000Z', updatedAt: '2026-11-23T08:00:00.000Z' }];
  s.dailyReports['2026-11-24'] = { closedAt: '2026-11-24T14:30:00.000Z', checklist: {}, checklistLabels: {}, note: '', snapshot: {}, partial: false, amendments: [], reopenedAt: null };
  s.dayNotes['2026-11-24'] = { notes: 'הערה ישנה', accomplishments: 'הישג', updatedAt: '2026-11-24T14:30:00.000Z' };
  return s;
}
