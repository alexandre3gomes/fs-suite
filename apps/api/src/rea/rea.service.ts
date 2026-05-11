import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../redis/redis.service';

// DECEA GeoAISWEB WFS base
const GEOAISWEB_WFS = 'https://geoaisweb.decea.mil.br/geoserver/ICA/ows';

// Cache for 7 days (REA data changes with AIRAC cycles ~28 days)
const CACHE_TTL = 7 * 24 * 3600;

// Cache chart URL discovery for 24 hours
const CHART_URL_CACHE_TTL = 24 * 3600;

const FETCH_HEADERS = {
  'User-Agent': 'FSsuite/1.0 (flight planning)',
  Accept: 'application/json',
};

// AISWEB visual charts page — source for current REA PDF URLs
const AISWEB_CHARTS_PAGE = 'https://aisweb.decea.mil.br/?i=cartas&p=visuais';

// REA region identifiers — maps DECEA WFS layer suffix to chart metadata
// pdfPrefix is used to match dynamically discovered PDF URLs from AISWEB
const REA_REGIONS: Record<string, { layer: string; chartName: string; pdfPrefix: string }> = {
  XP1_SAO_PAULO: {
    layer: 'ICA:CV_REA_XP1_SAO_PAULO',
    chartName: 'TMA São Paulo 1',
    pdfPrefix: 'ccv-rea-xp1-sao-paulo',
  },
  XP2_SAO_PAULO: {
    layer: 'ICA:CV_REA_XP2_SAO_PAULO',
    chartName: 'TMA São Paulo 2',
    pdfPrefix: 'ccv-rea-xp2-sao-paulo',
  },
  WJ1_RIO_DE_JANEIRO: {
    layer: 'ICA:CV_REA_WJ1_RIO_DE_JANEIRO',
    chartName: 'TMA Rio de Janeiro',
    pdfPrefix: 'ccv-rea-wj1-rio-de-janeiro',
  },
  WH_BELO_HORIZONTE: {
    layer: 'ICA:CV_REA_WH_BELO_HORIZONTE',
    chartName: 'TMA Belo Horizonte',
    pdfPrefix: 'ccv-rea-wh-belo-horizonte',
  },
  WR_BRASILIA: {
    layer: 'ICA:CV_REA_WR_BRASILIA',
    chartName: 'TMA Brasília',
    pdfPrefix: 'ccv-rea-wr-brasilia',
  },
  WT_CURITIBA: {
    layer: 'ICA:CV_REA_WT_CURITIBA',
    chartName: 'TMA Curitiba',
    pdfPrefix: 'ccv-rea-wt-curitiba',
  },
  WP1_PORTO_ALEGRE: {
    layer: 'ICA:CV_REA_WP1_PORTO_ALEGRE',
    chartName: 'TMA Porto Alegre',
    pdfPrefix: 'ccv-rea-wp-porto-alegre',
  },
  XF_FLORIANOPOLIS: {
    layer: 'ICA:CV_REA_XF_FLORIANOPOLIS',
    chartName: 'TMA Florianópolis',
    pdfPrefix: 'ccv-rea-xf-florianopolis',
  },
  XS_SALVADOR: {
    layer: 'ICA:CV_REA_XS_SALVADOR',
    chartName: 'TMA Salvador',
    pdfPrefix: 'ccv-rea-xs-salvador',
  },
  WF_RECIFE: {
    layer: 'ICA:CV_REA_WF_RECIFE',
    chartName: 'TMA Recife',
    pdfPrefix: 'ccv-rea-wf-recife',
  },
  WZ_FORTALEZA: {
    layer: 'ICA:CV_REA_WZ_FORTALEZA',
    chartName: 'TMA Fortaleza',
    pdfPrefix: 'ccv-rea-wz-fortaleza',
  },
  WB_BELEM: {
    layer: 'ICA:CV_REA_WB_BELEM',
    chartName: 'TMA Belém',
    pdfPrefix: 'ccv-rea-wb-belem',
  },
  WN_MANAUS: {
    layer: 'ICA:CV_REA_WN_MANAUS',
    chartName: 'TMA Manaus',
    pdfPrefix: 'ccv-rea-wn2-manaus',
  },
  XT_NATAL: {
    layer: 'ICA:CV_REA_XT_NATAL',
    chartName: 'TMA Natal',
    pdfPrefix: 'ccv-rea-xt-natal',
  },
  WS_SAO_LUIS: {
    layer: 'ICA:CV_REA_WS_SAO_LUIS',
    chartName: 'TMA São Luís',
    pdfPrefix: 'ccv-rea-ws-sao-luis',
  },
  WY_CUIABA: {
    layer: 'ICA:CV_REA_WY_CUIABA',
    chartName: 'TMA Cuiabá',
    pdfPrefix: 'ccv-rea-wy-cuiaba',
  },
  WG_CAMPO_GRANDE: {
    layer: 'ICA:CV_REA_WG_CAMPO_GRANDE',
    chartName: 'TMA Campo Grande',
    pdfPrefix: 'ccv-rea-wg-campo-grande',
  },
  WX_SANTAREM: {
    layer: 'ICA:CV_REA_WX_SANTAREM',
    chartName: 'TMA Santarém',
    pdfPrefix: 'ccv-rea-wx-santarem',
  },
  XR_VITORIA: {
    layer: 'ICA:CV_REA_XR_VITORIA',
    chartName: 'TMA Vitória',
    pdfPrefix: 'ccv-rea-xr-vitoria',
  },
  XN_ANAPOLIS: {
    layer: 'ICA:CV_REA_XN_ANAPOLIS',
    chartName: 'TMA Anápolis',
    pdfPrefix: 'ccv-rea-xn-anapolis',
  },
  XQ_RIBEIRAO_PRETO: {
    layer: 'ICA:CV_REA_XQ_RIBEIRAO_PRETO',
    chartName: 'TMA Ribeirão Preto',
    pdfPrefix: 'ribeirao_preto',
  },
  XO_LONDRINA: {
    layer: 'ICA:CV_REA_XO_LONDRINA',
    chartName: 'TMA Londrina',
    pdfPrefix: 'londrina',
  },
  WK_PORTO_SEGURO: {
    layer: 'ICA:CV_REA_WK_PORTO_SEGURO',
    chartName: 'TMA Porto Seguro',
    pdfPrefix: 'ccv-rea-wk-porto-seguro',
  },
  PI_PARINTINS: {
    layer: 'ICA:CV_REA_PI_PARINTINS',
    chartName: 'TMA Parintins',
    pdfPrefix: 'ccv-rea-pi-parintins',
  },
  XK_MACAPA: {
    layer: 'ICA:CV_REA_XK_MACAPA',
    chartName: 'TMA Macapá',
    pdfPrefix: 'ccv-rea-xk-macapa',
  },
  WA_TABATINGA: {
    layer: 'ICA:CV_REA_WA_TABATINGA',
    chartName: 'TMA Tabatinga',
    pdfPrefix: 'ccv-rea-wa-tabatinga',
  },
};

