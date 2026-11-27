// Text normalization for task search and duplicate detection (Hebrew-aware).

const NIQQUD = /[֑-ׇ]/g;
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };

/** Lower-case, strip niqqud/cantillation, unify final letters and punctuation. */
export function normalize(s) {
  return String(s || '')
    .normalize('NFKC')
    .replace(NIQQUD, '')
    .replace(/[ךםןףץ]/g, (c) => FINALS[c])
    .replace(/[׳״'"`\-_.,:;!?()[\]{}]/g, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does a task's title or note contain every word of the query? */
export function taskMatches(task, query) {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const text = normalize(`${task.title || ''} ${task.details || ''}`);
  return tokens.every((t) => text.includes(t));
}
