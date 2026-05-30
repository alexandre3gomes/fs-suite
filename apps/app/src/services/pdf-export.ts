import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDFDocument } from 'pdf-lib';

import type { VfrPlanData } from '../components/vfr/VfrPlanForm';
import type { ClimbDescentPlan } from '../components/vfr/vfrNavigation';
import type { PlanViability } from '../components/vfr/weatherTimeUtils';
import i18n from '../i18n';

/** Localized lookup for PDF strings. Picks up the app's current language. */
const t = (key: string, params?: Record<string, string | number>): string =>
  i18n.t(`pdf.${key}`, params) as string;

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
  const total = Math.round(min);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, '0')}min` : `${m}min`;
}

function formatLegTime(min: number): string {
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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

export function buildFlightPlanDoc(plan: VfrPlanData, mapImageDataUrl?: string, aiValidation?: AiValidationResult, viability?: PlanViability, climbDescentPlan?: ClimbDescentPlan): jsPDF {
  const doc = new jsPDF('p', 'mm', 'a4');
  const now = new Date();
  const hasIfr = plan.flightRules === 'IFR' || plan.flightRules === 'VFR_IFR' || plan.flightRules === 'IFR_VFR';

  // ─── HEADER ───
  doc.setFillColor(...COLORS.headerBg);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...COLORS.headerText);
  doc.text(t('title'), 14, 14);
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
  y = sectionTitle(doc, t('sectionRoute'), y);

  const routeRows: string[][] = [
    [t('origin'), `${plan.originIcao} — ${plan.originName}`, plan.originRunwayInUse ? `RWY ${plan.originRunwayInUse}` : '', plan.originElevationFt ? `${plan.originElevationFt} ft` : ''],
    [t('destination'), `${plan.destinationIcao} — ${plan.destinationName}`, plan.destinationRunwayInUse ? `RWY ${plan.destinationRunwayInUse}` : '', plan.destinationElevationFt ? `${plan.destinationElevationFt} ft` : ''],
  ];
  if (plan.alternateIcao) {
    routeRows.push([t('alternate'), `${plan.alternateIcao} — ${plan.alternateName ?? ''}`, plan.alternateRunwayInUse ? `RWY ${plan.alternateRunwayInUse}` : '', plan.alternateElevationFt ? `${plan.alternateElevationFt} ft` : '']);
  }

  autoTable(doc, {
    startY: y,
    head: [['', t('aerodrome'), t('runway'), t('elevation')]],
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
    labelValue(doc, `${t('cruiseLevel')}: `, plan.cruiseLevel, 14, y);
    y += 5;
  }
  if (plan.routeText) {
    const routeLabel = `${t('route')}: `;
    doc.setFont('helvetica', 'bold');
    doc.text(routeLabel, 14, y);
    const rW = doc.getTextWidth(routeLabel);
    doc.setFont('helvetica', 'normal');
    const routeLines = doc.splitTextToSize(plan.routeText, 182 - rW);
    doc.text(routeLines[0], 14 + rW, y);
    for (let i = 1; i < routeLines.length; i++) {
      y += 4;
      doc.text(routeLines[i], 14, y);
    }
    y += 5;
  }

  // Alternate route — destination → alternate segment. Not part of ICAO
  // Item 15, but operational data the pilot needs (REA compliance, etc).
  const planAny = plan as unknown as { alternateRouteText?: string; alternateTotalDistanceNm?: number; alternatePlannedAltitude?: number };
  if (plan.alternateIcao && (planAny.alternateRouteText || planAny.alternateTotalDistanceNm)) {
    const altRouteLabel = `${t('alternate')} ${t('route').toLowerCase()}: `;
    doc.setFont('helvetica', 'bold');
    doc.text(altRouteLabel, 14, y);
    const arW = doc.getTextWidth(altRouteLabel);
    doc.setFont('helvetica', 'normal');
    const altText = planAny.alternateRouteText ?? 'DCT';
    const altLines = doc.splitTextToSize(altText, 182 - arW);
    doc.text(altLines[0], 14 + arW, y);
    for (let i = 1; i < altLines.length; i++) {
      y += 4;
      doc.text(altLines[i], 14, y);
    }
    if (planAny.alternateTotalDistanceNm) {
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...COLORS.muted);
      doc.text(`(${planAny.alternateTotalDistanceNm.toFixed(1)} NM${planAny.alternatePlannedAltitude ? `, ${planAny.alternatePlannedAltitude} ft` : ''})`, 14 + arW, y);
      doc.setTextColor(...COLORS.text);
    }
    y += 5;
  }

  if (plan.remarks) {
    const item18Label = `${t('item18')}: `;
    doc.setFont('helvetica', 'bold');
    doc.text(item18Label, 14, y);
    const rmkW = doc.getTextWidth(item18Label);
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
  if (plan.flightCondition) summaryParts.push(plan.flightCondition === 'day' ? t('day') : t('night'));
  if (summaryParts.length > 0) {
    labelValue(doc, `${t('trip')}: `, summaryParts.join('  |  '), 14, y);
    y += 5;
  }

  if (plan.todDistanceNm) {
    labelValue(doc, `${t('tod')}: `, t('todBeforeDest', { nm: plan.todDistanceNm }), 14, y);
    y += 5;
  }
  y += 2;

  // ─── NAVIGATION LOG ───
  if (plan.routeLegs && plan.routeLegs.length > 0) {
    y = checkPage(doc, y, 20 + plan.routeLegs.length * 6);
    y = sectionTitle(doc, t('sectionNavlog'), y);

    const legRows = plan.routeLegs.map((leg, i) => {
      const mh = leg.magneticHeading != null ? `${Math.round(leg.magneticHeading)}°` : `${leg.magneticCourse.toFixed(0)}°`;
      const gs = leg.groundSpeedKts != null ? String(Math.round(leg.groundSpeedKts)) : '—';
      const alt = leg.selectedAltitudeFt != null
        ? (hasIfr
            ? `FL${String(Math.round(leg.selectedAltitudeFt / 100)).padStart(3, '0')}`
            : leg.selectedAltitudeFt.toLocaleString())
        : '—';
      return [
        String(i + 1),
        `${leg.from} > ${leg.to}`,
        leg.distanceNm.toFixed(1),
        mh,
        gs,
        alt,
        leg.timeMin != null ? formatLegTime(leg.timeMin) : '—',
      ];
    });

    // Total row
    legRows.push([
      '',
      t('navlogTotal'),
      plan.totalDistanceNm?.toFixed(1) ?? '',
      '',
      '',
      '',
      plan.tripMinutes ? formatMinutes(plan.tripMinutes) : '',
    ]);

    autoTable(doc, {
      startY: y,
      head: [['#', t('navlogLeg'), 'NM', 'MH', 'GS', t('navlogAlt'), 'ETE']],
      body: legRows,
      theme: 'grid',
      headStyles: { fillColor: COLORS.headerBg, textColor: COLORS.headerText, fontStyle: 'bold', fontSize: 7, halign: 'center' },
      bodyStyles: { fontSize: 8, textColor: COLORS.text },
      alternateRowStyles: { fillColor: COLORS.altRow },
      columnStyles: {
        0: { cellWidth: 8, halign: 'center' },
        1: { cellWidth: 'auto' },
        2: { cellWidth: 16, halign: 'center' },
        3: { cellWidth: 16, halign: 'center' },
        4: { cellWidth: 16, halign: 'center' },
        5: { cellWidth: 26, halign: 'center' },
        6: { cellWidth: 20, halign: 'center' },
      },
      margin: { left: 14, right: 14 },
      didParseCell: (data) => {
        if (data.section === 'head' && data.column.index === 1) {
          data.cell.styles.halign = 'left';
        }
        if (data.section === 'body' && data.row.index === legRows.length - 1) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
    });
    y = tableEndY(doc) + 6;
  }

  // ─── CLIMB & DESCENT PROFILE ───
  if (climbDescentPlan && (climbDescentPlan.toc || climbDescentPlan.tod)) {
    y = checkPage(doc, y, 35);
    y = sectionTitle(doc, t('sectionClimbDescent'), y);
    doc.setFontSize(9);
    doc.setTextColor(...COLORS.text);

    if (climbDescentPlan.toc) {
      const toc = climbDescentPlan.toc;
      doc.setFont('helvetica', 'bold');
      doc.text(t('tocLabel'), 14, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.text(
        t('tocInstruction', { wp: toc.fromWaypoint, time: formatLegTime(toc.timeFromWaypointMin), heading: toc.headingMag }),
        14, y,
      );
      y += 5;
      doc.text(
        t('tocRate', { rate: toc.verticalRateFpm, time: formatLegTime(toc.durationMin), alt: toc.targetAltFt.toLocaleString() }),
        14, y,
      );
      y += 7;
    }

    if (climbDescentPlan.tod) {
      const tod = climbDescentPlan.tod;
      doc.setFont('helvetica', 'bold');
      doc.text(t('todLabel'), 14, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.text(
        t('todInstruction', { wp: tod.fromWaypoint, time: formatLegTime(tod.timeFromWaypointMin), heading: tod.headingMag }),
        14, y,
      );
      y += 5;
      doc.text(
        t('todRate', { rate: tod.verticalRateFpm, time: formatLegTime(tod.durationMin), alt: tod.targetAltFt.toLocaleString(), wp: tod.nextWaypoint }),
        14, y,
      );
      y += 7;
    }
    y += 2;
  }

  // ─── NAVIGATION MAP ───
  if (mapImageDataUrl) {
    y = sectionTitle(doc, t('sectionMap'), checkPage(doc, y, 120));
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
    y = sectionTitle(doc, t('sectionWeather'), y);

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
    y = sectionTitle(doc, t('sectionAircraft'), y);

    const acRows: string[][] = [];
    if (plan.aircraftName) acRows.push([t('aircraftAircraft'), plan.aircraftName]);
    if (plan.aircraftType) acRows.push([t('aircraftType'), plan.aircraftType]);
    if (plan.emptyWeightKg) acRows.push([t('emptyWeight'), `${plan.emptyWeightKg.toFixed(0)} kg  /  ${(plan.emptyWeightKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.mtowKg) acRows.push([t('mtow'), `${plan.mtowKg.toFixed(0)} kg  /  ${(plan.mtowKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.fuelCapacityL) acRows.push([t('fuelCapacity'), `${plan.fuelCapacityL.toFixed(0)} L  /  ${(plan.fuelCapacityL * L_TO_GAL_US).toFixed(1)} gal`]);
    if (plan.cruiseSpeedKts) acRows.push([t('cruiseSpeed'), `${plan.cruiseSpeedKts} kt`]);

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
    y = sectionTitle(doc, t('sectionWeightBalance'), y);

    // Track row indexes for didParseCell styling — labels are localized so we
    // can't compare against literal strings post-translation.
    const weightRows: string[][] = [];
    let takeoffIdx = -1;
    let marginIdx = -1;
    if (plan.emptyWeightKg) weightRows.push([t('emptyWeight'), `${plan.emptyWeightKg.toFixed(0)} kg`, `${(plan.emptyWeightKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.payloadKg) weightRows.push([t('payload'), `${plan.payloadKg.toFixed(0)} kg`, `${(plan.payloadKg * KG_TO_LBS).toFixed(0)} lbs`]);
    if (plan.fuelCurrentTotal) {
      const fuelKg = plan.fuelCurrentTotal * AVGAS_KG_PER_L;
      weightRows.push([t('fuelLabel'), `${fuelKg.toFixed(0)} kg`, `${(fuelKg * KG_TO_LBS).toFixed(0)} lbs`]);
    }
    if (plan.takeoffWeightKg) {
      takeoffIdx = weightRows.length;
      weightRows.push([t('takeoffWeight'), `${plan.takeoffWeightKg.toFixed(0)} kg`, `${(plan.takeoffWeightKg * KG_TO_LBS).toFixed(0)} lbs`]);
    }
    if (plan.mtowKg && plan.takeoffWeightKg) {
      weightRows.push([t('mtow'), `${plan.mtowKg.toFixed(0)} kg`, `${(plan.mtowKg * KG_TO_LBS).toFixed(0)} lbs`]);
      const margin = plan.mtowKg - plan.takeoffWeightKg;
      marginIdx = weightRows.length;
      weightRows.push([t('margin'), `${margin >= 0 ? '+' : ''}${margin.toFixed(0)} kg`, margin >= 0 ? t('marginWithinLimits') : t('marginOverMtow')]);
    }

    autoTable(doc, {
      startY: y,
      head: [[t('wbItem'), t('wbMetric'), t('wbImperial')]],
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
          if (data.row.index === takeoffIdx) {
            data.cell.styles.fontStyle = 'bold';
          }
          if (data.row.index === marginIdx) {
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
    y = sectionTitle(doc, t('sectionFuel'), y);

    // Track row indexes (rather than localized labels) for didParseCell.
    const fuelRows: string[][] = [];
    let minFuelIdx = -1;
    let onBoardIdx = -1;

    if (plan.fuelConsumptionPerHour) {
      const c = fuelConvert(plan.fuelConsumptionPerHour);
      fuelRows.push([t('fuelConsumption'), `${c.kg} kg`, `${c.liters} L`, `${c.gal} gal`]);
    }

    // Fuel breakdown
    if (plan.tripFuelKg) {
      const tf = fmtKg(plan.tripFuelKg);
      const label = plan.tripMinutes ? t('fuelTripWithTime', { time: formatMinutes(plan.tripMinutes) }) : t('fuelTrip');
      fuelRows.push([label, `${tf.kg} kg`, `${tf.liters} L`, `${tf.gal} gal`]);
    }
    if (plan.altFuelKg && plan.altDistanceNm) {
      const af = fmtKg(plan.altFuelKg);
      fuelRows.push([t('fuelAlt', { nm: plan.altDistanceNm.toFixed(0) }), `${af.kg} kg`, `${af.liters} L`, `${af.gal} gal`]);
    }
    if (plan.contingencyFuelKg && plan.contingencyPct) {
      const cf = fmtKg(plan.contingencyFuelKg);
      fuelRows.push([t('fuelContingency', { pct: plan.contingencyPct }), `${cf.kg} kg`, `${cf.liters} L`, `${cf.gal} gal`]);
    }
    if (plan.reserveFuelKg) {
      const rf = fmtKg(plan.reserveFuelKg);
      fuelRows.push([t('fuelReserve', { min: plan.fuelReserveMinutes ?? '' }), `${rf.kg} kg`, `${rf.liters} L`, `${rf.gal} gal`]);
    }
    if (plan.minFuelKg) {
      const mf = fmtKg(plan.minFuelKg);
      minFuelIdx = fuelRows.length;
      fuelRows.push([t('fuelMinRequired'), `${mf.kg} kg`, `${mf.liters} L`, `${mf.gal} gal`]);
    }

    // Separator — on board / endurance
    if (plan.fuelCurrentTotal) {
      const ob = fuelConvert(plan.fuelCurrentTotal);
      onBoardIdx = fuelRows.length;
      fuelRows.push([t('fuelOnBoard'), `${ob.kg} kg`, `${ob.liters} L`, `${ob.gal} gal`]);
    }
    if (plan.fuelPerWing) {
      const pw = fuelConvert(plan.fuelPerWing);
      fuelRows.push([t('fuelPerWing'), `${pw.kg} kg`, `${pw.liters} L`, `${pw.gal} gal`]);
    }
    if (plan.enduranceMinutes) {
      fuelRows.push([t('fuelEndurance'), formatMinutes(plan.enduranceMinutes), '', '']);
    }

    autoTable(doc, {
      startY: y,
      head: [[t('wbItem'), t('fuelWeight'), t('fuelVolume'), t('fuelUsGal')]],
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
    y = sectionTitle(doc, t('sectionVisualRef'), y);

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
      head: [['#', t('visualRefReference'), t('visualRefDistance'), t('visualRefTime')]],
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
    const statusLabel = aiValidation.overallStatus === 'pass' ? t('aiStatusPass') : aiValidation.overallStatus === 'warnings' ? t('aiStatusWarnings') : t('aiStatusFail');
    const statusColor: [number, number, number] = aiValidation.overallStatus === 'pass' ? [22, 163, 74] : aiValidation.overallStatus === 'warnings' ? [217, 119, 6] : [220, 38, 38];

    doc.addPage();
    y = 15;

    doc.setFillColor(...COLORS.headerBg);
    doc.rect(0, 0, 210, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...COLORS.headerText);
    doc.text(t('sectionAiReview'), 14, 12);
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
      'viable': t('viabilityViable'),
      'viable-with-warnings': t('viabilityViableWithWarnings'),
      'incomplete': t('viabilityIncomplete'),
      'not-viable': t('viabilityNotViable'),
      'unverifiable': t('viabilityUnverifiable'),
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
    y = sectionTitle(doc, t('sectionViability'), y);

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
  y = sectionTitle(doc, t('sectionNotes'), y);
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
    doc.text(t('footerGenerated', { datetime: now.toISOString().slice(0, 16).replace('T', ' ') }), 14, 290);
    doc.text(t('footerPage', { current: i, total: pageCount }), 196, 290, { align: 'right' });
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
  climbDescentPlan?: ClimbDescentPlan,
): Promise<void> {
  const doc = buildFlightPlanDoc(plan, mapImageDataUrl, aiValidation, viability, climbDescentPlan);
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
