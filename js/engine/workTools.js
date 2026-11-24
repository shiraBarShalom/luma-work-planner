// Waiting/follow-up center, issue log and work notebook selectors.

/**
 * Unified waiting items by reference: waiting tasks, questions in progress or with a
 * follow-up date, and unresolved issues with a follow-up date.
 * @returns {Array<{type:'task'|'question'|'issue', id:string, title:string, followUpOn:string|null, due:boolean, note:string}>}
 */
export function waitingCenter(state, date) {
  const out = [];
  for (const t of state.tasks) {
    if (t.status !== 'waiting') continue;
    const f = t.waiting?.followUpOn || null;
    out.push({ type: 'task', id: t.id, title: t.title, followUpOn: f, due: !!(f && f <= date), note: t.waiting?.note || '' });
  }
  for (const q of state.questions) {
    if (!(q.status === 'waiting' || (q.status === 'open' && q.followUpOn))) continue;
    const f = q.followUpOn || null;
    out.push({ type: 'question', id: q.id, title: q.title, followUpOn: f, due: !!(f && f <= date), note: q.status === 'waiting' ? 'בטיפול' : '' });
  }
  for (const i of state.issueLogs) {
    if (i.status === 'resolved' || !i.followUpOn) continue;
    out.push({ type: 'issue', id: i.id, title: i.title, followUpOn: i.followUpOn, due: i.followUpOn <= date, note: i.reportedTo ? `דווח ל${i.reportedTo === 'it' ? '־IT' : 'מנהל'}` : '' });
  }
  return out.sort((a, b) => (b.due - a.due) || String(a.followUpOn || '9999').localeCompare(String(b.followUpOn || '9999')) || a.title.localeCompare(b.title, 'he'));
}

export function dueFollowUps(state, date) {
  return waitingCenter(state, date).filter((w) => w.due);
}

export function issueSummary(issue) {
  const occ = issue.occurrences || [];
  return {
    count: occ.length,
    first: occ.length ? occ.reduce((a, o) => (o.date < a ? o.date : a), occ[0].date) : null,
    last: occ.length ? occ.reduce((a, o) => (o.date > a ? o.date : a), occ[0].date) : null,
  };
}

export function sortedIssues(state) {
  const rank = { open: 0, reported: 1, resolved: 2 };
  return state.issueLogs.slice().sort((a, b) => rank[a.status] - rank[b.status] || String(issueSummary(b).last || '').localeCompare(String(issueSummary(a).last || '')));
}

export function sortedNotes(state, { includeArchived = false, categoryId = null } = {}) {
  return state.workNotes
    .filter((n) => (includeArchived || !n.archived) && (!categoryId || n.categoryId === categoryId))
    .sort((a, b) => (b.pinned - a.pinned) || String(b.updatedAt).localeCompare(String(a.updatedAt)));
}
