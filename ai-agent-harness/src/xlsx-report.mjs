import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResolutionRows, summarizeDailyIssues, workItemDateKey } from './bug-report-model.mjs';

const CHART_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
const DRAWING_MAIN_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const OFFICE_REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships';
const SPREADSHEET_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function xmlEscape(value) {
  return String(value).replace(/[<>&"']/g, character => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&apos;'
  })[character]);
}

function makeSeriesCache(values) {
  return `<c:strCache><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${xmlEscape(value)}</c:v></c:pt>`).join('')}</c:strCache>`;
}

function makeNumberCache(values) {
  return `<c:numCache><c:formatCode>0</c:formatCode><c:ptCount val="${values.length}"/>${values.map((value, index) => `<c:pt idx="${index}"><c:v>${Number(value) || 0}</c:v></c:pt>`).join('')}</c:numCache>`;
}

const CHART_COLORS = {
  'Accepted:Defect': { color: 'C0504D' },
  'Accepted:Legacy': { color: '9BBB59' },
  'Accepted:New Requirement': { color: '8064A2' },
  Planned: { color: '4BACC6' },
  Removed: { color: 'F79646' },
  'ToFix:Defect': { color: '4F81BD', lumMod: 60000 },
  'ToFix:Enhancement': { color: 'C0504D', lumMod: 60000 },
  'ToFix:Legacy': { color: '9BBB59', lumMod: 60000 },
  'ToFix:New Requirement': { color: '8064A2', lumMod: 60000 }
};
const FALLBACK_CHART_COLORS = ['4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];

function chartColor(resolution) {
  if (CHART_COLORS[resolution]) return CHART_COLORS[resolution];
  let hash = 0;
  for (const character of resolution) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return { color: FALLBACK_CHART_COLORS[hash % FALLBACK_CHART_COLORS.length] };
}

function seriesColorXml(color, lumMod) {
  return `<a:solidFill><a:srgbClr val="${color}">${lumMod ? `<a:lumMod val="${lumMod}"/>` : ''}</a:srgbClr></a:solidFill>`;
}

function chartTitleXml(title) {
  return `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(title)}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function createCategoryAxis(axisId, crossAxisId, sourceLinked, majorTickMark, minorTickMark, noMultiLvlLbl, rotateLabels = false) {
  const textProperties = rotateLabels
    ? `<c:txPr><a:bodyPr rot="-60000000" spcFirstLastPara="1" vertOverflow="ellipsis" vert="horz" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0" i="0" u="none" strike="noStrike" kern="1200" baseline="0"><a:solidFill><a:schemeClr val="tx1"><a:lumMod val="65000"/><a:lumOff val="35000"/></a:schemeClr></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:pPr><a:endParaRPr lang="zh-CN"/></a:p></c:txPr>`
    : '';
  return `<c:catAx><c:axId val="${axisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="${sourceLinked}"/><c:majorTickMark val="${majorTickMark}"/><c:minorTickMark val="${minorTickMark}"/><c:tickLblPos val="nextTo"/>${textProperties}<c:crossAx val="${crossAxisId}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="${noMultiLvlLbl}"/></c:catAx>`;
}

function createValueAxis(axisId, crossAxisId) {
  return `<c:valAx><c:axId val="${axisId}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="0" sourceLinked="0"/><c:tickLblPos val="nextTo"/><c:crossAx val="${crossAxisId}"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
}

function chartSpaceXml(title, plotXml, chartOptions = {}) {
  const dataTable = chartOptions.showDataTable
    ? '<c:dTable><c:showHorzBorder val="1"/><c:showVertBorder val="1"/><c:showOutline val="1"/><c:showKeys val="1"/></c:dTable>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="${CHART_NS}" xmlns:a="${DRAWING_MAIN_NS}" xmlns:r="${OFFICE_REL_NS}"><c:lang val="en-US"/><c:style val="2"/><c:chart>${chartTitleXml(title)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plotXml}</c:plotArea>${dataTable}<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/><c:showDLblsOverMax val="0"/></c:chart></c:chartSpace>`;
}

function valueDataLabelsXml() {
  return '<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr><c:dLblPos val="t"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="0"/></c:dLbls>';
}

function chartValueDataLabelsXml() {
  return '<c:dLbls><c:dLblPos val="t"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>';
}

