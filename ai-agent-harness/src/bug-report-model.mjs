const FIX_STATES = new Set(['resolved', 'verified', 'closed']);

function classifyResolution(state, tags) {
  const normalizedState = String(state || 'Unspecified');
  const normalizedTags = String(tags || '').toLocaleLowerCase('en-US');
  const family = FIX_STATES.has(normalizedState.toLocaleLowerCase('en-US'))
    ? 'ToFix'
    : normalizedState.toLocaleLowerCase('en-US') === 'accepted'
      ? 'Accepted'
      : null;

  if (!family) return normalizedState;
  if (normalizedTags.includes('legacy')) return `${family}:Legacy`;
  if (normalizedTags.includes('new requirement')) return `${family}:New Requirement`;
  if (normalizedTags.includes('enhancement')) return `${family}:Enhancement`;
  return `${family}:Defect`;
}

export function workItemDateKey(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createResolutionRows(workItems) {
  return workItems.map(item => {
    const fields = item.fields || {};
    return {
      createdDate: workItemDateKey(fields.createdDate),
      id: item.id ?? '',
      title: fields.title ?? '',
      state: fields.state ?? '',
      tags: fields.tags ?? '',
      resolution: classifyResolution(fields.state, fields.tags)
    };
  }).sort((left, right) => left.createdDate.localeCompare(right.createdDate) || left.id - right.id);
}

export function summarizeDailyIssues(resolutionRows) {
  const resolutionNames = [...new Set(resolutionRows.map(row => row.resolution))].sort((a, b) => a.localeCompare(b));
  const days = new Map();
  for (const row of resolutionRows) {
    const current = days.get(row.createdDate) || { createdDate: row.createdDate, total: 0, counts: new Map() };
    current.total += 1;
    current.counts.set(row.resolution, (current.counts.get(row.resolution) || 0) + 1);
    days.set(row.createdDate, current);
  }
  const dailyRows = [...days.values()].sort((a, b) => a.createdDate.localeCompare(b.createdDate)).map(day => ({
    createdDate: day.createdDate,
    total: day.total,
    ...Object.fromEntries(resolutionNames.map(name => [name, day.counts.get(name) || 0]))
  }));
  const overall = Object.fromEntries(resolutionNames.map(name => [
    name,
    resolutionRows.filter(row => row.resolution === name).length
  ]));
  return { resolutionNames, dailyRows, overall };
}

export { classifyResolution };
