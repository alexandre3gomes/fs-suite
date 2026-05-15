import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

// --------------- Types ---------------

export interface AerodromeChart {
  /** Chart type: ADC, VAC, PDC, IAC, SID, STAR, etc. */
  type: string;
  /** Human-readable name */
  name: string;
  /** Direct URL to the chart PDF */
  url: string;
  /** Source authority */
  source: string;
}

export interface ChartSearchResult {
  icao: string;
  charts: AerodromeChart[];
  /** Links to external pages where the user can browse charts */
  externalLinks: { label: string; url: string }[];
}

// --------------- ICAO prefix → region mapping ---------------

interface RegionConfig {
  prefixes: string[];
  fetch: (icao: string, svc: ChartsService) => Promise<AerodromeChart[]>;
  links: (icao: string) => { label: string; url: string }[];
}

// ORDER MATTERS: more specific prefixes must come before generic ones (e.g. 'EF' before 'E')
const REGIONS: RegionConfig[] = [
  // ---- Americas ----
  {
    prefixes: ['SB', 'SD', 'SI', 'SJ', 'SN', 'SS', 'SW'],
    fetch: fetchBrazilCharts,
    links: (icao) => [
      { label: 'AISWEB Cartas', url: `https://aisweb.decea.mil.br/?i=cartas&codigo=${icao}` },
    ],
  },
  {
    prefixes: ['K', 'PA', 'PH', 'PB', 'PF', 'PM', 'PP', 'TJ'],
    fetch: fetchFaaCharts,
    links: (icao) => [
      { label: 'FAA DTPP', url: `https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/dtpp/search/results/?cycle=current&ident=${icao}` },
      { label: 'AirNav', url: `https://www.airnav.com/airport/${icao}` },
    ],
  },
  // ---- Europe — specific countries with chart fetchers ----
  {
    prefixes: ['LE', 'GC', 'GE'],
    fetch: fetchSpainCharts,
    links: (icao) => [
      { label: 'ENAIRE AIP', url: `https://aip.enaire.es/AIP/contenido_AIP/AD/AD2/${icao}/index.html` },
    ],
  },
  {
    prefixes: ['LP'],
    fetch: fetchPortugalCharts,
    links: (_icao) => [
      { label: 'NAV Portugal', url: `https://ais.nav.pt/online-eaip-en/` },
    ],
  },
  {
    prefixes: ['LO'],
    fetch: fetchAustriaCharts,
    links: (_icao) => [
      { label: 'Austro Control', url: `https://eaip.austrocontrol.at/` },
    ],
  },
  {
    prefixes: ['EF'],
    fetch: fetchFinlandCharts,
    links: (_icao) => [
      { label: 'Fintraffic ANS', url: `https://ais.fi/` },
    ],
  },
  {
    prefixes: ['EP'],
    fetch: fetchPolandCharts,
    links: (_icao) => [
      { label: 'PANSA eAIP', url: `https://www.ais.pansa.pl/en/publications/eaip/` },
    ],
  },
  {
    prefixes: ['ES'],
    fetch: fetchSwedenCharts,
    links: (_icao) => [
      { label: 'LFV AIP', url: `https://aro.lfv.se/Editorial/View/IAIP` },
    ],
  },
  {
    prefixes: ['EN'],
    fetch: fetchNorwayCharts,
    links: (_icao) => [
      { label: 'Avinor AIP', url: `https://ais.avinor.no/` },
    ],
  },
  // ---- Europe — external links only ----
  {
    prefixes: ['LF'],
    fetch: async () => [],
    links: () => [{ label: 'SIA France', url: `https://www.sia.aviation-civile.gouv.fr/` }],
  },
  {
    prefixes: ['E', 'L'],
    fetch: async () => [],
    links: () => [{ label: 'OpenAIP', url: `https://www.openaip.net/` }],
  },
];