function createFlowChartXml(dailyRows, firstDataRow, dateColumn, totalColumn) {
  const lastDataRow = firstDataRow + dailyRows.length - 1;
  const dateFormula = `'Daily'!$${dateColumn}$${firstDataRow}:$${dateColumn}$${lastDataRow}`;
  const totalFormula = `'Daily'!$${totalColumn}$${firstDataRow}:$${totalColumn}$${lastDataRow}`;
  const color = CHART_COLORS['ToFix:Defect'].color;
  const series = `<c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>'Daily'!$${totalColumn}$5</c:f>${makeSeriesCache(['Created Issues'])}</c:strRef></c:tx><c:spPr><a:ln w="28575">${seriesColorXml(color)}</a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr>${seriesColorXml(color)}<a:ln>${seriesColorXml(color)}</a:ln></c:spPr></c:marker><c:cat><c:strRef><c:f>${xmlEscape(dateFormula)}</c:f>${makeSeriesCache(dailyRows.map(row => row.createdDate))}</c:strRef></c:cat><c:val><c:numRef><c:f>${xmlEscape(totalFormula)}</c:f>${makeNumberCache(dailyRows.map(row => row.total))}</c:numRef></c:val>${valueDataLabelsXml()}<c:smooth val="0"/></c:ser>`;
  const plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}${chartValueDataLabelsXml()}<c:marker val="1"/><c:smooth val="0"/><c:axId val="100001"/><c:axId val="100002"/></c:lineChart>${createCategoryAxis(100001, 100002, 0, 'out', 'cross', 1)}${createValueAxis(100002, 100001)}`;
  return chartSpaceXml('Daily Flow-in 2 Haitao Issues', plot, { showDataTable: true });
}

function excelColumnName(columnNumber) {
  let name = '';
  let remaining = columnNumber;
  while (remaining > 0) {
    const remainder = (remaining - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return name;
}

function createDistributionChartXml(dailyRows, resolutionNames, firstDataRow, dateColumn) {
  const lastDataRow = firstDataRow + dailyRows.length - 1;
  const categoryFormula = `'Daily'!$${dateColumn}$${firstDataRow}:$${dateColumn}$${lastDataRow}`;
  const series = resolutionNames.map((resolution, index) => {
    const column = excelColumnName(6 + index);
    const valueFormula = `'Daily'!$${column}$${firstDataRow}:$${column}$${lastDataRow}`;
    const color = chartColor(resolution);
    return `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:strRef><c:f>'Daily'!$${column}$5</c:f>${makeSeriesCache([resolution])}</c:strRef></c:tx><c:spPr>${seriesColorXml(color.color, color.lumMod)}<a:ln><a:noFill/></a:ln><a:effectLst/></c:spPr><c:invertIfNegative val="0"/><c:cat><c:strRef><c:f>${xmlEscape(categoryFormula)}</c:f>${makeSeriesCache(dailyRows.map(row => row.createdDate))}</c:strRef></c:cat><c:val><c:numRef><c:f>${xmlEscape(valueFormula)}</c:f>${makeNumberCache(dailyRows.map(row => row[resolution] || 0))}</c:numRef></c:val></c:ser>`;
  }).join('');
  const plot = `<c:barChart><c:barDir val="col"/><c:grouping val="stacked"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/><c:overlap val="100"/><c:axId val="100001"/><c:axId val="100002"/></c:barChart>${createCategoryAxis(100001, 100002, 1, 'none', 'none', 0, true)}${createValueAxis(100002, 100001)}`;
  return chartSpaceXml('Daily Distribution', plot, { showDataTable: true });
}

function createChartAnchor(chartId, name, fromRow, toRow, toRowOffset) {
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>3</xdr:col><xdr:colOff>289560</xdr:colOff><xdr:row>${fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>12</xdr:col><xdr:colOff>487680</xdr:colOff><xdr:row>${toRow}</xdr:row><xdr:rowOff>${toRowOffset}</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId + 1}" name="${xmlEscape(name)}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${CHART_NS}"><c:chart xmlns:c="${CHART_NS}" xmlns:r="${OFFICE_REL_NS}" r:id="rId${chartId}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
}

function createDrawingXml(firstChartRow) {
  const firstChartEndRow = firstChartRow + 18;
  const secondChartRow = firstChartEndRow + 1;
  const secondChartEndRow = secondChartRow + 19;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="${DRAWING_NS}" xmlns:a="${DRAWING_MAIN_NS}">${createChartAnchor(1, 'Daily Flow-in 2 Haitao Issues', firstChartRow, firstChartEndRow, 106680)}${createChartAnchor(2, 'Daily Distribution', secondChartRow, secondChartEndRow, 129540)}</xdr:wsDr>`;
}

