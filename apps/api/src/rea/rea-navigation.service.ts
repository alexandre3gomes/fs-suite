import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { RedisService } from '../redis/redis.service';

import { type ReaSegment, ReaService } from './rea.service';

// ---- Graph types ----

interface GraphNode {
  key: string;
  lat: number;
  lon: number;
  nome: string;
}

interface GraphEdge {
  from: string;
  to: string;
  corridorName: string;
  tipo: 'Obrig' | 'Recom';
  heading: number;
  distanceNm: number;
  altMin: number;
  altMax: number;
  altComp: number | null;
  trecho: number;
  regionId: string;
}

interface ReaGraph {
  nodes: Map<string, GraphNode>;
  adjacency: Map<string, GraphEdge[]>;
  version: string;
  builtAt: number;
}

// ---- Response DTOs ----

export interface RouteLeg {
  from: { lat: number; lon: number; nome: string };
  to: { lat: number; lon: number; nome: string };
  corridorName: string;
  tipo: 'Obrig' | 'Recom';
  heading: number;
  distanceNm: number;
  altMin: number;
  altMax: number;
  altComp: number | null;
}

export interface SuggestRouteResponse {
  found: boolean;
  legs: RouteLeg[];
  waypoints: { lat: number; lon: number; nome: string }[];
  totalDistanceNm: number;
  corridorNames: string[];
  altitudeRange: { min: number; max: number } | null;
  compulsoryAltitude: number | null;
}

export interface RouteViolation {
  legIndex: number;
  from: string;
  to: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidateRouteResponse {
  valid: boolean;
  violations: RouteViolation[];
}

export interface LegAltitudeConstraint {
  legIndex: number;
  from: string;
  to: string;
  corridorName: string | null;
  /** Compulsory altitude (ft MSL) — when set, only this altitude is valid */
  altComp: number | null;
  /** Minimum altitude (ft MSL); 0 means no minimum */
  altMin: number;
  /** Maximum altitude (ft MSL); 0 means no maximum */
  altMax: number;
}

export interface RouteAltitudesResponse {
  legs: LegAltitudeConstraint[];
}

// ---- Constants ----

const GRAPH_MEMORY_TTL_MS = 3600_000; // 1 hour
const SNAP_RADIUS_NM = 10;
const BBOX_MARGIN_DEG = 0.5;

// ---- Service ----

@Injectable()
export class ReaNavigationService {
  private readonly logger = new Logger(ReaNavigationService.name);
  private cachedGraph: ReaGraph | null = null;
  private cachedBboxKey = '';

  constructor(
    private readonly reaService: ReaService,
    private readonly redis: RedisService,
  ) {}

  // ---- Public API ----

  async suggestRoute(
    origin: { lat: number; lon: number },
    dest: { lat: number; lon: number },
    altitude?: number,
  ): Promise<SuggestRouteResponse> {
    const empty: SuggestRouteResponse = {
      found: false,
      legs: [],
      waypoints: [],
      totalDistanceNm: 0,
      corridorNames: [],
      altitudeRange: null,
      compulsoryAltitude: null,
    };

    const graph = await this.getOrBuildGraph(origin, dest);
    if (graph.nodes.size === 0) return empty;

    const originNode = this.snapToGraph(origin.lat, origin.lon, graph);
    if (!originNode) return empty;

    const destCandidates = this.snapCandidates(dest.lat, dest.lon, graph, 6);
    if (destCandidates.length === 0) return empty;

    let bestPath: GraphEdge[] | null = null;
    let bestTotal = Infinity;
    for (const { node: destNode, snapDist } of destCandidates) {
      if (destNode.key === originNode.key) continue;
      const path = this.dijkstra(graph, originNode.key, destNode.key, altitude);
      if (!path || path.length === 0) continue;
      const graphDist = path.reduce((s, e) => s + e.distanceNm, 0);
      const total = graphDist + snapDist;
      if (total < bestTotal) {
        bestTotal = total;
        bestPath = path;
      }
    }

    if (!bestPath) return empty;
    return this.buildResponse(bestPath, graph);
  }

