import test from 'node:test';
import assert from 'node:assert/strict';
import { collectAllIdPages } from '../../src/query-paging.mjs';

test('collects an uncapped result set across multiple 200-item pages', async () => {
  const source = Array.from({ length: 450 }, (_, index) => ({ id: index + 1 }));
  const pageSizes = [];
  const result = await collectAllIdPages(async (afterId, pageSize) => {
    pageSizes.push(pageSize);
    return source.filter(item => item.id > afterId).slice(0, pageSize);
  });
  assert.equal(result.items.length, 450);
  assert.equal(new Set(result.items.map(item => item.id)).size, 450);
  assert.equal(result.requestCount, 3);
  assert.deepEqual(pageSizes, [200, 200, 200]);
});

test('rejects page sizes that can exceed the ADS batch-details limit', async () => {
  await assert.rejects(() => collectAllIdPages(async () => [], 201), RangeError);
});

test('rejects repeated or non-increasing IDs to avoid silent paging loss', async () => {
  await assert.rejects(
    () => collectAllIdPages(async () => [{ id: 8 }, { id: 8 }], 2),
    /repeated, or out-of-order/
  );
});