function globalLinks(icao: string): { label: string; url: string }[] {
  return [
    { label: 'ChartFox', url: `https://chartfox.org/${icao}` },
    { label: 'SkyVector', url: `https://skyvector.com/airport/${icao}` },
  ];
}

// --------------- Shared helpers ---------------

const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; FSSuite/1.0)' };

const TYPE_ORDER: Record<string, number> = {
  ADC: 0, PDC: 1, VAC: 2, INFO: 3, IAC: 4, SID: 5, STAR: 6, MIN: 7, OTHER: 8,
};

function sortCharts(charts: AerodromeChart[]): AerodromeChart[] {
  return charts.sort((a, b) => {
    const oa = TYPE_ORDER[a.type] ?? 99;
    const ob = TYPE_ORDER[b.type] ?? 99;
    return oa !== ob ? oa - ob : a.name.localeCompare(b.name);
  });
}

export function getAiracCycle(date: Date = new Date()): { cycle: string; effectiveDate: Date } {
  const EPOCH = new Date('2015-01-08T00:00:00Z').getTime();
  const MS_PER_DAY = 86400000;
  const daysSinceEpoch = Math.floor((date.getTime() - EPOCH) / MS_PER_DAY);
  const totalCycles = Math.floor(daysSinceEpoch / 28);
  const cycleStart = new Date(EPOCH + totalCycles * 28 * MS_PER_DAY);
  const year = cycleStart.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const daysFromEpochToJan1 = Math.floor((jan1.getTime() - EPOCH) / MS_PER_DAY);
  let firstCycleIdx = Math.floor(daysFromEpochToJan1 / 28);
  if (new Date(EPOCH + firstCycleIdx * 28 * MS_PER_DAY) < jan1) firstCycleIdx++;
  const cycleInYear = totalCycles - firstCycleIdx + 1;
  const yy = String(year % 100).padStart(2, '0');
  const nn = String(cycleInYear).padStart(2, '0');
  return { cycle: `${yy}${nn}`, effectiveDate: cycleStart };
}

/** Classify a chart type from its filename/path using common European eAIP naming */
function classifyEaipChart(name: string): string {
  const n = name.toUpperCase();
  if (/\bADC\b/.test(n) || /\bAD.CHART\b/.test(n) || /AERODROME.CHART/.test(n)) return 'ADC';
  if (/\bGMC\b/.test(n) || /\bAPDC\b/.test(n) || /GROUND.MOVEMENT/.test(n) || /PARKING/.test(n)) return 'PDC';
  if (/\bVAC\b/.test(n) || /VISUAL.APPROACH/.test(n)) return 'VAC';
  if (/\bSID\b/.test(n) || /SIDR\b/.test(n) || /\bDEP\b/.test(n) || /OMNIDEP/.test(n)) return 'SID';
  if (/\bSTAR\b/.test(n)) return 'STAR';
  if (/\bILS\b/.test(n) || /\bLOC\b/.test(n) || /\bVOR\b/.test(n) || /\bNDB\b/.test(n) || /\bRNP\b/.test(n) || /\bRNAV\b/.test(n) || /\bIAC\b/.test(n)) return 'IAC';
  if (/\bAOC\b/.test(n) || /OBSTACLE/.test(n) || /PATC/.test(n) || /TERRAIN/.test(n)) return 'INFO';
  if (/\bMARK\b/.test(n) || /\bSMAC\b/.test(n) || /\bATCSMAC\b/.test(n) || /\bARC\b/.test(n)) return 'INFO';
  if (/\bMIN\b/.test(n)) return 'MIN';
  // Austrian MAP numbering: MAP 1=ADC, 2-3=PDC, 4-7=INFO, 9=SID, 11=STAR, 12=INFO, 13=IAC, 14=VAC
  const mapMatch = n.match(/MAP\s+(\d+)/);
  if (mapMatch) {
    const m = parseInt(mapMatch[1]!, 10);
    if (m === 1) return 'ADC';
    if (m === 2 || m === 3) return 'PDC';
    if (m >= 4 && m <= 8) return 'INFO';
    if (m === 9 || m === 10) return 'SID';
    if (m === 11) return 'STAR';
    if (m === 12) return 'INFO';
    if (m === 13) return 'IAC';
    if (m === 14) return 'VAC';
  }
  return 'OTHER';
}