  async validateRoute(
    waypoints: { lat: number; lon: number }[],
    altitude?: number,
  ): Promise<ValidateRouteResponse> {
    if (waypoints.length < 2) return { valid: true, violations: [] };

    const origin = waypoints[0]!;
    const dest = waypoints[waypoints.length - 1]!;
    const graph = await this.getOrBuildGraph(origin, dest);
    if (graph.nodes.size === 0) return { valid: true, violations: [] };

    const violations: RouteViolation[] = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const wpA = waypoints[i]!;
      const wpB = waypoints[i + 1]!;
      const nodeA = this.snapToGraph(wpA.lat, wpA.lon, graph);
      const nodeB = this.snapToGraph(wpB.lat, wpB.lon, graph);

      if (!nodeA) {
        violations.push({
          legIndex: i,
          from: `${wpA.lat.toFixed(4)},${wpA.lon.toFixed(4)}`,
          to: nodeB?.nome ?? '?',
          message: `Ponto de partida fora da malha REA (distância > ${SNAP_RADIUS_NM}NM)`,
          severity: 'warning',
        });
        continue;
      }
      if (!nodeB) {
        violations.push({
          legIndex: i,
          from: nodeA.nome,
          to: `${wpB.lat.toFixed(4)},${wpB.lon.toFixed(4)}`,
          message: `Ponto de destino fora da malha REA (distância > ${SNAP_RADIUS_NM}NM)`,
          severity: 'warning',
        });
        continue;
      }
      if (nodeA.key === nodeB.key) continue;

      const forwardEdge = this.findEdge(graph, nodeA.key, nodeB.key);
      if (forwardEdge) {
        if (altitude != null) {
          if (forwardEdge.altComp != null && altitude !== forwardEdge.altComp) {
            violations.push({
              legIndex: i,
              from: nodeA.nome,
              to: nodeB.nome,
              message: `Altitude compulsória neste trecho: ${forwardEdge.altComp}ft`,
              severity: 'error',
            });
          } else if (forwardEdge.altMin > 0 && forwardEdge.altMax > 0 && (altitude < forwardEdge.altMin || altitude > forwardEdge.altMax)) {
            violations.push({
              legIndex: i,
              from: nodeA.nome,
              to: nodeB.nome,
              message: `Altitude ${altitude}ft fora dos limites (${forwardEdge.altMin}–${forwardEdge.altMax}ft)`,
              severity: 'error',
            });
          }
        }
        continue;
      }

      const reverseEdge = this.findEdge(graph, nodeB.key, nodeA.key);
      if (reverseEdge) {
        violations.push({
          legIndex: i,
          from: nodeA.nome,
          to: nodeB.nome,
          message: `Trecho ${nodeA.nome} → ${nodeB.nome}: sentido proibido neste corredor (${reverseEdge.corridorName})`,
          severity: 'error',
        });
      } else {
        violations.push({
          legIndex: i,
          from: nodeA.nome,
          to: nodeB.nome,
          message: `Trecho ${nodeA.nome} → ${nodeB.nome}: não encontrado na malha REA`,
          severity: 'warning',
        });
      }
    }

    return { valid: violations.filter((v) => v.severity === 'error').length === 0, violations };
  }

