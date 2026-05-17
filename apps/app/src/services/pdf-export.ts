import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';

import type { VfrPlanData } from '../components/vfr/VfrPlanForm';
import type { PlanViability } from '../components/vfr/weatherTimeUtils';

export interface AiValidationResult {
  overallStatus: 'pass' | 'warnings' | 'issues';
  items: { category: string; status: 'pass' | 'warn' | 'fail'; title: string; description: string }[];
  summary: string;
  meta?: { provider: string; model: string; byok: boolean; remaining?: number };
}

function tableEndY(doc: jsPDF): number {
  return (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? 0;
}

const AVGAS_KG_PER_L = 0.72;
const KG_TO_LBS = 2.20462;
const L_TO_GAL_US = 0.264172;

const COLORS = {
  primary: [34, 84, 204] as [number, number, number],
  headerBg: [34, 84, 204] as [number, number, number],
  headerText: [255, 255, 255] as [number, number, number],
  altRow: [245, 247, 252] as [number, number, number],
  border: [200, 210, 230] as [number, number, number],
  text: [30, 30, 40] as [number, number, number],
  muted: [120, 130, 150] as [number, number, number],
};

function fuelConvert(liters: number) {
  const kg = liters * AVGAS_KG_PER_L;
  return {
    liters: liters.toFixed(1),
    kg: kg.toFixed(1),
    lbs: (kg * KG_TO_LBS).toFixed(1),
    gal: (liters * L_TO_GAL_US).toFixed(1),
  };
}

function fmtKg(kg: number) {
  return {
    kg: kg.toFixed(1),
    lbs: (kg * KG_TO_LBS).toFixed(1),
    liters: (kg / AVGAS_KG_PER_L).toFixed(1),
    gal: ((kg / AVGAS_KG_PER_L) * L_TO_GAL_US).toFixed(1),
  };
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}min` : `${m}min`;
}

function sectionTitle(doc: jsPDF, text: string, y: number): number {
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.primary);
  doc.text(text, 14, y);
  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(0.5);
  doc.line(14, y + 1.5, 196, y + 1.5);
  return y + 7;
}

function checkPage(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > 275) {
    doc.addPage();
    return 15;
  }
  return y;
}

function sanitizeText(text: string): string {
  return text
    .replace(/→/g, '>') // → not in helvetica
    .replace(/←/g, '<')
    .replace(/↔/g, '<>')
    .replace(/–/g, '-') // en-dash
    .replace(/—/g, '--') // em-dash
    .replace(/‘|’/g, "'")
    .replace(/“|”/g, '"')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

interface MdBlock {
  type: 'text' | 'heading' | 'table' | 'list';
  content?: string;
  level?: number;
  headers?: string[];
  rows?: string[][];
  items?: string[];
}

function parseMarkdownBlocks(text: string): MdBlock[] {
  const lines = text.split('\n');
  const blocks: MdBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) { i++; continue; }

    // Table: starts with | ... |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('|') && lines[i]!.trim().endsWith('|')) {
        tableLines.push(lines[i]!.trim());
        i++;
      }
      const parsed = tableLines
        .filter(l => !/^[-|:\s]+$/.test(l.replace(/\|/g, '').trim()) && !/^[\s|:-]+$/.test(l))
        .map(l => l.split('|').slice(1, -1).map(c => sanitizeText(c.trim())));
      if (parsed.length > 0) {
        blocks.push({
          type: 'table',
          headers: parsed[0],
          rows: parsed.slice(1),
        });
      }
      continue;
    }

    // Heading
    const hMatch = trimmed.match(/^(#{1,3})\s+(.+)/);
    if (hMatch) {
      blocks.push({ type: 'heading', content: sanitizeText(hMatch[2]!), level: hMatch[1]!.length });
      i++;
      continue;
    }

    // List item
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || /^\d+\.\s/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length) {
        const li = lines[i]!.trim();
        if (li.startsWith('- ') || li.startsWith('* ')) {
          items.push(sanitizeText(li.slice(2)));
        } else if (/^\d+\.\s/.test(li)) {
          items.push(sanitizeText(li.replace(/^\d+\.\s/, '')));
        } else {
          break;
        }
        i++;
      }
      blocks.push({ type: 'list', items });
      continue;
    }

    // Plain text - collect consecutive non-empty lines
    let para = '';
    while (i < lines.length && lines[i]!.trim() && !lines[i]!.trim().startsWith('|') && !lines[i]!.trim().startsWith('#') && !lines[i]!.trim().startsWith('- ') && !lines[i]!.trim().startsWith('* ') && !/^\d+\.\s/.test(lines[i]!.trim())) {
      para += (para ? ' ' : '') + lines[i]!.trim();
      i++;
    }
    if (para) blocks.push({ type: 'text', content: sanitizeText(para) });
  }
  return blocks;
}

function renderMarkdownToPdf(doc: jsPDF, text: string, startY: number, leftX: number, maxWidth: number, checkPageFn: (d: jsPDF, y: number, h: number) => number): number {
  let y = startY;
  const blocks = parseMarkdownBlocks(text);

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        const fontSize = block.level === 1 ? 9 : block.level === 2 ? 8.5 : 8;
        y = checkPageFn(doc, y, 8);
        doc.setFontSize(fontSize);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.text);
        doc.text(block.content!, leftX, y);
        y += 5;
        break;
      }
      case 'text': {
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.muted);
        const wrapped: string[] = doc.splitTextToSize(block.content!, maxWidth);
        y = checkPageFn(doc, y, wrapped.length * 3.5 + 2);
        doc.text(wrapped, leftX, y);
        y += wrapped.length * 3.5 + 2;
        break;
      }
      case 'list': {
        for (const item of block.items ?? []) {
          doc.setFontSize(7.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(...COLORS.muted);
          const wrapped: string[] = doc.splitTextToSize(item, maxWidth - 4);
          y = checkPageFn(doc, y, wrapped.length * 3.5 + 1);
          doc.text('-', leftX, y);
          doc.text(wrapped, leftX + 4, y);
          y += wrapped.length * 3.5 + 1;
        }
        y += 1;
        break;
      }
      case 'table': {
        const headers = block.headers ?? [];
        const rows = block.rows ?? [];
        const colCount = headers.length || (rows[0]?.length ?? 0);
        if (colCount === 0) break;

        const colW = maxWidth / colCount;
        const rowH = 5;
        const totalH = (1 + rows.length) * rowH + 2;
        y = checkPageFn(doc, y, Math.min(totalH, 60));

        // Header row
        doc.setFillColor(240, 240, 245);
        doc.rect(leftX, y - 3.5, maxWidth, rowH, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...COLORS.text);
        for (let c = 0; c < colCount; c++) {
          const cellText = (headers[c] ?? '').substring(0, Math.floor(colW / 1.8));
          doc.text(cellText, leftX + c * colW + 1.5, y);
        }
        y += rowH;

        // Data rows
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...COLORS.muted);
        for (const row of rows) {
          y = checkPageFn(doc, y, rowH);
          doc.setDrawColor(220, 220, 225);
          doc.line(leftX, y - 3.5, leftX + maxWidth, y - 3.5);
          for (let c = 0; c < colCount; c++) {
            const cellText = (row[c] ?? '').substring(0, Math.floor(colW / 1.8));
            doc.text(cellText, leftX + c * colW + 1.5, y);
          }
          y += rowH;
        }
        y += 2;
        break;
      }
    }
  }
  return y;
}

function labelValue(doc: jsPDF, label: string, value: string, x: number, y: number): void {
  doc.setFont('helvetica', 'bold');
  doc.text(label, x, y);
  const w = doc.getTextWidth(label);
  doc.setFont('helvetica', 'normal');
  doc.text(value, x + w, y);
}

export function buildFlightPlanDoc(plan: VfrPlanData, mapImageDataUrl?: string, aiValidation?: AiValidationResult, viability?: PlanViability): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const now = new Date();
  const hasIfr = plan.flightRules === 'IFR' || plan.flightRules === 'VFR_IFR' || plan.flightRules === 'IFR_VFR';

  // ─── HEADER ───
  doc.setFillColor(...COLORS.headerBg);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.headerText);
  doc.text('FS SUITE — FLIGHT PLAN', 14, 14);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const eobt = plan.plannedDepartureTime
    ? (() => { const d = new Date(plan.plannedDepartureTime); const dd = String(d.getUTCDate()).padStart(2,'0'); const hh = String(d.getUTCHours()).padStart(2,'0'); const mm = String(d.getUTCMinutes()).padStart(2,'0'); return `EOBT ${dd}${hh}${mm}Z`; })()
    : null;
  const headerParts: string[] = [plan.flightRules ?? 'VFR'];
  if (eobt) headerParts.push(eobt);
  headerParts.push(`${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
  doc.text(headerParts.join('  |  '), 14, 22);

  if (plan.callsign) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(plan.callsign, 196, 14, { align: 'right' });
  }
  if (plan.aircraftName || plan.aircraftType) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(plan.aircraftName || plan.aircraftType || '', 196, 22, { align: 'right' });
  }

  let y = 36;

  // ─── ROUTE SUMMARY ───
  y = sectionTitle(doc, 'ROUTE', y);

  const routeRows: string[][] = [
    ['Origin', `${plan.originIcao} — ${plan.originName}`, plan.originRunwayInUse ? `RWY ${plan.originRunwayInUse}` : '', plan.originElevationFt ? `${plan.originElevationFt} ft` : ''],
    ['Destination', `${plan.destinationIcao} — ${plan.destinationName}`, plan.destinationRunwayInUse ? `RWY ${plan.destinationRunwayInUse}` : '', plan.destinationElevationFt ? `${plan.destinationElevationFt} ft` : ''],
  ];
  if (plan.alternateIcao) {
    routeRows.push(['Alternate', `${plan.alternateIcao} — ${plan.alternateName ?? ''}`, plan.alternateRunwayInUse ? `RWY ${plan.alternateRunwayInUse}` : '', plan.alternateElevationFt ? `${plan.alternateElevationFt} ft` : '']);
  }

  autoTable(doc, {
    startY: y,
    head: [['', 'Aerodrome', 'Runway', 'Elevation']],
    body: routeRows,
    theme: 'grid',
    headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 8 },
    bodyStyles: { fontSize: 9, textColor: COLORS.text },
    alternateRowStyles: { fillColor: COLORS.altRow },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 24 },
      1: { cellWidth: 'auto' },
      2: { cellWidth: 28, halign: 'center' },
      3: { cellWidth: 26, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  });
  y = tableEndY(doc) + 4;

  // Route details line
  y = checkPage(doc, y, 24);
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.text);

  if (plan.cruiseLevel) {
    labelValue(doc, 'Cruise Level: ', plan.cruiseLevel, 14, y);
    y += 5;
  }
  if (plan.routeText) {
    doc.setFont('helvetica', 'bold');
    doc.text('Route: ', 14, y);
    const rW = doc.getTextWidth('Route: ');
    doc.setFont('helvetica', 'normal');
    const routeLines = doc.splitTextToSize(plan.routeText, 182 - rW);
    doc.text(routeLines[0], 14 + rW, y);
    for (let i = 1; i < routeLines.length; i++) {
      y += 4;
      doc.text(routeLines[i], 14, y);
    }
    y += 5;
  }

  if (plan.remarks) {
    doc.setFont('helvetica', 'bold');
    doc.text('Item 18: ', 14, y);
    const rmkW = doc.getTextWidth('Item 18: ');
    doc.setFont('helvetica', 'normal');
    const rmkLines = doc.splitTextToSize(plan.remarks, 182 - rmkW);
    doc.text(rmkLines[0], 14 + rmkW, y);
    for (let i = 1; i < rmkLines.length; i++) {
      y += 4;
      doc.text(rmkLines[i], 14, y);
    }
    y += 5;
  }

  // Trip summary line
  const summaryParts: string[] = [];
  if (plan.totalDistanceNm) summaryParts.push(`${plan.totalDistanceNm.toFixed(1)} NM`);
  if (plan.tripMinutes) summaryParts.push(`ETE ${formatMinutes(plan.tripMinutes)}`);
  if (plan.cruiseSpeedKts) summaryParts.push(`TAS ${plan.cruiseSpeedKts} kt`);
  if (plan.flightCondition) summaryParts.push(plan.flightCondition === 'day' ? 'Day' : 'Night');
  if (summaryParts.length > 0) {
    labelValue(doc, 'Trip: ', summaryParts.join('  |  '), 14, y);
    y += 5;
  }

  if (plan.todDistanceNm) {
    labelValue(doc, 'TOD: ', `${plan.todDistanceNm} NM before destination`, 14, y);
    y += 5;
  }
  y += 2;

  // ─── NAVIGATION LOG ───
  if (plan.routeLegs && plan.routeLegs.length > 0) {
    y = checkPage(doc, y, 20 + plan.routeLegs.length * 6);
    y = sectionTitle(doc, 'NAVIGATION LOG', y);

    const legRows = plan.routeLegs.map((leg, i) => [
      String(i + 1),
      `${leg.from} > ${leg.to}`,
      leg.distanceNm.toFixed(1),
      `${leg.trueCourse.toFixed(0)}°`,
      `${leg.magneticDeclination >= 0 ? '+' : ''}${leg.magneticDeclination.toFixed(0)}°`,
      `${leg.magneticCourse.toFixed(0)}°`,
      leg.suggestedAltitudes.slice(0, 2).map((a) =>
        hasIfr ? `FL${String(Math.round(a / 100)).padStart(3, '0')}` : a.toLocaleString(),
      ).join(', '),
    ]);

    // Total row
    legRows.push([
      '',
      'TOTAL',
      plan.totalDistanceNm?.toFixed(1) ?? '',
      '',
      '',
      '',
      plan.tripMinutes ? `ETE ${formatMinutes(plan.tripMinutes)}` : '',
    ]);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Leg', 'NM', 'TC', 'VAR', 'MC', 'Alt']],
      body: legRows,
      theme: 'grid',
      headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 7 },
      bodyStyles: { fontSize: 8, textColor: COLORS.text },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 16, halign: 'center' },
        5: { cellWidth: 16, halign: 'center' },
        6: { cellWidth: 30, halign: 'center' },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'body' && data.row.index === legRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = tableEndY(doc) + 6;
  }

  // ─── NAVIGATION MAP ───
  if (mapImageDataUrl) {
    y = sectionTitle(doc, 'NAVIGATION MAP', checkPage(doc, y, 120));
    try {
      const imgW = 182;
      const props = doc.getImageProperties(mapImageDataUrl);
      const imgH = (props.height / props.width) * imgW;
      const maxH = 160;
      const finalH = Math.min(imgH, maxH);
      const finalW = imgH > maxH ? (props.width / props.height) * maxH : imgW;
      doc.addImage(mapImageDataUrl, 'PNG', 14, y, finalW, finalH);
      y += finalH + 6;
    } catch { /* skip if image fails */ }
  }

  // ─── WEATHER (METAR) ───
  const metarEntries: { label: string; raw: string }[] = [];
  if (plan.originMetarRaw) metarEntries.push({ label: plan.originIcao, raw: plan.originMetarRaw });
  if (plan.destinationMetarRaw) metarEntries.push({ label: plan.destinationIcao, raw: plan.destinationMetarRaw });
  if (plan.alternateIcao && plan.alternateMetarRaw) metarEntries.push({ label: plan.alternateIcao, raw: plan.alternateMetarRaw });

  if (metarEntries.length > 0) {
    y = checkPage(doc, y, 12 + metarEntries.length * 8);
    y = sectionTitle(doc, 'WEATHER (METAR)', y);

    for (const entry of metarEntries) {
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text(entry.label, 14, y);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.muted);
      const metarLines = doc.splitTextToSize(entry.raw, 170);
      doc.text(metarLines, 36, y);
      y += metarLines.length * 4 + 3;
    }
    y += 2;
  }

  // ─── AIRCRAFT ───
  if (plan.aircraftName || plan.aircraftType) {
    y = checkPage(doc, y, 30);
    y = sectionTitle(doc, 'AIRCRAFT', y);

    const acRows: string[][] = [];
    if (plan.aircraftName) acRows.push(['Aircraft', plan.aircraftName]);
    if (plan.aircraftType) acRows.push(['Type', plan.aircraftType]);
    if (plan.emptyWeightKg) acRows.push(['Empty weight', `${plan.emptyWeightKg.toFixed(0)} kg  /  ${(plan.emptyWeightKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.mtowKg) acRows.push(['MTOW', `${plan.mtowKg.toFixed(0)} kg  /  ${(plan.mtowKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.fuelCapacityL) acRows.push(['Fuel capacity', `${plan.fuelCapacityL.toFixed(0)} L  /  ${(plan.fuelCapacityL * L_TO_GAL_US).toFixed(1)} gal`]);
    if (plan.cruiseSpeedKts) acRows.push(['Cruise speed', `${plan.cruiseSpeedKts} kt`]);

    autoTable(doc, {
      startY: y,
      body: acRows,
      theme: 'plain',
      bodyStyles: { fontSize: 9, textColor: COLORS.text, cellPadding: { top: 1.5, bottom: 1.5, left: 2, right: 2 } },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 36 },
        1: { cellWidth: 'auto' },
      },
      margin: { left: 14, right: 14 },
    });
    y = tableEndY(doc) + 6;
  }

  // ─── WEIGHT ───
  if (plan.takeoffWeightKg || plan.payloadKg) {
    y = checkPage(doc, y, 30);
    y = sectionTitle(doc, 'WEIGHT & BALANCE', y);

    const weightRows: string[][] = [];
    if (plan.emptyWeightKg) weightRows.push(['Empty weight', `${plan.emptyWeightKg.toFixed(0)} kg`, `${(plan.emptyWeightKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.payloadKg) weightRows.push(['Payload', `${plan.payloadKg.toFixed(0)} kg`, `${(plan.payloadKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.fuelCurrentTotal) {
      const fuelKg = plan.fuelCurrentTotal * AVGAS_KG_PER_L;
      weightRows.push(['Fuel', `${fuelKg.toFixed(0)} kg`, `${(fuelKg * KG_TO_LBS).toFixed(0)} lbs`]);
    }
    if (plan.takeoffWeightKg) {
      weightRows.push(['Takeoff weight', `${plan.takeoffWeightKg.toFixed(0)} kg`, `${(plan.takeoffWeightKg * KG_TO_LBS).toFixed(0)} lbs`]);
    }
    if (plan.mtowKg && plan.takeoffWeightKg) {
      weightRows.push(['MTOW', `${plan.mtowKg.toFixed(0)} kg`, `${(plan.mtowKg * KG_TO_LBS).toFixed(0)} lbs`]);
      const margin = plan.mtowKg - plan.takeoffWeightKg;
      weightRows.push(['Margin', `${margin >= 0 ? '+' : ''}${margin.toFixed(0)} kg`, margin >= 0 ? 'Within limits' : 'OVER MTOW']);
    }

    autoTable(doc, {
      startY: y,
      head: [['Item', 'Metric', 'Imperial']],
      body: weightRows,
      theme: 'grid',
      headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 9, textColor: COLORS.text },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 40 },
        1: { cellWidth: 40, halign: 'right' },
        2: { cellWidth: 40, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'body') {
          const label = weightRows[data.row.index]?.[0];
          if (label === 'Takeoff weight') {
            data.cell.styles.fontStyle = 'bold';
          }
          if (label === 'Margin') {
            const margin = plan.mtowKg && plan.takeoffWeightKg ? plan.mtowKg - plan.takeoffWeightKg : 0;
            if (margin < 0) data.cell.styles.textColor = [220, 38, 38];
            else data.cell.styles.textColor = [22, 163, 74];
          }
        }
      },
    });
    y = tableEndY(doc) + 6;
  }

  // ─── FUEL PLANNING ───
  if (plan.fuelConsumptionPerHour || plan.tripFuelKg) {
    y = checkPage(doc, y, 55);
    y = sectionTitle(doc, 'FUEL PLANNING', y);

    const fuelRows: string[][] = [];

    if (plan.fuelConsumptionPerHour) {
      const c = fuelConvert(plan.fuelConsumptionPerHour);
      fuelRows.push(['Consumption/h', `${c.kg} kg`, `${c.liters} L`, `${c.gal} gal`]);
    }

    // Fuel breakdown
    if (plan.tripFuelKg) {
      const tf = fmtKg(plan.tripFuelKg);
      fuelRows.push([`Trip fuel${plan.tripMinutes ? ` (${formatMinutes(plan.tripMinutes)})` : ''}`, `${tf.kg} kg`, `${tf.liters} L`, `${tf.gal} gal`]);
    }
    if (plan.altFuelKg && plan.altDistanceNm) {
      const af = fmtKg(plan.altFuelKg);
      fuelRows.push([`Alternate (${plan.altDistanceNm.toFixed(0)} NM)`, `${af.kg} kg`, `${af.liters} L`, `${af.gal} gal`]);
    }
    if (plan.contingencyFuelKg && plan.contingencyPct) {
      const cf = fmtKg(plan.contingencyFuelKg);
      fuelRows.push([`Contingency (${plan.contingencyPct}%)`, `${cf.kg} kg`, `${cf.liters} L`, `${cf.gal} gal`]);
    }
    if (plan.reserveFuelKg) {
      const rf = fmtKg(plan.reserveFuelKg);
      fuelRows.push([`Reserve (${plan.fuelReserveMinutes ?? ''} min)`, `${rf.kg} kg`, `${rf.liters} L`, `${rf.gal} gal`]);
    }
    if (plan.minFuelKg) {
      const mf = fmtKg(plan.minFuelKg);
      fuelRows.push(['Min. required', `${mf.kg} kg`, `${mf.liters} L`, `${mf.gal} gal`]);
    }

    // Separator — on board / endurance
    if (plan.fuelCurrentTotal) {
      const ob = fuelConvert(plan.fuelCurrentTotal);
      fuelRows.push(['On board', `${ob.kg} kg`, `${ob.liters} L`, `${ob.gal} gal`]);
    }
    if (plan.fuelPerWing) {
      const pw = fuelConvert(plan.fuelPerWing);
      fuelRows.push(['Per wing', `${pw.kg} kg`, `${pw.liters} L`, `${pw.gal} gal`]);
    }
    if (plan.enduranceMinutes) {
      fuelRows.push(['Endurance', formatMinutes(plan.enduranceMinutes), '', '']);
    }

    const minFuelIdx = fuelRows.findIndex((r) => r[0] === 'Min. required');
    const onBoardIdx = fuelRows.findIndex((r) => r[0] === 'On board');

    autoTable(doc, {
      startY: y,
      head: [['Item', 'Weight', 'Volume', 'US Gal']],
      body: fuelRows,
      theme: 'grid',
      headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 9, textColor: COLORS.text },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles: {
        0: { fontStyle: 'bold', cellWidth: 44 },
        1: { cellWidth: 32, halign: 'right' },
        2: { cellWidth: 32, halign: 'right' },
        3: { cellWidth: 32, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'body') {
          if (data.row.index === minFuelIdx || data.row.index === onBoardIdx) {
            data.cell.styles.fontStyle = 'bold';
          }
        }
      },
    });
    y = tableEndY(doc) + 6;
  }

  // ─── VISUAL REFERENCES ───
  if (plan.visualReferences && plan.visualReferences.length > 0) {
    y = checkPage(doc, y, 15 + plan.visualReferences.length * 6);
    y = sectionTitle(doc, 'VISUAL REFERENCES', y);

    const refRows = plan.visualReferences
      .sort((a, b) => a.sequence - b.sequence)
      .map((ref, i) => [
        String(i + 1),
        ref.name,
        ref.distanceNm != null ? `${ref.distanceNm.toFixed(1)} NM` : '—',
        ref.timeMin != null ? `${ref.timeMin} min` : '—',
      ]);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Reference', 'Distance', 'Time']],
      body: refRows,
      theme: 'grid',
      headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 8 },
      bodyStyles: { fontSize: 9, textColor: COLORS.text },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles: {
        0: { cellWidth: 10, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 28, halign: 'center' },
        3: { cellWidth: 24, halign: 'center' },
      },
      margin: { left: 14, right: 14 },
    });
    y = tableEndY(doc) + 6;
  }

  // ─── AI VALIDATION ───
  if (aiValidation) {
    const statusLabel = aiValidation.overallStatus === 'pass' ? 'APROVADO' : aiValidation.overallStatus === 'warnings' ? 'ATENÇÃO' : 'PROBLEMAS';
    const statusColor: [number, number, number] = aiValidation.overallStatus === 'pass' ? [22, 163, 74] : aiValidation.overallStatus === 'warnings' ? [217, 119, 6] : [220, 38, 38];

    doc.addPage();
    y = 15;

    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.headerText);
    doc.text('REVISÃO DO INSTRUTOR IA', 14, 12);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(statusLabel, 196, 12, { align: 'right' });

    y = 28;

    const itemStatusColor = (status: string): [number, number, number] =>
      status === 'pass' ? [22, 163, 74] : status === 'warn' ? [217, 119, 6] : [220, 38, 38];

    const itemStatusIcon = (status: string): string =>
      status === 'pass' ? 'OK' : status === 'warn' ? '!!' : 'XX';

    for (const item of aiValidation.items) {
      y = checkPage(doc, y, 16);

      // Category badge
      const color = itemStatusColor(item.status);
      doc.setFillColor(...color);
      doc.roundedRect(14, y - 3.5, 2, 10, 1, 1, 'F');

      doc.setFontSize(7);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...color);
      doc.text(`${itemStatusIcon(item.status)} ${item.category}`, 19, y);

      // Title
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...COLORS.text);
      doc.text(sanitizeText(item.title), 19, y + 5);

      y += 12;

      // Description — render markdown with tables
      y = renderMarkdownToPdf(doc, item.description, y, 19, 173, checkPage);

      y += 2;
    }

    // Summary
    y = checkPage(doc, y, 20);
    y += 3;
    doc.setDrawColor(...statusColor);
    doc.setLineWidth(0.5);
    doc.line(14, y, 196, y);
    y += 5;

    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(...COLORS.text);
    y = renderMarkdownToPdf(doc, aiValidation.summary, y, 16, 178, checkPage);
    y += 4;
  }

  // ─── FLIGHT VIABILITY ───
  if (viability) {
    const statusLabels: Record<string, string> = {
      'viable': 'VIABLE',
      'viable-with-warnings': 'VIABLE WITH REMARKS',
      'incomplete': 'INCOMPLETE',
      'not-viable': 'NOT VIABLE',
      'unverifiable': 'UNVERIFIABLE',
    };
    const statusColors: Record<string, [number, number, number]> = {
      'viable': [22, 163, 74],
      'viable-with-warnings': [217, 119, 6],
      'incomplete': [234, 88, 12],
      'not-viable': [220, 38, 38],
      'unverifiable': [120, 130, 150],
    };
    const color = statusColors[viability.status] ?? COLORS.muted;
    y = checkPage(doc, y, 12 + viability.items.length * 5);
    y = sectionTitle(doc, 'FLIGHT VIABILITY', y);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...color);
    doc.text(statusLabels[viability.status] ?? viability.status.toUpperCase(), 14, y);
    y += 5;

    if (viability.items.length > 0) {
      const severityColors: Record<string, [number, number, number]> = {
        blocking: [220, 38, 38],
        actionable: [234, 88, 12],
        warning: [217, 119, 6],
        unverifiable: [120, 130, 150],
      };

      for (const item of viability.items) {
        y = checkPage(doc, y, 8);
        const ic = severityColors[item.severity] ?? COLORS.muted;
        doc.setFillColor(...ic);
        doc.circle(16, y - 1, 1, 'F');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...COLORS.text);
        const msgLines = doc.splitTextToSize(item.message, 174);
        doc.text(msgLines, 20, y);
        y += msgLines.length * 3.5 + 2;
      }
    }
    y += 4;
  }

  // ─── NOTES AREA ───
  y = checkPage(doc, y, 30);
  y = sectionTitle(doc, 'NOTES', y);
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  for (let i = 0; i < 5; i++) {
    doc.line(14, y + i * 6, 196, y + i * 6);
  }

  // ─── FOOTER ───
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COLORS.muted);
    doc.text(`FS Suite — Generated ${now.toISOString().slice(0, 16).replace('T', ' ')} UTC`, 14, 290);
    doc.text(`Page ${i}/${pageCount}`, 196, 290, { align: 'right' });
  }

  return doc;
}

