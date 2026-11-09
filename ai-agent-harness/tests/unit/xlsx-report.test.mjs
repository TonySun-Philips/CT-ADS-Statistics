import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { createXlsxReport } from '../../src/xlsx-report.mjs';

test('creates the required workbook sheets, daily summaries, and two styled charts', async () => {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'ads-bug-report-test-'));
  try {
    const task = {
      project: 'SY_CT_Projects',
      workItemType: 'Bug',
      savedQueryName: 'Earth-bugs-SE',
      startDate: '2026-10-08',
      reportDirectory: temporaryDirectory
    };
    const firstDayMorning = new Date(2026, 9, 8, 10, 0).toISOString();
    const secondDayMorning = new Date(2026, 9, 9, 10, 0).toISOString();
    const secondDayAfternoon = new Date(2026, 9, 9, 15, 0).toISOString();
    const workItems = [
      { id: 101, fields: { createdDate: firstDayMorning, title: 'Legacy issue', state: 'Resolved', tags: 'Legacy' } },
      { id: 102, fields: { createdDate: secondDayMorning, title: 'New requirement', state: 'Accepted', tags: 'new requirement' } },
      { id: 103, fields: { createdDate: secondDayAfternoon, title: 'Open issue', state: 'Active', tags: '' } }
    ];
    const result = await createXlsxReport(workItems, task, new Date(2026, 9, 10, 12), []);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(result.outputPath);

    assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), [
      'RawData', 'Resolution', '每日Issue统计', 'Daily'
    ]);
    assert.equal(workbook.getWorksheet('Resolution').getCell('F2').value, 'ToFix:Legacy');
    assert.equal(workbook.getWorksheet('Resolution').getCell('F3').value, 'Accepted:New Requirement');
    assert.equal(workbook.getWorksheet('每日Issue统计').getCell('A2').value, '2026-10-08');
    assert.equal(workbook.getWorksheet('每日Issue统计').getCell('B2').value, 1);
    assert.equal(workbook.getWorksheet('每日Issue统计').getCell('A3').value, '2026-10-09');
    assert.equal(workbook.getWorksheet('每日Issue统计').getCell('B3').value, 2);

    const zip = await JSZip.loadAsync(await readFile(result.outputPath));
    const flowChart = await zip.file('xl/charts/chart1.xml')?.async('string');
    const distributionChart = await zip.file('xl/charts/chart2.xml')?.async('string');
    const drawing = await zip.file('xl/drawings/drawing1.xml')?.async('string');
    const dailySheet = await zip.file('xl/worksheets/sheet4.xml')?.async('string');
    assert.match(flowChart || '', /Daily Flow-in 2 Haitao Issues/);
    assert.match(flowChart || '', /lineChart/);
    assert.match(flowChart || '', /<a:srgbClr val="4F81BD"/);
    assert.match(flowChart || '', /<c:catAx>[\s\S]*?<c:numFmt formatCode="General" sourceLinked="0"\/><c:majorTickMark val="out"\/><c:minorTickMark val="cross"\/>/);
    assert.match(flowChart || '', /<c:dTable><c:showHorzBorder val="1"\/><c:showVertBorder val="1"\/><c:showOutline val="1"\/><c:showKeys val="1"\/><\/c:dTable>/);
    assert.equal([...((flowChart || '').matchAll(/<c:dLbls>/g))].length, 2);
    assert.match(flowChart || '', /<c:dLblPos val="t"\/><c:showLegendKey val="0"\/><c:showVal val="1"\/>/);
    assert.match(flowChart || '', /<c:cat>[\s\S]*?<c:v>2026-10-08<\/c:v>/);
    assert.match(distributionChart || '', /Daily Distribution/);
    assert.match(distributionChart || '', /<c:grouping val="stacked"\/>/);
    assert.match(distributionChart || '', /<c:dTable><c:showHorzBorder val="1"\/><c:showVertBorder val="1"\/><c:showOutline val="1"\/><c:showKeys val="1"\/><\/c:dTable>/);
    assert.match(distributionChart || '', /<c:catAx>[\s\S]*?<c:numFmt formatCode="General" sourceLinked="1"\/><c:majorTickMark val="none"\/><c:minorTickMark val="none"\/>[\s\S]*?<c:txPr>[\s\S]*?rot="-60000000"/);
    assert.match(distributionChart || '', /<c:cat>[\s\S]*?<c:v>2026-10-08<\/c:v>/);
    assert.equal([...((distributionChart || '').matchAll(/<c:ser>/g))].length, 3);
    assert.match(distributionChart || '', /<a:srgbClr val="9BBB59"><a:lumMod val="60000"\/>/);
    assert.match(distributionChart || '', /<a:srgbClr val="8064A2">/);
    assert.equal([...((drawing || '').matchAll(/<xdr:twoCellAnchor/g))].length, 2);
    assert.match(drawing || '', /r:id="rId1"/);
    assert.match(drawing || '', /r:id="rId2"/);
    assert.match(dailySheet || '', /drawing r:id=/);

    const nextDayResult = await createXlsxReport(workItems, {
      ...task,
      reportDirectory: path.join(temporaryDirectory, 'next-day')
    }, new Date(2026, 9, 11, 12));
    const nextDayZip = await JSZip.loadAsync(await readFile(nextDayResult.outputPath));
    const nextDayDistributionChart = await nextDayZip.file('xl/charts/chart2.xml')?.async('string');
    const colors = chart => [...chart.matchAll(/<a:srgbClr val="(.*?)"/g)].map(match => match[1]);
    assert.deepEqual(colors(nextDayDistributionChart || ''), colors(distributionChart || ''));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