  /**
   * For each leg of the route, return the REA altitude constraints (altMin/altMax/altComp)
   * if the leg matches an edge in the REA graph. Returns one entry per leg.
   * Legs that don't match any REA edge get all-zero/null constraints.
   *
   * This allows the client to plan a multi-altitude profile when the corridor
   * has different altitude ranges per segment.
   */
  async getRouteAltitudes(
    waypoints: { lat: number; lon: number }[],
  ): Promise<RouteAltitudesResponse> {
    if (waypoints.length < 2) return { legs: [] };

    const origin = waypoints[0]!;
    const dest = waypoints[waypoints.length - 1]!;
    const graph = await this.getOrBuildGraph(origin, dest);
    const legs: LegAltitudeConstraint[] = [];

    for (let i = 0; i < waypoints.length - 1; i++) {
      const wpA = waypoints[i]!;
      const wpB = waypoints[i + 1]!;
      const nodeA = this.snapToGraph(wpA.lat, wpA.lon, graph);
      const nodeB = this.snapToGraph(wpB.lat, wpB.lon, graph);

      let edge = nodeA && nodeB ? this.findEdge(graph, nodeA.key, nodeB.key) : null;
      if (!edge && nodeA && nodeB) {
        edge = this.findEdge(graph, nodeB.key, nodeA.key);
      }

      legs.push({
        legIndex: i,
        from: nodeA?.nome ?? `${wpA.lat.toFixed(4)},${wpA.lon.toFixed(4)}`,
        to: nodeB?.nome ?? `${wpB.lat.toFixed(4)},${wpB.lon.toFixed(4)}`,
        corridorName: edge?.corridorName ?? null,
        altComp: edge?.altComp ?? null,
        altMin: edge?.altMin ?? 0,
        altMax: edge?.altMax ?? 0,
      });
    }

    return { legs };
  }

  // ---- AIRAC lifecycle ----

  @Cron('0 3 * * *', { timeZone: 'UTC' })
  async checkAiracUpdate(): Promise<void> {
    const sample = await this.reaService.getRegionData('XP1_SAO_PAULO');
    if (!sample?.segments.length) return;

    const latestEfetivacao = sample.segments
      .map((s) => s.efetivacao)
      .filter(Boolean)
      .sort()
      .pop();

    if (this.cachedGraph && latestEfetivacao && this.cachedGraph.version !== latestEfetivacao) {
      this.logger.log(`AIRAC update detected (${this.cachedGraph.version} → ${latestEfetivacao}), clearing graph cache`);
      this.cachedGraph = null;
      this.cachedBboxKey = '';

      const client = this.redis.getClient();
      try {
        const keys = await client.keys('rea:*');
        if (keys.length > 0) {
          await client.del(keys);
          this.logger.log(`Invalidated ${keys.length} REA cache keys`);
        }
      } catch {
        this.logger.warn('Failed to invalidate REA Redis cache');
      }
    }
  }

  // ---- Graph construction ----

  private async getOrBuildGraph(
    origin: { lat: number; lon: number },
    dest: { lat: number; lon: number },
  ): Promise<ReaGraph> {
    const bbox = {
      south: Math.min(origin.lat, dest.lat) - BBOX_MARGIN_DEG,
      west: Math.min(origin.lon, dest.lon) - BBOX_MARGIN_DEG,
      north: Math.max(origin.lat, dest.lat) + BBOX_MARGIN_DEG,
      east: Math.max(origin.lon, dest.lon) + BBOX_MARGIN_DEG,
    };
    const bboxKey = `${bbox.south.toFixed(1)},${bbox.west.toFixed(1)},${bbox.north.toFixed(1)},${bbox.east.toFixed(1)}`;

    if (this.cachedGraph && this.cachedBboxKey === bboxKey && Date.now() - this.cachedGraph.builtAt < GRAPH_MEMORY_TTL_MS) {
      return this.cachedGraph;
    }

    const regionDataList = await this.reaService.getAllRegionsBbox(bbox);
    const graph = this.buildGraph(regionDataList);

    this.cachedGraph = graph;
    this.cachedBboxKey = bboxKey;
    return graph;
  }

