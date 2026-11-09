import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyResolution, createResolutionRows, summarizeDailyIssues } from '../../src/bug-report-model.mjs';

test('terminal states map tags to ToFix categories', () => {
  assert.equal(classifyResolution('Resolved', 'legacy; UI'), 'ToFix:Legacy');
  assert.equal(classifyResolution('Verified', 'new requirement; feature'), 'ToFix:New Requirement');
  assert.equal(classifyResolution('Closed', 'customer-reported'), 'ToFix:Defect');
});

test('Accepted maps tags to Accepted categories', () => {
  assert.equal(classifyResolution('Accepted', 'LEGACY'), 'Accepted:Legacy');
  assert.equal(classifyResolution('Accepted', 'New Requirement'), 'Accepted:New Requirement');
  assert.equal(classifyResolution('Accepted', ''), 'Accepted:Defect');
});

test('other states are preserved without classification', () => {
  assert.equal(classifyResolution('Active', 'Legacy'), 'Active');
  assert.equal(classifyResolution('New', 'new requirement'), 'New');
});

test('resolution rows use creation dates and daily summaries include category counts', () => {
  const rows = createResolutionRows([
    { id: 2, fields: { createdDate: '2026-10-09T15:00:00Z', state: 'Accepted', tags: 'Legacy', title: 'B' } },
    { id: 1, fields: { createdDate: '2026-10-08T08:00:00Z', state: 'Resolved', tags: 'new requirement', title: 'A' } },
    { id: 3, fields: { createdDate: '2026-10-09T09:00:00Z', state: 'New', tags: '', title: 'C' } }
  ]);
  assert.deepEqual(rows.map(row => [row.createdDate, row.resolution]), [
    ['2026-10-08', 'ToFix:New Requirement'],
    ['2026-10-09', 'Accepted:Legacy'],
    ['2026-10-09', 'New']
  ]);
  const summary = summarizeDailyIssues(rows);
  assert.deepEqual(summary.overall, {
    'Accepted:Legacy': 1,
    New: 1,
    'ToFix:New Requirement': 1
  });
  assert.deepEqual(summary.dailyRows.map(row => [row.createdDate, row.total]), [
    ['2026-10-08', 1],
    ['2026-10-09', 2]
  ]);
});