/** Generic helper: fetch an eAIP HTML page and extract PDF links */
async function scrapeEaipPage(
  pageUrl: string,
  baseUrl: string,
  source: string,
  icao: string,
  svc: ChartsService,
): Promise<AerodromeChart[]> {
  const resp = await fetch(pageUrl, {
    headers: FETCH_HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) {
    svc.log.warn(`${source} page returned ${resp.status} for ${icao}`);
    return [];
  }

  const html = await resp.text();
  // Capture href AND optional link text: <a href="...pdf">Link Text</a>
  const pattern = /href="([^"]*\.pdf)"[^>]*>([^<]*)</gi;
  const charts: AerodromeChart[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const href = match[1]!;
    const linkText = match[2]?.trim() ?? '';
    if (seen.has(href)) continue;
    seen.add(href);

    const fullUrl = href.startsWith('http') ? href : new URL(href, baseUrl).href;
    const filename = decodeURIComponent(fullUrl.split('/').pop() ?? href);
    const cleanFilename = filename.replace(/\.pdf$/i, '').replace(/[-_]/g, ' ');
    // Prefer link text over filename, but skip if link text is a path (contains / or ends .pdf)
    const useLinkText = linkText && !linkText.includes('/') && !linkText.endsWith('.pdf');
    const name = useLinkText ? linkText : cleanFilename;
    charts.push({ type: classifyEaipChart(useLinkText ? linkText : filename), name, url: fullUrl, source });
  }

  return sortCharts(charts);
}

// --------------- Brazil — DECEA AISWEB ---------------

const AISWEB_BASE = 'https://aisweb.decea.mil.br';

function classifyBrazilChart(name: string): string {
  const n = name.toUpperCase();
  if (n.startsWith('ADC') || n.includes(' ADC')) return 'ADC';
  if (n.startsWith('PDC') || n.includes(' PDC')) return 'PDC';
  if (n.startsWith('VAC') || n.includes(' VAC')) return 'VAC';
  if (n.startsWith('ILS') || n.startsWith('LOC')) return 'IAC';
  if (n.startsWith('VOR') && n.includes('RWY')) return 'IAC';
  if (n.startsWith('NDB') && n.includes('RWY')) return 'IAC';
  if (n.startsWith('RNP') && n.includes('RWY')) return 'IAC';
  if (/^RWY\s/.test(n)) return 'VAC';
  if (n.startsWith('RNAV') && /RWY/.test(n) && /\d+[A-Z]\s/.test(n)) return 'SID';
  if (n.startsWith('RNAV') && /RWY/.test(n)) return 'STAR';
  if (n.startsWith('OMNI')) return 'IAC';
  if (n.startsWith('AD 2')) return 'INFO';
  return 'OTHER';
}