  private buildGraph(regionDataList: { regionId: string; segments: ReaSegment[] }[]): ReaGraph {
    const nodes = new Map<string, GraphNode>();
    const adjacency = new Map<string, GraphEdge[]>();
    let latestEfetivacao = '';

    const getOrCreateNode = (fix: { lat: number; lon: number; nome: string }): GraphNode => {
      const key = nodeKey(fix.lat, fix.lon);
      let node = nodes.get(key);
      if (!node) {
        node = { key, lat: fix.lat, lon: fix.lon, nome: fix.nome };
        nodes.set(key, node);
        adjacency.set(key, []);
      }
      if (!node.nome && fix.nome) node.nome = fix.nome;
      return node;
    };

    for (const regionData of regionDataList) {
      for (const seg of regionData.segments) {
        const nA = getOrCreateNode(seg.fixoA);
        const nB = getOrCreateNode(seg.fixoB);
        const dist = haversineNm(seg.fixoA.lat, seg.fixoA.lon, seg.fixoB.lat, seg.fixoB.lon);

        if (seg.efetivacao && seg.efetivacao > latestEfetivacao) {
          latestEfetivacao = seg.efetivacao;
        }

        // Both rumos null = gate/transition segment (Portão) — treat as bidirectional
        const bidirectional = seg.rumoAtoB === null && seg.rumoBtoA === null;

        if (seg.rumoAtoB !== null || bidirectional) {
          const heading = seg.rumoAtoB ?? initialBearing(seg.fixoA.lat, seg.fixoA.lon, seg.fixoB.lat, seg.fixoB.lon);
          adjacency.get(nA.key)!.push({
            from: nA.key,
            to: nB.key,
            corridorName: seg.nome,
            tipo: seg.tipo,
            heading,
            distanceNm: dist,
            altMin: seg.altMinAtoB,
            altMax: seg.altMaxAtoB,
            altComp: seg.altCompAtoB ?? seg.altComp,
            trecho: seg.trecho,
            regionId: regionData.regionId,
          });
        }

        if (seg.rumoBtoA !== null || bidirectional) {
          const heading = seg.rumoBtoA ?? initialBearing(seg.fixoB.lat, seg.fixoB.lon, seg.fixoA.lat, seg.fixoA.lon);
          adjacency.get(nB.key)!.push({
            from: nB.key,
            to: nA.key,
            corridorName: seg.nome,
            tipo: seg.tipo,
            heading,
            distanceNm: dist,
            altMin: seg.altMinBtoA,
            altMax: seg.altMaxBtoA,
            altComp: seg.altCompBtoA ?? seg.altComp,
            trecho: seg.trecho,
            regionId: regionData.regionId,
          });
        }
      }
    }

    this.logger.log(`Built REA graph: ${nodes.size} nodes, ${[...adjacency.values()].reduce((s, e) => s + e.length, 0)} edges`);

    return { nodes, adjacency, version: latestEfetivacao, builtAt: Date.now() };
  }

  // ---- Snapping ----

