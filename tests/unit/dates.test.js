import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, isValidTime, addDays, weekStart, diffDays, monthGrid, addMonths, zonedParts, hebrewDate, toMin, fromMin, weekday } from '../../js/dates.js';

test('strict date validation including leap days', () => {
  assert.ok(isValidDate('2028-02-29'));
  assert.ok(!isValidDate('2026-02-29'));
  assert.ok(!isValidDate('2026-02-30'));
  assert.ok(!isValidDate('2026-13-01'));
  assert.ok(!isValidDate('2026-1-01'));
  assert.ok(!isValidDate(null));
  assert.ok(isValidTime('00:00') && isValidTime('23:59'));
  assert.ok(!isValidTime('24:00') && !isValidTime('9:00') && !isValidTime('12:60'));
});

test('calendar arithmetic across month/year boundaries and DST dates', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-03-27', 1), '2026-03-28'); // Israel DST start (Friday before last Sunday)
  assert.equal(addDays('2026-10-25', 1), '2026-10-26'); // DST end period
  assert.equal(diffDays('2026-03-25', '2026-03-30'), 5);
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-12-15', 1), '2027-01-15');
  assert.equal(addMonths('2026-01-15', -1), '2025-12-15');
});

test('Sunday-first week boundaries', () => {
  assert.equal(weekStart('2026-11-30'), '2026-11-29'); // Monday -> Sunday
  assert.equal(weekStart('2026-11-29'), '2026-11-29');
  assert.equal(weekStart('2026-12-05'), '2026-11-29'); // Saturday
  assert.equal(weekday('2026-11-29'), 0);
  const g = monthGrid(2026, 2);
  assert.equal(g.length % 7, 0);
  assert.equal(weekday(g[0]), 0);
  assert.ok(g.includes('2026-02-01') && g.includes('2026-02-28'));
  assert.equal(new Set(g).size, g.length, 'no duplicated dates in grid');
});

test('Jerusalem wall clock is independent of host timezone', () => {
  // 2026-07-01T21:30Z is 00:30 next day in Israel (UTC+3 in summer).
  const p = zonedParts(new Date('2026-07-01T21:30:00Z'));
  assert.equal(p.date, '2026-07-02');
  assert.equal(p.min, 30);
  const w = zonedParts(new Date('2026-01-15T07:00:00Z'));
  assert.equal(w.min, 9 * 60); // UTC+2 in winter
});

test('time helpers and Hebrew date', () => {
  assert.equal(toMin('09:15'), 555);
  assert.equal(fromMin(555), '09:15');
  assert.match(hebrewDate('2026-11-30'), /ב/);
});
