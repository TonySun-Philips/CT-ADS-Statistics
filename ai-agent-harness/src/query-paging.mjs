export async function collectAllIdPages(queryPage, pageSize = 200) {
  if (!Number.isInteger(pageSize) || pageSize <= 0 || pageSize > 200) {
    throw new RangeError('ADS work-item detail requests support a page size from 1 to 200.');
  }

  const items = [];
  const seenIds = new Set();
  let afterId = 0;
  let requestCount = 0;

  while (true) {
    const page = await queryPage(afterId, pageSize);
    requestCount += 1;
    if (!Array.isArray(page) || page.length > pageSize) {
      throw new Error('ADS returned an invalid work-item page.');
    }
    if (page.length === 0) break;

    let nextAfterId = afterId;
    for (const item of page) {
      if (!Number.isInteger(item.id) || item.id <= afterId || seenIds.has(item.id)) {
        throw new Error('ADS pagination returned a missing, repeated, or out-of-order work-item ID.');
      }
      seenIds.add(item.id);
      nextAfterId = Math.max(nextAfterId, item.id);
    }
    items.push(...page);
    afterId = nextAfterId;
    if (page.length < pageSize) break;
  }

  return { items, requestCount };
}