async function fetchBrazilCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const url = `${AISWEB_BASE}/?i=aerodromos&codigo=${icao}`;
    const resp = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) { svc.log.warn(`AISWEB returned ${resp.status} for ${icao}`); return []; }

    const html = await resp.text();
    const pattern = /href="(https:\/\/aisweb\.decea\.gov\.br\/download\/\?arquivo=[^"]+)"[^>]*>\s*([^<]+)/g;
    const charts: AerodromeChart[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(html)) !== null) {
      const chartUrl = match[1]!.replace(/&amp;/g, '&');
      const name = match[2]!.trim();
      if (!name || seen.has(chartUrl)) continue;
      seen.add(chartUrl);
      charts.push({ type: classifyBrazilChart(name), name, url: chartUrl, source: 'DECEA AISWEB' });
    }
    return sortCharts(charts);
  } catch (err) {
    svc.log.warn(`AISWEB scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- USA — FAA DTPP ---------------

const FAA_DTPP_BASE = 'https://aeronav.faa.gov/d-tpp';

function classifyFaaChart(code: string): string {
  switch (code) {
    case 'APD': return 'ADC';
    case 'IAP': return 'IAC';
    case 'DP': return 'SID';
    case 'STAR': return 'STAR';
    case 'ODP': return 'SID';
    case 'MIN': return 'MIN';
    case 'HOT': case 'LAH': case 'DAU': return 'INFO';
    default: return 'OTHER';
  }
}

async function fetchFaaCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const { cycle } = getAiracCycle();
    const faaIdent = icao.startsWith('K') && icao.length === 4 ? icao.slice(1) : icao;
    const metaXml = await svc.getFaaMetafile(cycle);
    if (!metaXml) return [];

    const icaoEsc = icao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const faaEsc = faaIdent.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const airportPattern = new RegExp(
      `<airport_name[^>]*(?:icao_ident="${icaoEsc}"|apt_ident="${faaEsc}")[^>]*>([\\s\\S]*?)</airport_name>`, 'gi',
    );

    const charts: AerodromeChart[] = [];
    let airportMatch: RegExpExecArray | null;
    while ((airportMatch = airportPattern.exec(metaXml)) !== null) {
      const block = airportMatch[1]!;
      const recordPattern = /<record>([\s\S]*?)<\/record>/g;
      let recMatch: RegExpExecArray | null;
      while ((recMatch = recordPattern.exec(block)) !== null) {
        const rec = recMatch[1]!;
        const chartCode = rec.match(/<chart_code>([^<]*)<\/chart_code>/)?.[1]?.trim() ?? '';
        const chartName = rec.match(/<chart_name>([^<]*)<\/chart_name>/)?.[1]?.trim() ?? '';
        const pdfName = rec.match(/<pdf_name>([^<]*)<\/pdf_name>/)?.[1]?.trim() ?? '';
        const useraction = rec.match(/<useraction>([^<]*)<\/useraction>/)?.[1]?.trim() ?? '';
        if (!pdfName || useraction === 'D') continue;
        charts.push({ type: classifyFaaChart(chartCode), name: chartName || chartCode, url: `${FAA_DTPP_BASE}/${cycle}/${pdfName}`, source: 'FAA DTPP' });
      }
    }
    return sortCharts(charts);
  } catch (err) {
    svc.log.warn(`FAA DTPP fetch failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Spain — ENAIRE AIP ---------------

const ENAIRE_BASE = 'https://aip.enaire.es/AIP';

async function fetchSpainCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const indexHtml = await svc.getEnaireIndex();
    if (!indexHtml) return [];

    const icaoEsc = icao.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(contenido_AIP/AD/AD2/${icaoEsc}/[^"]+\\.pdf)`, 'gi');
    const charts: AerodromeChart[] = [];
    const seen = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(indexHtml)) !== null) {
      const relPath = match[1]!;
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      const fullUrl = `${ENAIRE_BASE}/${relPath}`;
      const filename = relPath.split('/').pop() ?? relPath;
      const type = classifyEnairePdf(filename);
      const name = humanizeEnairePdf(filename, icao);
      charts.push({ type, name, url: fullUrl, source: 'ENAIRE' });
    }
    return sortCharts(charts);
  } catch (err) {
    svc.log.warn(`ENAIRE scrape failed for ${icao}: ${err}`);
    return [];
  }
}