async function addNativeCharts(workbookBuffer, dailyRows, firstDataRow, dateColumn, totalColumn, resolutionNames, dailyStartRow) {
  const zip = await JSZip.loadAsync(workbookBuffer);
  const worksheetPath = 'xl/worksheets/sheet4.xml';
  let worksheetXml = await zip.file(worksheetPath)?.async('string');
  assertWorksheet(worksheetXml, worksheetPath);
  if (worksheetXml.includes('<drawing')) throw new Error('Daily sheet already has a drawing relationship.');
  if (!worksheetXml.includes('xmlns:r=')) {
    worksheetXml = worksheetXml.replace('<worksheet ', `<worksheet xmlns:r="${OFFICE_REL_NS}" `);
  }
  worksheetXml = worksheetXml.replace('</worksheet>', '<drawing r:id="rId1"/></worksheet>');
  zip.file(worksheetPath, worksheetXml);

  zip.file('xl/worksheets/_rels/sheet4.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`);
  zip.file('xl/drawings/drawing1.xml', createDrawingXml(dailyStartRow + dailyRows.length + 5));
  zip.file('xl/drawings/_rels/drawing1.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${PACKAGE_REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/chart" Target="../charts/chart1.xml"/><Relationship Id="rId2" Type="${OFFICE_REL_NS}/chart" Target="../charts/chart2.xml"/></Relationships>`);
  zip.file('xl/charts/chart1.xml', createFlowChartXml(dailyRows, firstDataRow, dateColumn, totalColumn));
  zip.file('xl/charts/chart2.xml', createDistributionChartXml(dailyRows, resolutionNames, firstDataRow, dateColumn));

  const contentTypes = zip.file('[Content_Types].xml');
  if (!contentTypes) throw new Error('XLSX package is missing [Content_Types].xml.');
  let contentTypesXml = await contentTypes.async('string');
  const overrides = [
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    `<Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    `<Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`
  ];
  contentTypesXml = contentTypesXml.replace('</Types>', `${overrides.join('')}</Types>`);
  zip.file('[Content_Types].xml', contentTypesXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}

function assertWorksheet(value, name) {
  if (!value) throw new Error(`XLSX package is missing ${name}.`);
}

function applyHeaderStyle(worksheet) {
  const header = worksheet.getRow(1);
  header.height = 24;
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF165D72' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

function setColumns(worksheet, headers) {
  worksheet.columns = headers.map(({ header, key, width, numFmt }) => ({
    header,
    key,
    width,
    style: numFmt ? { numFmt } : undefined
  }));
  applyHeaderStyle(worksheet);
}

function dateRange(startDate, endDate) {
  const dates = [];
  const current = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export async function createXlsxReport(workItems, task, runDate = new Date(), queryRequestCount = 0) {
  const dateStamp = localDateKey(runDate);
  const dates = dateRange(task.startDate, dateStamp);
  const resolutionRows = createResolutionRows(workItems);
  const { resolutionNames, dailyRows: aggregatedRows, overall } = summarizeDailyIssues(resolutionRows);
  const aggregatedByDay = new Map(aggregatedRows.map(row => [row.createdDate, row]));
  const dailyRows = dates.map(createdDate => ({
    createdDate,
    total: aggregatedByDay.get(createdDate)?.total || 0,
    ...Object.fromEntries(resolutionNames.map(name => [name, aggregatedByDay.get(createdDate)?.[name] || 0]))
  }));
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Philips ADS Bug Status Agent';
  workbook.created = runDate;
  workbook.modified = runDate;
  workbook.properties.title = `Daily Bug Status ${task.project} ${dateStamp}`;
  workbook.properties.subject = `Ever assigned to ${task.everAssignedTo}`;

  const rawDataSheet = workbook.addWorksheet('RawData');
  const rawHeaders = [
    { header: 'Created Date', key: 'createdDate', width: 15 },
    { header: 'ID', key: 'id', width: 13 },
    { header: 'Title', key: 'title', width: 72 },
    { header: 'State', key: 'state', width: 18 },
    { header: 'Tags', key: 'tags', width: 54 }
  ];
  setColumns(rawDataSheet, rawHeaders);
  rawDataSheet.addRows(workItems.map(item => ({
    createdDate: workItemDateKey(item.fields?.createdDate),
    id: item.id ?? '',
    title: item.fields?.title ?? '',
    state: item.fields?.state ?? '',
    tags: item.fields?.tags ?? ''
  })));
  rawDataSheet.autoFilter = { from: 'A1', to: `E${Math.max(1, workItems.length + 1)}` };

  const resolutionSheet = workbook.addWorksheet('Resolution');
  setColumns(resolutionSheet, [
    { header: 'Created Date', key: 'createdDate', width: 15 },
    { header: 'ID', key: 'id', width: 13 },
    { header: 'Title', key: 'title', width: 72 },
    { header: 'State', key: 'state', width: 18 },
    { header: 'Tags', key: 'tags', width: 54 },
    { header: 'Resolution', key: 'resolution', width: 28 }
  ]);
  resolutionSheet.addRows(resolutionRows);
  resolutionSheet.autoFilter = { from: 'A1', to: `F${Math.max(1, resolutionRows.length + 1)}` };

  const issueSheet = workbook.addWorksheet('每日Issue统计');
  const issueHeaders = [
    { header: 'Created Date', key: 'createdDate', width: 16 },
    { header: 'Created Issues', key: 'total', width: 18 },
    ...resolutionNames.map((name, index) => ({ header: name, key: `resolution${index}`, width: 26 }))
  ];
  setColumns(issueSheet, issueHeaders);
  issueSheet.addRows(dailyRows.map(day => ({
    createdDate: day.createdDate,
    total: day.total,
    ...Object.fromEntries(resolutionNames.map((name, index) => [`resolution${index}`, day[name]]))
  })));

  const dailySheet = workbook.addWorksheet('Daily');
  dailySheet.mergeCells('A1:B1');
  dailySheet.getCell('A1').value = 'Daily Bug Status';
  dailySheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF165D72' } };
  dailySheet.getCell('A2').value = `Project: ${task.project} | Date range: ${task.startDate} to ${dateStamp} | Ever assigned to: ${task.everAssignedTo}`;
  dailySheet.getCell('A3').value = `Query method: WIQL project/type/date filters plus EVER [System.AssignedTo]. No daily result cap; fetched by ID cursor in ${queryRequestCount} ADS requests.`;
  dailySheet.mergeCells('A3:H3');
  dailySheet.getCell('A3').alignment = { wrapText: true, vertical: 'top' };
  dailySheet.getRow(3).height = 36;
  dailySheet.getCell('A4').value = 'Overall Resolution Summary';
  dailySheet.getCell('A4').font = { bold: true, size: 12 };
  dailySheet.getCell('A5').value = 'Resolution';
  dailySheet.getCell('B5').value = 'Count';
  dailySheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  dailySheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF165D72' } };
  for (const [index, resolution] of resolutionNames.entries()) {
    dailySheet.getCell(index + 6, 1).value = resolution;
    dailySheet.getCell(index + 6, 2).value = overall[resolution] || 0;
  }

  const dailyStartRow = 5;
  const dailyHeaders = ['Created Date', 'Created Issues', ...resolutionNames];
  dailyHeaders.forEach((header, index) => {
    const cell = dailySheet.getCell(dailyStartRow, index + 4);
    cell.value = header;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF165D72' } };
  });
  dailyRows.forEach((day, index) => {
    const rowNumber = dailyStartRow + index + 1;
    dailySheet.getCell(rowNumber, 4).value = day.createdDate;
    dailySheet.getCell(rowNumber, 5).value = day.total;
    resolutionNames.forEach((name, categoryIndex) => {
      dailySheet.getCell(rowNumber, categoryIndex + 6).value = day[name];
    });
  });
  dailySheet.getColumn(4).width = 16;
  dailySheet.getColumn(5).width = 18;
  resolutionNames.forEach((_, index) => { dailySheet.getColumn(index + 6).width = 26; });
  dailySheet.views = [{ state: 'frozen', ySplit: 5, xSplit: 3 }];
  dailySheet.getColumn(1).width = 30;
  dailySheet.getColumn(2).width = 14;
  dailySheet.getColumn(3).width = 3;
  dailySheet.getColumn(10).width = 14;
  dailySheet.autoFilter = {
    from: { row: dailyStartRow, column: 4 },
    to: { row: dailyStartRow + dailyRows.length, column: 5 + resolutionNames.length }
  };

  const reportDirectory = path.resolve(fileURLToPath(new URL('../', import.meta.url)), task.reportDirectory);
  const outputPath = path.join(reportDirectory, `${dateStamp}.xlsx`);
  await mkdir(reportDirectory, { recursive: true });
  const workbookBuffer = await workbook.xlsx.writeBuffer();
  const chartBuffer = await addNativeCharts(
    workbookBuffer,
    dailyRows,
    dailyStartRow + 1,
    'D',
    'E',
    resolutionNames,
    dailyStartRow
  );
  await writeFile(outputPath, chartBuffer);
  return { outputPath, resolutionRows, dailyRows, overall, queryRequestCount };
}