// ---- GeoJSON types ----

export interface ReaSegment {
  id: number;
  tipo: 'Obrig' | 'Recom';
  nome: string;
  trecho: number;
  classe: string;
  fca: string;
  ats: string;
  semiLargura: number;
  rumoAtoB: number | null;
  rumoBtoA: number | null;
  altMaxAtoB: number;
  altMinAtoB: number;
  altMaxBtoA: number;
  altMinBtoA: number;
  altComp: number | null;
  altCompAtoB: number | null;
  altCompBtoA: number | null;
  fixoA: { lat: number; lon: number; nome: string };
  fixoB: { lat: number; lon: number; nome: string };
  cartaNome: string;
  efetivacao: string;
  identificador: string;
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
}

export interface ReaRegionData {
  regionId: string;
  chartName: string;
  chartPdfUrl: string;
  segments: ReaSegment[];
}

export interface ReaDetectionResult {
  regions: {
    regionId: string;
    chartName: string;
    chartPdfUrl: string;
    hasMandatory: boolean;
    corridors: {
      name: string;
      tipo: 'Obrig' | 'Recom';
      segments: ReaSegment[];
    }[];
  }[];
}

@Injectable()
export class ReaService {
  private readonly logger = new Logger(ReaService.name);

  constructor(private readonly redis: RedisService) {}

