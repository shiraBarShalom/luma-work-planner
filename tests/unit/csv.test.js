import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv, tasksCsv } from '../../js/export/csv.js';
import { freshState } from '../helpers.js';

test('CSV escaping and spreadsheet formula injection protection', () => {
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell('+972'), "'+972");
  assert.equal(csvCell('-1'), "'-1");
  assert.equal(csvCell('@x'), "'@x");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('ציטוט "פנימי"'), '"ציטוט ""פנימי"""');
  assert.equal(csvCell('שורה\nשנייה'), '"שורה\nשנייה"');
  assert.equal(csvCell(null), '');
  const out = toCsv(['א', 'ב'], [['=1', 'טקסט']]);
  assert.ok(out.startsWith('\uFEFF'), 'BOM for Hebrew in spreadsheets');
  assert.ok(out.includes("'=1,טקסט"));
  assert.equal(tasksCsv(freshState()).split('\r\n').length, 1, 'header only for empty state');
});