export function exportFlightPlanPdf(plan: VfrPlanData): void {
  const doc = buildFlightPlanDoc(plan);
  const filename = `flight-plan_${plan.originIcao}-${plan.destinationIcao}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.pdf`;
  doc.save(filename);
}

export interface ExportAttachments {
  chartUrls: string[];
  checklistUrl?: string;
}

async function fetchPdfBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

export async function exportFlightPlanWithAttachments(
  plan: VfrPlanData,
  attachments: ExportAttachments,
  mapImageDataUrl?: string,
  aiValidation?: AiValidationResult,
  viability?: PlanViability,
): Promise<void> {
  const doc = buildFlightPlanDoc(plan, mapImageDataUrl, aiValidation, viability);
  const mainBytes = doc.output('arraybuffer');

  const merged = await PDFDocument.create();

  const mainDoc = await PDFDocument.load(mainBytes);
  const mainPages = await merged.copyPages(mainDoc, mainDoc.getPageIndices());
  mainPages.forEach((p) => merged.addPage(p));

  if (attachments.checklistUrl) {
    const bytes = await fetchPdfBytes(attachments.checklistUrl);
    if (bytes) {
      try {
        const ext = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const pages = await merged.copyPages(ext, ext.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      } catch { /* skip */ }
    }
  }

  for (const url of attachments.chartUrls) {
    const bytes = await fetchPdfBytes(url);
    if (!bytes) continue;
    try {
      const ext = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await merged.copyPages(ext, ext.getPageIndices());
      pages.forEach((p) => merged.addPage(p));
    } catch { /* skip */ }
  }

  const finalBytes = await merged.save();

  const blob = new Blob([finalBytes] as unknown as [Blob], { type: 'application/pdf' } as BlobOptions);
  const blobUrl = URL.createObjectURL(blob);
  const filename = `flight-plan_${plan.originIcao}-${plan.destinationIcao}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.pdf`;

  const doc2 = (globalThis as unknown as { document: { createElement: (tag: string) => { href: string; download: string; click: () => void } } }).document;
  const anchor = doc2.createElement('a');
  anchor.href = blobUrl;
  anchor.download = filename;
  anchor.click();
}