function classifyEnairePdf(filename: string): string {
  const f = filename.toUpperCase();
  if (f.includes('_ADC')) return 'ADC';
  if (f.includes('_GMC')) return 'PDC';
  if (f.includes('_PDC')) return 'PDC';
  if (f.includes('_SID')) return 'SID';
  if (f.includes('_STAR')) return 'STAR';
  if (f.includes('_IAC') || f.includes('_ILS') || f.includes('_LOC') || f.includes('_VOR') || f.includes('_RNAV') || f.includes('_RNP')) return 'IAC';
  if (f.includes('_VAC') || f.includes('_VPT')) return 'VAC';
  if (f.includes('_TXT') || f.includes('_DATA') || f.includes('_AOC') || f.includes('_PATC')) return 'INFO';
  return 'OTHER';
}

function humanizeEnairePdf(filename: string, icao: string): string {
  return filename.replace(/\.pdf$/i, '').replace(new RegExp(`.*${icao}_`, 'i'), '').replace(/_en$/i, '').replace(/_/g, ' ') || filename;
}

// --------------- Portugal — NAV Portugal ---------------

async function fetchPortugalCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const pageUrl = `https://ais.nav.pt/wp-content/uploads/AIS_Files/eAIP_Current/eAIP_Online/eAIP/html/eAIP/LP-AD-2.${icao}-en-GB.html`;
    const baseUrl = `https://ais.nav.pt/wp-content/uploads/AIS_Files/eAIP_Current/eAIP_Online/eAIP/html/eAIP/`;
    return await scrapeEaipPage(pageUrl, baseUrl, 'NAV Portugal', icao, svc);
  } catch (err) {
    svc.log.warn(`NAV Portugal scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Austria — Austro Control ---------------

async function fetchAustriaCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    // Discover AIRAC date from the landing page
    const airacDate = await svc.getAustriaAiracDate();
    if (!airacDate) return [];

    const icaoLower = icao.toLowerCase();
    const pageUrl = `https://eaip.austrocontrol.at/lo/${airacDate}/ad_2_${icaoLower}.htm`;
    const baseUrl = `https://eaip.austrocontrol.at/lo/${airacDate}/`;
    return await scrapeEaipPage(pageUrl, baseUrl, 'Austro Control', icao, svc);
  } catch (err) {
    svc.log.warn(`Austro Control scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Finland — Fintraffic ANS ---------------

async function fetchFinlandCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const airacDir = await svc.getFinlandAiracDir();
    if (!airacDir) return [];

    // Finland eAIP uses city names in the page URL, so we scrape the chart directory instead
    const chartDirUrl = `https://ais.fi/eaip/${airacDir}/documents/Root_WePub/ANSFI/Charts/AD/${icao}/`;
    const resp = await fetch(chartDirUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });

    if (resp.ok) {
      // Directory listing available — extract PDFs
      const html = await resp.text();
      const pattern = /href="([^"]*\.pdf)"/gi;
      const charts: AerodromeChart[] = [];
      const seen = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(html)) !== null) {
        const href = match[1]!;
        if (seen.has(href)) continue;
        seen.add(href);
        const fullUrl = href.startsWith('http') ? href : new URL(href, chartDirUrl).href;
        const filename = decodeURIComponent(href.split('/').pop() ?? href);
        const name = filename.replace(/\.pdf$/i, '').replace(new RegExp(`^EF_AD_2_${icao}_`, 'i'), '').replace(/[-_]/g, ' ');
        charts.push({ type: classifyEaipChart(filename), name, url: fullUrl, source: 'Fintraffic ANS' });
      }
      if (charts.length > 0) return sortCharts(charts);
    }

    // Fallback: try known chart types directly
    const chartBase = `https://ais.fi/eaip/${airacDir}/documents/Root_WePub/ANSFI/Charts/AD/${icao}/EF_AD_2_${icao}`;
    const types = ['ADC', 'VAC', 'APDC', 'MARK'];
    const charts: AerodromeChart[] = [];
    for (const t of types) {
      const url = `${chartBase}_${t}.pdf`;
      const head = await fetch(url, { method: 'HEAD', headers: FETCH_HEADERS, signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (head?.ok) charts.push({ type: classifyEaipChart(t), name: t, url, source: 'Fintraffic ANS' });
    }
    return sortCharts(charts);
  } catch (err) {
    svc.log.warn(`Fintraffic ANS scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Poland — PANSA ---------------

async function fetchPolandCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const airacDir = await svc.getPolandAiracDir();
    if (!airacDir) return [];

    const pageUrl = `https://www.ais.pansa.pl/eAIPIFR/${airacDir}/eAIP/AD%202%20${icao}%201-en-GB.html`;
    const baseUrl = `https://www.ais.pansa.pl/eAIPIFR/${airacDir}/eAIP/`;
    return await scrapeEaipPage(pageUrl, baseUrl, 'PANSA', icao, svc);
  } catch (err) {
    svc.log.warn(`PANSA scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Sweden — LFV ---------------

async function fetchSwedenCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const airacDir = await svc.getSwedenAiracDir();
    if (!airacDir) return [];

    // Step 1: resolve the airport page filename via the datasource.js menu
    const pageFile = await svc.getSwedenAirportPage(airacDir, icao);
    if (!pageFile) return [];

    // Step 2: fetch the airport eAIP page and extract PDF links
    const baseUrl = `https://aro.lfv.se/content/eaip/${airacDir}/eAIP/`;
    const pageUrl = `${baseUrl}${encodeURIComponent(pageFile).replace(/%20/g, '%20')}`;
    const resp = await fetch(pageUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(12000) });
    if (!resp.ok) {
      svc.log.warn(`LFV airport page returned ${resp.status} for ${icao}`);
      return [];
    }

    const html = await resp.text();
    const charts: AerodromeChart[] = [];
    const seen = new Set<string>();
    const linkPattern = /href="([^"]*\.pdf)"/gi;
    let match: RegExpExecArray | null;
    while ((match = linkPattern.exec(html)) !== null) {
      const href = match[1]!;
      if (seen.has(href)) continue;
      seen.add(href);
      const fullUrl = new URL(href, pageUrl).href;
      const filename = decodeURIComponent(fullUrl.split('/').pop() ?? href);
      const name = filename.replace(/\.pdf$/i, '');
      charts.push({ type: classifyEaipChart(filename), name, url: fullUrl, source: 'LFV Sweden' });
    }

    return sortCharts(charts);
  } catch (err) {
    svc.log.warn(`LFV Sweden scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Norway — Avinor ---------------

async function fetchNorwayCharts(icao: string, svc: ChartsService): Promise<AerodromeChart[]> {
  try {
    const airacInfo = await svc.getNorwayAiracInfo();
    if (!airacInfo) return [];

    const pageUrl = `${airacInfo.base}/html/eAIP/EN-AD-2.${icao}-no-NO.html`;
    const baseUrl = `${airacInfo.base}/html/eAIP/`;
    return await scrapeEaipPage(pageUrl, baseUrl, 'Avinor', icao, svc);
  } catch (err) {
    svc.log.warn(`Avinor scrape failed for ${icao}: ${err}`);
    return [];
  }
}

// --------------- Service ---------------

const CACHE_TTL = 3600; // 1 hour
const INDEX_CACHE_TTL = 86400; // 24 hours

@Injectable()
export class ChartsService {
  readonly log = new Logger(ChartsService.name);

  constructor(private readonly redis: RedisService) {}

  getEnv(key: string): string | undefined {
    return process.env[key];
  }

  // ---- Cached index fetchers ----

  async getEnaireIndex(): Promise<string | null> {
    return this.cachedFetch('enaire-aip-index', `${ENAIRE_BASE}/`, 'ENAIRE AIP index');
  }

  async getFaaMetafile(cycle: string): Promise<string | null> {
    return this.cachedFetch(`faa-dtpp-meta:${cycle}`, `${FAA_DTPP_BASE}/${cycle}/xml_data/d-tpp_Metafile.xml`, `FAA DTPP metafile (cycle ${cycle})`, 30000);
  }

  async getAustriaAiracDate(): Promise<string | null> {
    const client = this.redis.getClient();
    const cacheKey = 'austria-airac-date';
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    try {
      const resp = await fetch('https://eaip.austrocontrol.at/', { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const html = await resp.text();
      // Find current AIRAC link: ./lo/260417/index.htm
      const match = html.match(/\.\/lo\/(\d{6})\/index\.htm/);
      if (!match) return null;
      const date = match[1]!;
      await client.setEx(cacheKey, INDEX_CACHE_TTL, date).catch(() => {});
      return date;
    } catch (err) {
      this.log.warn(`Austria AIRAC date fetch failed: ${err}`);
      return null;
    }
  }

  async getFinlandAiracDir(): Promise<string | null> {
    const client = this.redis.getClient();
    const cacheKey = 'finland-airac-dir';
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    try {
      const resp = await fetch('https://ais.fi/eaip/', { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const html = await resp.text();
      // Find latest AIRAC dir: 002-2026_2026_04_16
      const match = html.match(/(\d{3}-\d{4}_\d{4}_\d{2}_\d{2})/);
      if (!match) return null;
      const dir = match[1]!;
      await client.setEx(cacheKey, INDEX_CACHE_TTL, dir).catch(() => {});
      return dir;
    } catch (err) {
      this.log.warn(`Finland AIRAC dir fetch failed: ${err}`);
      return null;
    }
  }

  async getPolandAiracDir(): Promise<string | null> {
    const client = this.redis.getClient();
    const cacheKey = 'poland-airac-dir';
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    try {
      const resp = await fetch('https://www.ais.pansa.pl/eAIPIFR/', { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const html = await resp.text();
      // Find latest AIRAC dir: AIRAC AMDT 10-25_2025_10_02
      const match = html.match(/(AIRAC%20AMDT%20\d+-\d+_\d+_\d+_\d+)/);
      if (!match) {
        const decoded = html.match(/(AIRAC AMDT \d+-\d+_\d+_\d+_\d+)/);
        if (!decoded) return null;
        const dir = encodeURIComponent(decoded[1]!);
        await client.setEx(cacheKey, INDEX_CACHE_TTL, dir).catch(() => {});
        return dir;
      }
      const dir = match[1]!;
      await client.setEx(cacheKey, INDEX_CACHE_TTL, dir).catch(() => {});
      return dir;
    } catch (err) {
      this.log.warn(`Poland AIRAC dir fetch failed: ${err}`);
      return null;
    }
  }

  async getSwedenAiracDir(): Promise<string | null> {
    const client = this.redis.getClient();
    const cacheKey = 'sweden-airac-dir';
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    try {
      const resp = await fetch('https://aro.lfv.se/content/eaip/default_offline.html', { headers: FETCH_HEADERS, signal: AbortSignal.timeout(10000) });
      if (!resp.ok) return null;
      const html = await resp.text();
      // Find AIRAC dir pattern
      const match = html.match(/(AIRAC%20AIP%20AMDT%20\d+-\d+_\d+_\d+_\d+)/) ??
                     html.match(/(AIRAC AIP AMDT \d+-\d+_\d+_\d+_\d+)/);
      if (!match) return null;
      const dir = match[1]!.includes('%20') ? match[1]! : encodeURIComponent(match[1]!);
      await client.setEx(cacheKey, INDEX_CACHE_TTL, dir).catch(() => {});
      return dir;
    } catch (err) {
      this.log.warn(`Sweden AIRAC dir fetch failed: ${err}`);
      return null;
    }
  }

  /** Resolve the airport HTML page filename from Sweden's datasource.js (cached). */
  async getSwedenAirportPage(airacDir: string, icao: string): Promise<string | null> {
    const client = this.redis.getClient();
    const cacheKey = `sweden-page:${icao}`;
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    const dsUrl = `https://aro.lfv.se/content/eaip/${airacDir}/v2/js/datasource.js`;
    const ds = await this.cachedFetch('sweden-datasource', dsUrl, 'LFV datasource.js');
    if (!ds) return null;

    // Find: "href": "ES-AD 2 ESSA STOCKHOLM-ARLANDA 1-en-GB.html#..."
    const pattern = new RegExp(`"href":\\s*"(ES-AD 2 ${icao} [^"]*?1-en-GB\\.html)`, 'i');
    const match = ds.match(pattern);
    if (!match) return null;

    const pageFile = match[1]!;
    await client.setEx(cacheKey, INDEX_CACHE_TTL, pageFile).catch(() => {});
    return pageFile;
  }

  async getNorwayAiracInfo(): Promise<{ base: string } | null> {
    const client = this.redis.getClient();
    const cacheKey = 'norway-airac-base';
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return { base: cached };

    try {
      const resp = await fetch('https://aim-prod.avinor.no/no/AIP/', {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(10000),
        redirect: 'follow',
      });
      if (!resp.ok) return null;
      const html = await resp.text();

      // Try absolute path first: /no/AIP/View/Index/152/2026-03-19-AIRAC
      let match = html.match(/(\/no\/AIP\/View\/Index\/\d+\/\d{4}-\d{2}-\d{2}-AIRAC)/);
      let base: string;
      if (match) {
        base = `https://aim-prod.avinor.no${match[1]!}`;
      } else {
        // Fallback: relative href like "2026-03-19-AIRAC/html/index-no-NO.html"
        const relMatch = html.match(/href="(\d{4}-\d{2}-\d{2}-AIRAC)\/html/);
        if (!relMatch) return null;
        // Derive parent directory from the final response URL
        const parentDir = resp.url.replace(/\/[^/]*$/, '/');
        base = `${parentDir}${relMatch[1]!}`;
      }

      await client.setEx(cacheKey, INDEX_CACHE_TTL, base).catch(() => {});
      return { base };
    } catch (err) {
      this.log.warn(`Norway AIRAC info fetch failed: ${err}`);
      return null;
    }
  }

  /** Generic cached fetch helper for large index pages */
  private async cachedFetch(cacheKey: string, url: string, label: string, timeout = 15000): Promise<string | null> {
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return cached;

    this.log.log(`Downloading ${label}...`);
    try {
      const resp = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(timeout) });
      if (!resp.ok) { this.log.warn(`${label} returned ${resp.status}`); return null; }
      const text = await resp.text();
      await client.setEx(cacheKey, INDEX_CACHE_TTL, text).catch(() => {});
      this.log.log(`${label} cached (${(text.length / 1024).toFixed(0)} KB)`);
      return text;
    } catch (err) {
      this.log.warn(`${label} download failed: ${err}`);
      return null;
    }
  }

  async searchCharts(icao: string): Promise<ChartSearchResult> {
    const normalized = icao.toUpperCase().trim();
    if (normalized.length < 3 || normalized.length > 4) {
      return { icao: normalized, charts: [], externalLinks: [] };
    }

    const cacheKey = `charts:${normalized}`;
    const client = this.redis.getClient();
    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as ChartSearchResult;

    const region = REGIONS.find((r) => r.prefixes.some((p) => normalized.startsWith(p)));

    let charts: AerodromeChart[] = [];
    try {
      charts = region ? await region.fetch(normalized, this) : [];
    } catch (err) {
      this.log.warn(`Chart fetch failed for ${normalized}: ${err}`);
    }

    const externalLinks = [...(region ? region.links(normalized) : []), ...globalLinks(normalized)];
    const result: ChartSearchResult = { icao: normalized, charts, externalLinks };
    if (charts.length > 0) {
      await client.setEx(cacheKey, CACHE_TTL, JSON.stringify(result)).catch(() => {});
    }
    return result;
  }
}