  /**
   * Discover current REA chart PDF URLs from the AISWEB visual charts page.
   * URLs contain AIRAC date suffixes that change periodically.
   * Results are cached in Redis for 24 hours.
   */
  async discoverChartUrls(): Promise<Map<string, string>> {
    const cacheKey = 'rea:chart-urls';
    const client = this.redis.getClient();

    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return new Map(JSON.parse(cached));
      } catch { /* refetch */ }
    }

    const urlMap = new Map<string, string>();

    try {
      this.logger.log('Discovering REA chart URLs from AISWEB');
      const resp = await fetch(AISWEB_CHARTS_PAGE, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FSSuite/1.0)' },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        this.logger.warn(`AISWEB charts page returned ${resp.status}`);
        return urlMap;
      }

      const html = await resp.text();
      // Extract all REA chart PDF links
      const linkRegex = /href="([^"]*\/cartas\/visuais\/rea\/[^"]+\.pdf)"/gi;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(html)) !== null) {
        const href = match[1]!;
        const fullUrl = href.startsWith('http')
          ? href
          : `https://aisweb.decea.mil.br${href.startsWith('/') ? '' : '/'}${href}`;

        // Match against known region prefixes
        for (const [regionId, region] of Object.entries(REA_REGIONS)) {
          if (fullUrl.toLowerCase().includes(region.pdfPrefix)) {
            urlMap.set(regionId, fullUrl);
            break;
          }
        }
      }

      this.logger.log(`Discovered ${urlMap.size} REA chart URLs`);
      await client.setEx(cacheKey, CHART_URL_CACHE_TTL, JSON.stringify([...urlMap])).catch(() => {});
    } catch (err) {
      this.logger.warn(`Failed to discover REA chart URLs: ${err}`);
    }

    return urlMap;
  }

  /**
   * Fetch all REA segments for a given region from DECEA GeoAISWEB WFS.
   * Results are cached in Redis.
   */
  async getRegionData(regionId: string): Promise<ReaRegionData | null> {
    const region = REA_REGIONS[regionId];
    if (!region) return null;

    const cacheKey = `rea:region:${regionId}`;
    const client = this.redis.getClient();

    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        // corrupted cache, refetch
      }
    }

    try {
      const url = new URL(GEOAISWEB_WFS);
      url.searchParams.set('service', 'WFS');
      url.searchParams.set('version', '1.0.0');
      url.searchParams.set('request', 'GetFeature');
      url.searchParams.set('typeName', region.layer);
      url.searchParams.set('outputFormat', 'application/json');

      this.logger.log(`Fetching REA data for ${regionId} from DECEA WFS`);
      const resp = await fetch(url.toString(), {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        this.logger.warn(`WFS returned ${resp.status} for ${regionId}`);
        return null;
      }

      const geojson = (await resp.json()) as GeoJSON.FeatureCollection;
      const segments = geojson.features.map((f) => this.parseFeature(f));

      const chartUrls = await this.discoverChartUrls();

      const data: ReaRegionData = {
        regionId,
        chartName: region.chartName,
        chartPdfUrl: chartUrls.get(regionId) ?? '',
        segments,
      };

      await client.setEx(cacheKey, CACHE_TTL, JSON.stringify(data)).catch(() => {});
      return data;
    } catch (err) {
      this.logger.warn(`Failed to fetch REA for ${regionId}: ${err}`);
      return null;
    }
  }

  /**
   * Fetch the complete Brazil REA dataset (all regions in one layer).
   * Used for route intersection detection.
   */
  async getAllRegionsBbox(bbox: { south: number; west: number; north: number; east: number }): Promise<ReaRegionData[]> {
    const cacheKey = `rea:bbox:${bbox.south.toFixed(1)},${bbox.west.toFixed(1)},${bbox.north.toFixed(1)},${bbox.east.toFixed(1)}`;
    const client = this.redis.getClient();

    const cached = await client.get(cacheKey).catch(() => null);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch { /* refetch */ }
    }

    try {
      const url = new URL(GEOAISWEB_WFS);
      url.searchParams.set('service', 'WFS');
      url.searchParams.set('version', '1.0.0');
      url.searchParams.set('request', 'GetFeature');
      url.searchParams.set('typeName', 'ICA:CV_REA_BR_COMPLETO');
      url.searchParams.set('outputFormat', 'application/json');
      // WFS 1.0.0 bbox: minx,miny,maxx,maxy (lon,lat order)
      url.searchParams.set('bbox', `${bbox.west},${bbox.south},${bbox.east},${bbox.north}`);

      this.logger.log(`Fetching REA data within bbox from DECEA WFS`);
      const resp = await fetch(url.toString(), {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(20000),
      });

      if (!resp.ok) {
        this.logger.warn(`WFS bbox query returned ${resp.status}`);
        return [];
      }

      const geojson = (await resp.json()) as GeoJSON.FeatureCollection;
      const segments = geojson.features.map((f) => this.parseFeature(f));

      // Group by carta_nome → region
      const byChart = new Map<string, ReaSegment[]>();
      for (const seg of segments) {
        const existing = byChart.get(seg.cartaNome) ?? [];
        existing.push(seg);
        byChart.set(seg.cartaNome, existing);
      }

      const chartUrls = await this.discoverChartUrls();
      const results: ReaRegionData[] = [];
      for (const [chartNome, segs] of byChart) {
        const regionEntry = Object.entries(REA_REGIONS).find(([key]) => {
          // Normalize both: "XP1-SÃO PAULO" → "XP1" matches "XP1_SAO_PAULO" prefix
          const wfsPrefix = chartNome.split('-')[0]?.trim();
          const regPrefix = key.split('_')[0];
          return wfsPrefix === regPrefix;
        });
        const regionId = regionEntry?.[0] ?? chartNome;
        const region = regionEntry?.[1];

        results.push({
          regionId,
          chartName: region?.chartName ?? chartNome,
          chartPdfUrl: chartUrls.get(regionId) ?? '',
          segments: segs,
        });
      }

      await client.setEx(cacheKey, CACHE_TTL, JSON.stringify(results)).catch(() => {});
      return results;
    } catch (err) {
      this.logger.warn(`Failed to fetch REA bbox: ${err}`);
      return [];
    }
  }

  /**
   * Detect which REA regions a route crosses.
   * Uses a bounding box around the route to fetch nearby REA data,
   * then checks if any segment polygon intersects the route line.
   */
  async detectReaForRoute(
    waypoints: { lat: number; lon: number }[],
  ): Promise<ReaDetectionResult> {
    if (waypoints.length < 2) return { regions: [] };

    // Build route bounding box with 0.5° margin
    const margin = 0.5;
    const lats = waypoints.map((w) => w.lat);
    const lons = waypoints.map((w) => w.lon);
    const bbox = {
      south: Math.min(...lats) - margin,
      west: Math.min(...lons) - margin,
      north: Math.max(...lats) + margin,
      east: Math.max(...lons) + margin,
    };

    const regionDataList = await this.getAllRegionsBbox(bbox);
    if (regionDataList.length === 0) return { regions: [] };

    // Check intersection: does the route line cross any segment polygon?
    const result: ReaDetectionResult = { regions: [] };

    for (const regionData of regionDataList) {
      const origin = waypoints[0]!;
      const dest = waypoints[waypoints.length - 1]!;

      // Polygon intersection: route line crosses corridor polygon
      const intersecting = regionData.segments.filter((seg) =>
        this.routeIntersectsPolygon(waypoints, seg.geometry),
      );

      const matchedNames = new Set<string>();
      for (const seg of intersecting) {
        matchedNames.add(seg.nome);
      }

      // Proximity-based detection: include corridors with a waypoint near origin or destination.
      // An aerodrome near a REA corridor should use that corridor even if the direct route
      // line doesn't geometrically cross its polygon.
      const PROXIMITY_NM = 5;
      for (const seg of regionData.segments) {
        if (matchedNames.has(seg.nome)) continue;
        const dOrigA = this.haversineNm(origin.lat, origin.lon, seg.fixoA.lat, seg.fixoA.lon);
        const dOrigB = this.haversineNm(origin.lat, origin.lon, seg.fixoB.lat, seg.fixoB.lon);
        const dDestA = this.haversineNm(dest.lat, dest.lon, seg.fixoA.lat, seg.fixoA.lon);
        const dDestB = this.haversineNm(dest.lat, dest.lon, seg.fixoB.lat, seg.fixoB.lon);
        if (Math.min(dOrigA, dOrigB, dDestA, dDestB) <= PROXIMITY_NM) {
          matchedNames.add(seg.nome);
        }
      }

      if (matchedNames.size === 0) continue;

      // Collect endpoint coordinates of matched corridors to find entry gates
      const matchedEndpoints = new Set<string>();
      for (const seg of regionData.segments) {
        if (!matchedNames.has(seg.nome)) continue;
        matchedEndpoints.add(`${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`);
        matchedEndpoints.add(`${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`);
      }

      // Count segments per corridor name to identify short connectors (entry gates)
      const segCountByName = new Map<string, number>();
      for (const seg of regionData.segments) {
        segCountByName.set(seg.nome, (segCountByName.get(seg.nome) ?? 0) + 1);
      }

      // Include short connected corridors (≤2 segments) — these are entry gates (Portões).
      for (const seg of regionData.segments) {
        if (matchedNames.has(seg.nome)) continue;
        const count = segCountByName.get(seg.nome) ?? 0;
        if (count > 2) continue;
        const kA = `${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`;
        const kB = `${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`;
        if (matchedEndpoints.has(kA) || matchedEndpoints.has(kB)) {
          matchedNames.add(seg.nome);
        }
      }

      // Include ALL segments of matched + connected corridors
      const byName = new Map<string, ReaSegment[]>();
      for (const seg of regionData.segments) {
        if (!matchedNames.has(seg.nome)) continue;
        const existing = byName.get(seg.nome) ?? [];
        existing.push(seg);
        byName.set(seg.nome, existing);
      }

      const allCorridors = Array.from(byName.entries()).map(([name, segs]) => ({
        name,
        tipo: segs[0]!.tipo,
        segments: segs.sort((a, b) => a.trecho - b.trecho),
      }));

      // Filter corridors by direction efficiency: a corridor is only relevant if
      // following its sub-path makes meaningful progress toward the destination
      const corridors = allCorridors.filter((c) => {
        if (c.segments.length <= 2) return true; // short corridors/gates always pass
        const sorted = c.segments;
        const wps: { lat: number; lon: number }[] = [];
        const seen = new Set<string>();
        for (const seg of sorted) {
          const kA = `${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`;
          if (!seen.has(kA)) { seen.add(kA); wps.push(seg.fixoA); }
          const kB = `${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`;
          if (!seen.has(kB)) { seen.add(kB); wps.push(seg.fixoB); }
        }
        if (wps.length < 2) return true;
        // Find entry (closest to origin) and exit (closest to destination)
        let entryIdx = 0, exitIdx = 0;
        let entryDist = Infinity, exitDist = Infinity;
        for (let i = 0; i < wps.length; i++) {
          const dO = this.haversineNm(origin.lat, origin.lon, wps[i]!.lat, wps[i]!.lon);
          const dD = this.haversineNm(dest.lat, dest.lon, wps[i]!.lat, wps[i]!.lon);
          if (dO < entryDist) { entryDist = dO; entryIdx = i; }
          if (dD < exitDist) { exitDist = dD; exitIdx = i; }
        }
        const subStart = Math.min(entryIdx, exitIdx);
        const subEnd = Math.max(entryIdx, exitIdx);
        const sub = wps.slice(subStart, subEnd + 1);
        if (sub.length < 2) return false;
        const entryToDest = this.haversineNm(sub[0]!.lat, sub[0]!.lon, dest.lat, dest.lon);
        const exitToDest = this.haversineNm(sub[sub.length - 1]!.lat, sub[sub.length - 1]!.lon, dest.lat, dest.lon);
        const progress = Math.abs(entryToDest - exitToDest);
        let pathDist = 0;
        for (let i = 1; i < sub.length; i++) {
          pathDist += this.haversineNm(sub[i - 1]!.lat, sub[i - 1]!.lon, sub[i]!.lat, sub[i]!.lon);
        }
        return pathDist <= 0 || progress / pathDist >= 0.5;
      });

      if (corridors.length === 0) continue;

      result.regions.push({
        regionId: regionData.regionId,
        chartName: regionData.chartName,
        chartPdfUrl: regionData.chartPdfUrl,
        hasMandatory: corridors.some((c) => c.tipo === 'Obrig'),
        corridors,
      });
    }

    return result;
  }

  /** List all known REA regions with chart URLs */
  async listRegions(): Promise<{ regionId: string; chartName: string; chartPdfUrl: string }[]> {
    const chartUrls = await this.discoverChartUrls();
    return Object.entries(REA_REGIONS).map(([id, r]) => ({
      regionId: id,
      chartName: r.chartName,
      chartPdfUrl: chartUrls.get(id) ?? '',
    }));
  }

  // ---- Private helpers ----

  private parseFeature(f: GeoJSON.Feature): ReaSegment {
    const p = f.properties ?? {};
    return {
      id: p.id ?? 0,
      tipo: p.tipo === 'Obrig' ? 'Obrig' : 'Recom',
      nome: p.nome ?? '',
      trecho: p.trecho ?? 0,
      classe: p.classe ?? '',
      fca: p.fca ?? '',
      ats: p.ats ?? '',
      semiLargura: p.semi_largura ?? 0,
      rumoAtoB: p.rumoa_to_b != null ? Number(p.rumoa_to_b) : null,
      rumoBtoA: p.rumob_to_a != null ? Number(p.rumob_to_a) : null,
      altMaxAtoB: p.altmaxa_to_b ?? 0,
      altMinAtoB: p.altmina_to_b ?? 0,
      altMaxBtoA: p.altmaxb_to_a ?? 0,
      altMinBtoA: p.altminb_to_a ?? 0,
      altComp: p.altcomp != null ? Number(p.altcomp) : null,
      altCompAtoB: p.altcompa_to_b != null ? Number(p.altcompa_to_b) : null,
      altCompBtoA: p.altcompb_to_a != null ? Number(p.altcompb_to_a) : null,
      fixoA: { lat: p.fixo_a_lat ?? 0, lon: p.fixo_a_lon ?? 0, nome: p.fixo_a_nome ?? '' },
      fixoB: { lat: p.fixo_b_lat ?? 0, lon: p.fixo_b_lon ?? 0, nome: p.fixo_b_nome ?? '' },
      cartaNome: p.carta_nome ?? '',
      efetivacao: p.efetivacao ?? '',
      identificador: p.identificador ?? '',
      geometry: f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon,
    };
  }

  /**
   * Simplified route-polygon intersection test.
   * Checks if any route segment intersects any edge of the polygon,
   * OR if any route waypoint is inside the polygon.
   */
  private routeIntersectsPolygon(
    waypoints: { lat: number; lon: number }[],
    geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon,
  ): boolean {
    const rings = this.extractRings(geometry);

    // Check if any waypoint is inside any ring
    for (const wp of waypoints) {
      for (const ring of rings) {
        if (this.pointInRing(wp.lat, wp.lon, ring)) return true;
      }
    }

    // Check if any route segment intersects any polygon edge
    for (let i = 0; i < waypoints.length - 1; i++) {
      const a = waypoints[i]!;
      const b = waypoints[i + 1]!;
      for (const ring of rings) {
        for (let j = 0; j < ring.length - 1; j++) {
          const c = ring[j]!;
          const d = ring[j + 1]!;
          if (this.segmentsIntersect(a.lon, a.lat, b.lon, b.lat, c[0]!, c[1]!, d[0]!, d[1]!)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  private extractRings(geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon): number[][][] {
    if (geometry.type === 'Polygon') {
      return geometry.coordinates as number[][][];
    }
    // MultiPolygon: flatten to list of rings (outer rings only)
    return (geometry.coordinates as number[][][][]).map((poly) => poly[0]!);
  }

  private pointInRing(lat: number, lon: number, ring: number[][]): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!, yi = ring[i]![1]!;
      const xj = ring[j]![0]!, yj = ring[j]![1]!;
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  private segmentsIntersect(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
  ): boolean {
    const d1 = this.cross(cx, cy, dx, dy, ax, ay);
    const d2 = this.cross(cx, cy, dx, dy, bx, by);
    const d3 = this.cross(ax, ay, bx, by, cx, cy);
    const d4 = this.cross(ax, ay, bx, by, dx, dy);
    if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
        ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
      return true;
    }
    return false;
  }

  private cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  }

  private haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 3440.065;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
  }
}