  private snapToGraph(lat: number, lon: number, graph: ReaGraph): GraphNode | null {
    let best: GraphNode | null = null;
    let bestDist = SNAP_RADIUS_NM;
    for (const node of graph.nodes.values()) {
      const d = haversineNm(lat, lon, node.lat, node.lon);
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  private snapCandidates(lat: number, lon: number, graph: ReaGraph, count: number): { node: GraphNode; snapDist: number }[] {
    const all: { node: GraphNode; snapDist: number }[] = [];
    for (const node of graph.nodes.values()) {
      const d = haversineNm(lat, lon, node.lat, node.lon);
      if (d < SNAP_RADIUS_NM) all.push({ node, snapDist: d });
    }
    return all.sort((a, b) => a.snapDist - b.snapDist).slice(0, count);
  }

  // ---- Dijkstra ----

  private dijkstra(
    graph: ReaGraph,
    fromKey: string,
    toKey: string,
    altitude?: number,
  ): GraphEdge[] | null {
    const dist = new Map<string, number>();
    const prev = new Map<string, { edge: GraphEdge; prevNode: string } | null>();
    const visited = new Set<string>();
    const queue: { key: string; cost: number }[] = [];

    dist.set(fromKey, 0);
    prev.set(fromKey, null);
    queue.push({ key: fromKey, cost: 0 });

    while (queue.length > 0) {
      queue.sort((a, b) => a.cost - b.cost);
      const current = queue.shift()!;
      if (visited.has(current.key)) continue;
      visited.add(current.key);

      if (current.key === toKey) break;

      const edges = graph.adjacency.get(current.key) ?? [];
      const prevEdge = prev.get(current.key)?.edge;

      for (const edge of edges) {
        if (visited.has(edge.to)) continue;

        if (altitude != null) {
          if (edge.altComp != null && edge.altComp !== altitude) continue;
          if (edge.altMin > 0 && edge.altMax > 0 && (altitude < edge.altMin || altitude > edge.altMax)) continue;
        }

        let weight = edge.distanceNm;
        if (edge.tipo === 'Obrig') weight *= 0.8;

        if (prevEdge) {
          const hdiff = angleDiff(prevEdge.heading, edge.heading);
          if (hdiff > 120) weight += 5.0;
          else if (hdiff > 60) weight += 2.0;
        }

        const newCost = (dist.get(current.key) ?? Infinity) + weight;
        if (newCost < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, newCost);
          prev.set(edge.to, { edge, prevNode: current.key });
          queue.push({ key: edge.to, cost: newCost });
        }
      }
    }

    if (!prev.has(toKey)) return null;

    const path: GraphEdge[] = [];
    let current = toKey;
    while (prev.get(current) != null) {
      const entry = prev.get(current)!;
      path.unshift(entry.edge);
      current = entry.prevNode;
    }
    return path.length > 0 ? path : null;
  }

  // ---- Helpers ----

  private findEdge(graph: ReaGraph, fromKey: string, toKey: string): GraphEdge | undefined {
    return (graph.adjacency.get(fromKey) ?? []).find((e) => e.to === toKey);
  }

  private buildResponse(path: GraphEdge[], graph: ReaGraph): SuggestRouteResponse {
    const legs: RouteLeg[] = path.map((e) => ({
      from: { lat: graph.nodes.get(e.from)!.lat, lon: graph.nodes.get(e.from)!.lon, nome: graph.nodes.get(e.from)!.nome },
      to: { lat: graph.nodes.get(e.to)!.lat, lon: graph.nodes.get(e.to)!.lon, nome: graph.nodes.get(e.to)!.nome },
      corridorName: e.corridorName,
      tipo: e.tipo,
      heading: e.heading,
      distanceNm: e.distanceNm,
      altMin: e.altMin,
      altMax: e.altMax,
      altComp: e.altComp,
    }));

    const waypoints: { lat: number; lon: number; nome: string }[] = [];
    const seen = new Set<string>();
    for (const leg of legs) {
      const fk = `${leg.from.lat.toFixed(4)},${leg.from.lon.toFixed(4)}`;
      if (!seen.has(fk)) { seen.add(fk); waypoints.push(leg.from); }
    }
    if (legs.length > 0) {
      const last = legs[legs.length - 1]!;
      const lk = `${last.to.lat.toFixed(4)},${last.to.lon.toFixed(4)}`;
      if (!seen.has(lk)) waypoints.push(last.to);
    }

    const corridorNames: string[] = [];
    for (const leg of legs) {
      if (corridorNames.length === 0 || corridorNames[corridorNames.length - 1] !== leg.corridorName) {
        corridorNames.push(leg.corridorName);
      }
    }

    const totalDistanceNm = legs.reduce((s, l) => s + l.distanceNm, 0);

    let altMin = 0;
    let altMax = Infinity;
    let compulsoryAltitude: number | null = null;
    for (const leg of legs) {
      if (leg.altComp != null) compulsoryAltitude = leg.altComp;
      if (leg.altMin > 0) altMin = Math.max(altMin, leg.altMin);
      if (leg.altMax > 0) altMax = Math.min(altMax, leg.altMax);
    }
    const altitudeRange = altMin > 0 && altMax < Infinity ? { min: altMin, max: altMax } : null;

    return {
      found: true,
      legs,
      waypoints,
      totalDistanceNm: Math.round(totalDistanceNm * 10) / 10,
      corridorNames,
      altitudeRange,
      compulsoryAltitude,
    };
  }
}

// ---- Pure functions ----

function nodeKey(lat: number, lon: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)}`;
}

function haversineNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3440.065;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function angleDiff(a: number, b: number): number {
  const d = ((a - b) % 360 + 360) % 360;
  return d > 180 ? 360 - d : d;
}

function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const toDeg = (r: number): number => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
