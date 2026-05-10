import { Input } from '@fs-suite/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { type AircraftSpec, findAircraftByIcao } from '../../data/aircraftCatalog';
import { getChecklistsForAircraft } from '../../data/checklistCatalog';
import { apiClient } from '../../services/api.client';

import { AerodromeMap } from './AerodromeMap';
import { AerodromeSearch, type Aerodrome } from './AerodromeSearch';
import { AircraftSelect } from './AircraftSelect';
import { ChartsPanel } from './ChartsPanel';
import { ChecklistPanel } from './ChecklistPanel';
import { MetarDisplay, type ParsedMetar } from './MetarDisplay';
import { NearbyPoisPanel } from './NearbyPoisPanel';
import { ReaChartsPanel } from './ReaChartsPanel';
import { SimBriefPanel, type SimBriefOfpData } from './SimBriefPanel';
import { VfrPlanLayout } from './VfrPlanLayout';
import { type RouteWaypoint, buildVfrRouteText, calculateRouteLegs, haversineDistanceNm, suggestCruiseLevel, suggestIfrCruiseLevel, calculateTodDistance, getVfrRuleInfo, filterAltitudesByCloudClearance, type AltitudeClearance } from './vfrNavigation';

// ---------- Types ----------

interface AerodromeWithRunways extends Aerodrome {
  runways: {
    leIdent: string | null;
    leHeadingDeg: number | null;
    heIdent: string | null;
    heHeadingDeg: number | null;
    closed: boolean;
    ident: string;
    lengthFt: number | null;
  }[];
}

export interface VfrPlanData {
  originIcao: string;
  originName: string;
  originElevationFt?: number;
  originRunwayInUse?: string;
  originMetarRaw?: string;
  destinationIcao: string;
  destinationName: string;
  destinationElevationFt?: number;
  destinationRunwayInUse?: string;
  destinationMetarRaw?: string;
  alternateIcao?: string;
  alternateName?: string;
  alternateElevationFt?: number;
  alternateRunwayInUse?: string;
  alternateMetarRaw?: string;
  routeText?: string;
  cruiseLevel?: string;
  todMinutes?: number;
  todDistanceNm?: number;
  aircraftType?: string;
  aircraftName?: string;
  fuelConsumptionPerHour?: number;
  fuelCurrentTotal?: number;
  fuelReserveMinutes?: number;
  fuelRequiredTotal?: number;
  fuelPerWing?: number;
  enduranceMinutes?: number;
  takeoffWeightKg?: number;
  mtowKg?: number;
  visualReferences?: { sequence: number; name: string; distanceNm?: number; timeMin?: number }[];
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  callsign?: string;
  simbriefOfpId?: string;
  status?: 'DRAFT' | 'COMPLETED';
}

const CATEGORY_COLORS: Record<string, string> = {
  VFR: '#16a34a',
  MVFR: '#2563eb',
  IFR: '#dc2626',
  LIFR: '#d946ef',
};

const AVGAS_KG_PER_L = 0.72;
const KG_TO_LBS = 2.20462;
const L_TO_GAL_US = 0.264172;
const NM_TO_KM = 1.852;

function fuelKgConversions(kg: number): string {
  const l = kg / AVGAS_KG_PER_L;
  return `${l.toFixed(1)} L  ·  ${(l * L_TO_GAL_US).toFixed(1)} gal  ·  ${(kg * KG_TO_LBS).toFixed(1)} lbs`;
}

function fuelFlowConversions(kgH: number): string {
  const lH = kgH / AVGAS_KG_PER_L;
  return `${lH.toFixed(1)} L/h  ·  ${(lH * L_TO_GAL_US).toFixed(1)} gal/h  ·  ${(kgH * KG_TO_LBS).toFixed(1)} lbs/h`;
}

interface Props {
  initialData?: VfrPlanData;
  onSave: (data: VfrPlanData) => Promise<void>;
  saving: boolean;
}

// ---------- Component ----------

export function VfrPlanForm({ initialData, onSave, saving }: Props) {
  const { t } = useTranslation();

  // Flight rules
  type FlightRulesType = 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  const FLIGHT_RULES: { value: FlightRulesType; labelKey: string }[] = [
    { value: 'VFR', labelKey: 'vfr.flightRulesVfr' },
    { value: 'IFR', labelKey: 'vfr.flightRulesIfr' },
    { value: 'VFR_IFR', labelKey: 'vfr.flightRulesVfrIfr' },
    { value: 'IFR_VFR', labelKey: 'vfr.flightRulesIfrVfr' },
  ];
  const [flightRules, setFlightRules] = useState<FlightRulesType>(initialData?.flightRules ?? 'VFR');

  const hasVfr = flightRules === 'VFR' || flightRules === 'VFR_IFR' || flightRules === 'IFR_VFR';
  const hasIfr = flightRules === 'IFR' || flightRules === 'VFR_IFR' || flightRules === 'IFR_VFR';

  // Aerodrome state
  const [origin, setOrigin] = useState<Aerodrome | null>(null);
  const [destination, setDestination] = useState<Aerodrome | null>(null);
  const [alternate, setAlternate] = useState<Aerodrome | null>(null);

  // Aerodrome details (with runways)
  const [originDetail, setOriginDetail] = useState<AerodromeWithRunways | null>(null);
  const [destDetail, setDestDetail] = useState<AerodromeWithRunways | null>(null);

  // Map state

  const mapFlyToRef = useRef<(lat: number, lng: number) => void>(null);

  // Route waypoints (intermediate, added via map context menu)
  const [routeWaypoints, setRouteWaypoints] = useState<RouteWaypoint[]>([]);

  // METAR state
  const [metars, setMetars] = useState<Record<string, ParsedMetar>>({});
  const [metarLoading, setMetarLoading] = useState(false);

  // Alternate suggestions
  const [altSuggestions, setAltSuggestions] = useState<(Aerodrome & { distNm: number; flightCategory?: string | null })[]>([]);
  const [altSugLoading, setAltSugLoading] = useState(false);

  // Runway in use
  const [originRunway, setOriginRunway] = useState('');
  const [destRunway, setDestRunway] = useState('');
  const [altRunway, setAltRunway] = useState('');

  // Route
  const [routeText, setRouteText] = useState(initialData?.routeText ?? '');
  const [cruiseLevel, setCruiseLevel] = useState(initialData?.cruiseLevel ?? '');
  const [todMinutes, setTodMinutes] = useState(initialData?.todMinutes?.toString() ?? '');
  const [todDistanceNm, setTodDistanceNm] = useState(initialData?.todDistanceNm?.toString() ?? '');

  // Aircraft & weight
  const [selectedAircraft, setSelectedAircraft] = useState<AircraftSpec | null>(
    initialData?.aircraftType ? findAircraftByIcao(initialData.aircraftType) ?? null : null,
  );
  const [weightMode, setWeightMode] = useState<'simple' | 'advanced'>('simple');
  const [simpleTotalWeight, setSimpleTotalWeight] = useState('');
  const [stationWeights, setStationWeights] = useState<Record<string, string>>({});

  // Fuel
  const [consumptionPerHour, setConsumptionPerHour] = useState(
    initialData?.fuelConsumptionPerHour ? Math.round(initialData.fuelConsumptionPerHour * AVGAS_KG_PER_L).toString() : '',
  );
  const [fuelCurrentTotal, setFuelCurrentTotal] = useState(
    initialData?.fuelCurrentTotal ? Math.round(initialData.fuelCurrentTotal * AVGAS_KG_PER_L).toString() : '',
  );
  const [fuelManuallyEdited, setFuelManuallyEdited] = useState(!!initialData?.fuelCurrentTotal);
  const [flightCondition, setFlightCondition] = useState<'day' | 'night'>(
    initialData?.fuelReserveMinutes === 45 ? 'night' : 'day',
  );
  const [contingencyPct, setContingencyPct] = useState('5');
  const reserveMinutes = flightCondition === 'night' ? 45 : 30;

  // Restore initial aerodromes
  useEffect(() => {
    if (initialData?.originIcao) {
      setOrigin({ icao: initialData.originIcao, name: initialData.originName, iata: null, city: null, country: null, latitude: 0, longitude: 0, elevation: initialData.originElevationFt ?? null, type: null });
      setOriginRunway(initialData.originRunwayInUse ?? '');
    }
    if (initialData?.destinationIcao) {
      setDestination({ icao: initialData.destinationIcao, name: initialData.destinationName, iata: null, city: null, country: null, latitude: 0, longitude: 0, elevation: initialData.destinationElevationFt ?? null, type: null });
      setDestRunway(initialData.destinationRunwayInUse ?? '');
    }
    if (initialData?.alternateIcao) {
      setAlternate({ icao: initialData.alternateIcao, name: initialData.alternateName ?? '', iata: null, city: null, country: null, latitude: 0, longitude: 0, elevation: initialData.alternateElevationFt ?? null, type: null });
      setAltRunway(initialData.alternateRunwayInUse ?? '');
    }
  }, []);

  // Fetch aerodrome detail + METAR when selected
  const fetchAerodromeInfo = useCallback(async (icao: string, role: 'origin' | 'destination') => {
    try {
      const detail = await apiClient.get<AerodromeWithRunways>(`/aerodromes/${icao}`);
      if (role === 'origin') setOriginDetail(detail);
      else setDestDetail(detail);
    } catch { /* ignore */ }
  }, []);

  const fetchMetars = useCallback(async (icaos: string[]) => {
    if (icaos.length === 0) return;
    setMetarLoading(true);
    try {
      const data = await apiClient.get<ParsedMetar[]>(`/weather/metar?icaos=${icaos.join(',')}`);
      const map: Record<string, ParsedMetar> = {};
      for (const m of data) map[m.icaoId] = m;
      setMetars((prev) => ({ ...prev, ...map }));
    } catch { /* ignore */ }
    setMetarLoading(false);
  }, []);

  // Auto-fetch on aerodrome selection + fly map to it
  const handleSelectOrigin = useCallback((a: Aerodrome) => {
    setOrigin(a);
    void fetchAerodromeInfo(a.icao, 'origin');
    mapFlyToRef.current?.(a.latitude, a.longitude);
  }, [fetchAerodromeInfo]);

  const handleSelectDestination = useCallback((a: Aerodrome) => {
    setDestination(a);
    void fetchAerodromeInfo(a.icao, 'destination');
    mapFlyToRef.current?.(a.latitude, a.longitude);
  }, [fetchAerodromeInfo]);

  const handleSelectAlternate = useCallback((a: Aerodrome) => {
    setAlternate(a);
    mapFlyToRef.current?.(a.latitude, a.longitude);
  }, []);

  // Fetch METAR for all selected aerodromes
  useEffect(() => {
    const icaos = [origin?.icao, destination?.icao, alternate?.icao].filter(Boolean) as string[];
    if (icaos.length > 0) void fetchMetars(icaos);
  }, [origin?.icao, destination?.icao, alternate?.icao, fetchMetars]);

  // Auto-suggest runway from METAR wind
  useEffect(() => {
    const originMetar = origin ? metars[origin.icao] : undefined;
    if (origin && originDetail && originMetar) {
      const windDir = originMetar.windDirection;
      if (typeof windDir === 'number' && originDetail.runways.length > 0) {
        const best = suggestRunway(windDir, originDetail.runways);
        if (best && !originRunway) setOriginRunway(best);
      }
    }
  }, [origin, originDetail, metars, originRunway]);

  useEffect(() => {
    const destMetar = destination ? metars[destination.icao] : undefined;
    if (destination && destDetail && destMetar) {
      const windDir = destMetar.windDirection;
      if (typeof windDir === 'number' && destDetail.runways.length > 0) {
        const best = suggestRunway(windDir, destDetail.runways);
        if (best && !destRunway) setDestRunway(best);
      }
    }
  }, [destination, destDetail, metars, destRunway]);

  // Auto-suggest alternate aerodromes when destination changes
  useEffect(() => {
    if (!destination) {
      setAltSuggestions([]);
      return;
    }

    let cancelled = false;
    const fetchAlternates = async () => {
      setAltSugLoading(true);
      try {
        // Bounding box ~50 NM around destination (1° ≈ 60 NM)
        const pad = 0.85;
        const data = await apiClient.get<Aerodrome[]>(
          `/aerodromes/map?south=${destination.latitude - pad}&west=${destination.longitude - pad}&north=${destination.latitude + pad}&east=${destination.longitude + pad}`,
        );
        if (cancelled) return;

        // Compute distances, filter 15–50 NM, exclude origin/destination
        const excludeIcaos = new Set([destination.icao, origin?.icao].filter(Boolean));
        const candidates = data
          .filter((a) => !excludeIcaos.has(a.icao))
          .map((a) => ({
            ...a,
            distNm: haversineDistanceNm(destination.latitude, destination.longitude, a.latitude, a.longitude),
            flightCategory: null as string | null,
          }))
          .filter((a) => a.distNm >= 10 && a.distNm <= 50)
          .sort((a, b) => a.distNm - b.distNm)
          .slice(0, 8);

        // Enrich with METAR flight category (best-effort)
        if (candidates.length > 0) {
          try {
            const icaos = candidates.map((a) => a.icao).join(',');
            const metarData = await apiClient.get<ParsedMetar[]>(`/weather/metar?icaos=${icaos}`);
            if (!cancelled) {
              const catMap = new Map(metarData.map((m) => [m.icaoId, m.flightCategory]));
              for (const c of candidates) c.flightCategory = catMap.get(c.icao) ?? null;
            }
          } catch { /* best-effort */ }
        }

        if (!cancelled) setAltSuggestions(candidates);
      } catch {
        if (!cancelled) setAltSuggestions([]);
      }
      if (!cancelled) setAltSugLoading(false);
    };

    void fetchAlternates();
    return () => { cancelled = true; };
  }, [destination, origin?.icao]);

  // Weight calculations
  const payloadKg = useMemo(() => {
    if (weightMode === 'simple') return parseFloat(simpleTotalWeight) || 0;
    if (!selectedAircraft) return 0;
    return selectedAircraft.stations.reduce(
      (sum, s) => sum + (parseFloat(stationWeights[s.id] ?? '0') || 0),
      0,
    );
  }, [weightMode, simpleTotalWeight, selectedAircraft, stationWeights]);

  // Visual ref expanded state — tracks which leg index is expanded
  const [expandedLegRef, setExpandedLegRef] = useState<number | null>(null);

  // Route waypoint handlers
  const handleAddWaypoint = useCallback((wp: RouteWaypoint) => {
    setRouteWaypoints((prev) => [...prev, wp]);
  }, []);

  const handleRemoveWaypoint = useCallback((idx: number) => {
    setRouteWaypoints((prev) => prev.filter((_, i) => i !== idx));
    setExpandedLegRef(null);
  }, []);

  // Route origin/destination positions for the map
  const routeOriginPos = useMemo(
    () => origin ? { lat: origin.latitude, lng: origin.longitude, name: origin.icao } : null,
    [origin],
  );
  const routeDestPos = useMemo(
    () => destination ? { lat: destination.latitude, lng: destination.longitude, name: destination.icao } : null,
    [destination],
  );
  const routeAltPos = useMemo(
    () => alternate ? { lat: alternate.latitude, lng: alternate.longitude, name: alternate.icao } : null,
    [alternate],
  );

  // Full route legs calculation (origin → waypoints → destination)
  const routeLegs = useMemo(() => {
    const fullWaypoints: RouteWaypoint[] = [];
    if (origin) fullWaypoints.push({ lat: origin.latitude, lng: origin.longitude, name: origin.icao });
    fullWaypoints.push(...routeWaypoints);
    if (destination) fullWaypoints.push({ lat: destination.latitude, lng: destination.longitude, name: destination.icao });
    return calculateRouteLegs(fullWaypoints, origin?.icao, hasIfr);
  }, [origin, destination, routeWaypoints, hasIfr]);

  const totalDistanceNm = useMemo(
    () => routeLegs.reduce((sum, leg) => sum + leg.distanceNm, 0),
    [routeLegs],
  );

  // Fuel calculations (all in kg)
  const consumptionKgH = parseFloat(consumptionPerHour) || 0;
  const fuelOnBoardKg = parseFloat(fuelCurrentTotal) || 0;
  const cruiseKts = selectedAircraft?.cruiseSpeedKts ?? 0;
  // Trip: origin → destination
  const tripHours = cruiseKts > 0 && totalDistanceNm > 0 ? totalDistanceNm / cruiseKts : 0;
  const tripFuelKg = consumptionKgH > 0 && tripHours > 0 ? consumptionKgH * tripHours : 0;
  // Alternate: destination → alternate
  const altDistNm = destination && alternate
    ? haversineDistanceNm(destination.latitude, destination.longitude, alternate.latitude, alternate.longitude)
    : 0;
  const altHours = cruiseKts > 0 && altDistNm > 0 ? altDistNm / cruiseKts : 0;
  const altFuelKg = consumptionKgH > 0 && altHours > 0 ? consumptionKgH * altHours : 0;
  // Contingency: % over trip fuel
  const contingencyFactor = (parseFloat(contingencyPct) || 0) / 100;
  const contingencyFuelKg = tripFuelKg * contingencyFactor;
  // Reserve: RBAC 91.151 — 30 min day / 45 min night
  const reserveFuelKg = consumptionKgH > 0 ? consumptionKgH * (reserveMinutes / 60) : 0;
  // Min fuel = trip + alternate + contingency + reserve
  const minFuelKg = tripFuelKg + altFuelKg + contingencyFuelKg + reserveFuelKg;
  const maxFuelKg = selectedAircraft ? selectedAircraft.fuelCapacityL * AVGAS_KG_PER_L : 0;
  const takeoffWeightKg = selectedAircraft
    ? selectedAircraft.emptyWeightKg + payloadKg + fuelOnBoardKg
    : 0;
  const mtowExcessKg = selectedAircraft
    ? Math.max(0, takeoffWeightKg - selectedAircraft.mtowKg)
    : 0;
  const perWingKg = fuelOnBoardKg > 0 ? fuelOnBoardKg / 2 : 0;
  const enduranceMin = consumptionKgH > 0 ? Math.floor((fuelOnBoardKg / consumptionKgH) * 60) : 0;
  const enduranceHours = Math.floor(enduranceMin / 60);
  const enduranceRemainder = enduranceMin % 60;
  const tripMinutes = Math.round(tripHours * 60);

  // Auto-suggest fuel on board when min fuel is calculable and user hasn't manually edited
  useEffect(() => {
    if (minFuelKg > 0 && !fuelManuallyEdited) {
      setFuelCurrentTotal(Math.ceil(minFuelKg).toString());
    }
  }, [minFuelKg, fuelManuallyEdited]);

  const originCategory = origin ? metars[origin.icao]?.flightCategory : undefined;
  const isImc = originCategory === 'IFR' || originCategory === 'LIFR';

  // Suggested cruise level based on average magnetic course, departure region, and weather
  const cruiseSuggestion = useMemo(
    () => hasIfr
      ? suggestIfrCruiseLevel(routeLegs, origin?.icao)
      : suggestCruiseLevel(routeLegs, origin?.icao, isImc),
    [routeLegs, origin?.icao, hasIfr, isImc],
  );

  const ruleInfo = useMemo(
    () => origin?.icao ? getVfrRuleInfo(origin.icao) : null,
    [origin?.icao],
  );

  const cruiseAltClearance: AltitudeClearance[] | null = useMemo(() => {
    if (!cruiseSuggestion || hasIfr) return null;
    const originMetar = origin ? metars[origin.icao] : undefined;
    if (!originMetar || originMetar.clouds.length === 0) return null;
    const elev = origin?.elevation ?? 0;
    return filterAltitudesByCloudClearance(cruiseSuggestion.altitudes, originMetar.clouds, elev);
  }, [cruiseSuggestion, hasIfr, origin, metars]);

  // Auto-suggest TOD distance for IFR
  const suggestedTodNm = useMemo(() => {
    if (!hasIfr || !cruiseLevel || !destination?.elevation) return null;
    const match = cruiseLevel.match(/^FL(\d{2,3})$/);
    if (!match) return null;
    const altFt = parseInt(match[1]!, 10) * 100;
    return calculateTodDistance(altFt, destination.elevation);
  }, [hasIfr, cruiseLevel, destination?.elevation]);

  // REA detection
  interface ReaDetectionRegion {
    regionId: string;
    chartName: string;
    chartPdfUrl: string;
    hasMandatory: boolean;
    corridors: {
      name: string;
      tipo: 'Obrig' | 'Recom';
      segments: {
        nome: string; tipo: 'Obrig' | 'Recom'; trecho: number;
        fixoA: { lat: number; lon: number; nome: string };
        fixoB: { lat: number; lon: number; nome: string };
        altMinAtoB: number; altMaxAtoB: number; altMinBtoA: number; altMaxBtoA: number;
        fca: string;
        geometry: { type: string; coordinates: number[][][][] | number[][][] };
      }[];
    }[];
  }

  const [reaRegions, setReaRegions] = useState<ReaDetectionRegion[]>([]);
  const [reaLoading, setReaLoading] = useState(false);

  useEffect(() => {
    if (!origin || !destination) { setReaRegions([]); return; }
    // Skip if coordinates not yet available (restored plans with 0,0)
    if (origin.latitude === 0 && origin.longitude === 0) return;
    if (destination.latitude === 0 && destination.longitude === 0) return;

    const waypoints: { lat: number; lon: number }[] = [];
    waypoints.push({ lat: origin.latitude, lon: origin.longitude });
    for (const wp of routeWaypoints) waypoints.push({ lat: wp.lat, lon: wp.lng });
    waypoints.push({ lat: destination.latitude, lon: destination.longitude });

    const wpStr = waypoints.map((w) => `${w.lat}:${w.lon}`).join(',');

    setReaLoading(true);
    apiClient.get<{ regions: ReaDetectionRegion[] }>(`/rea/detect?waypoints=${wpStr}`)
      .then((r) => setReaRegions(r.regions))
      .catch(() => setReaRegions([]))
      .finally(() => setReaLoading(false));
  }, [origin, destination, routeWaypoints]);

  // Flatten all REA segments for map overlay
  const reaMapSegments = useMemo(() => {
    return reaRegions.flatMap((r) => r.corridors.flatMap((c) => c.segments));
  }, [reaRegions]);

  // Auto-generate VFR route text with coordinates
  useEffect(() => {
    const text = buildVfrRouteText(origin?.icao ?? null, routeWaypoints, destination?.icao ?? null);
    setRouteText(text);
  }, [origin?.icao, destination?.icao, routeWaypoints]);

  // Aircraft selection handler
  const handleSelectAircraft = useCallback((aircraft: AircraftSpec) => {
    setSelectedAircraft(aircraft);
    setConsumptionPerHour(Math.round(aircraft.fuelBurnLph * AVGAS_KG_PER_L).toString());
    const defaults: Record<string, string> = {};
    for (const s of aircraft.stations) {
      defaults[s.id] = s.defaultKg.toString();
    }
    setStationWeights(defaults);
  }, []);

  const handleClearAircraft = useCallback(() => {
    setSelectedAircraft(null);
    setStationWeights({});
  }, []);

  // SimBrief state
  const [callsign, setCallsign] = useState(initialData?.callsign ?? '');
  const [simbriefOfpId, setSimbriefOfpId] = useState(initialData?.simbriefOfpId ?? '');

  // OFP PDF for embedded viewer
  const [ofpPdfUrl, setOfpPdfUrl] = useState<string | null>(null);

  const handleSimBriefImport = useCallback((ofp: SimBriefOfpData) => {
    setSimbriefOfpId(ofp.ofpId);
    if (ofp.route) setRouteText(ofp.route);
    if (ofp.callsign) setCallsign(ofp.callsign);

    // Cruise altitude — SimBrief returns feet (e.g. 37000)
    if (ofp.cruiseAltitudeFt != null && ofp.cruiseAltitudeFt > 0) {
      const flNum = Math.round(ofp.cruiseAltitudeFt / 100);
      setCruiseLevel(`FL${String(flNum).padStart(3, '0')}`);
    }

    if (ofp.todDistanceNm != null) {
      setTodDistanceNm(String(Math.round(ofp.todDistanceNm)));
    }

    if (ofp.flightTimeMinutes != null) {
      setTodMinutes(String(Math.max(1, Math.round(ofp.flightTimeMinutes * 0.1))));
    }

    // Runways from OFP
    if (ofp.originRunway) setOriginRunway(ofp.originRunway);
    if (ofp.destinationRunway) setDestRunway(ofp.destinationRunway);
    if (ofp.alternateRunway) setAltRunway(ofp.alternateRunway);

    // Fuel — backend already normalizes to kg
    if (ofp.fuelPlanRampKg != null && ofp.fuelPlanRampKg > 0) {
      setFuelCurrentTotal(String(ofp.fuelPlanRampKg));
      setFuelManuallyEdited(true);
    }

    if (ofp.fuelAvgFlowKgH != null && ofp.fuelAvgFlowKgH > 0) {
      setConsumptionPerHour(String(ofp.fuelAvgFlowKgH));
    }

    // Set alternate from OFP if not already set
    if (ofp.alternateIcao && !alternate) {
      setAlternate({
        icao: ofp.alternateIcao,
        name: ofp.alternateName ?? ofp.alternateIcao,
        iata: null, city: null, country: null,
        latitude: 0, longitude: 0,
        elevation: null, type: null,
      });
    }

    if (ofp.ofpPdfUrl) setOfpPdfUrl(ofp.ofpPdfUrl);
  }, [alternate]);

  // Save
  const handleSave = () => {
    if (!origin || !destination) {
      Alert.alert(t('common.error'), t('vfr.noPlanSelected'));
      return;
    }

    const data: VfrPlanData = {
      flightRules,
      originIcao: origin.icao,
      originName: origin.name,
      originElevationFt: origin.elevation ?? undefined,
      originRunwayInUse: originRunway || undefined,
      originMetarRaw: metars[origin.icao]?.raw,
      destinationIcao: destination.icao,
      destinationName: destination.name,
      destinationElevationFt: destination.elevation ?? undefined,
      destinationRunwayInUse: destRunway || undefined,
      destinationMetarRaw: metars[destination.icao]?.raw,
      alternateIcao: alternate?.icao,
      alternateName: alternate?.name,
      alternateElevationFt: alternate?.elevation ?? undefined,
      alternateRunwayInUse: altRunway || undefined,
      alternateMetarRaw: alternate ? metars[alternate.icao]?.raw : undefined,
      routeText: routeText || undefined,
      cruiseLevel: cruiseLevel || undefined,
      todMinutes: todMinutes ? parseInt(todMinutes, 10) : undefined,
      todDistanceNm: todDistanceNm ? parseFloat(todDistanceNm) : undefined,
      aircraftType: selectedAircraft?.icaoType,
      aircraftName: selectedAircraft ? `${selectedAircraft.manufacturer} ${selectedAircraft.model}` : undefined,
      fuelConsumptionPerHour: consumptionKgH ? consumptionKgH / AVGAS_KG_PER_L : undefined,
      fuelCurrentTotal: fuelOnBoardKg ? fuelOnBoardKg / AVGAS_KG_PER_L : undefined,
      fuelReserveMinutes: reserveMinutes,
      fuelRequiredTotal: minFuelKg ? minFuelKg / AVGAS_KG_PER_L : undefined,
      fuelPerWing: perWingKg ? perWingKg / AVGAS_KG_PER_L : undefined,
      enduranceMinutes: enduranceMin || undefined,
      takeoffWeightKg: takeoffWeightKg || undefined,
      mtowKg: selectedAircraft?.mtowKg,
      callsign: callsign || undefined,
      simbriefOfpId: simbriefOfpId || undefined,
    };

    void onSave(data);
  };

  const mapElement = (
    <AerodromeMap
      onSelectOrigin={handleSelectOrigin}
      onSelectDestination={handleSelectDestination}
      onSelectAlternate={handleSelectAlternate}
      onMapReady={(flyTo) => { (mapFlyToRef as React.MutableRefObject<((lat: number, lng: number) => void) | null>).current = flyTo; }}
      routeOrigin={routeOriginPos}
      routeDestination={routeDestPos}
      routeAlternate={routeAltPos}
      routeWaypoints={routeWaypoints}
      onAddWaypoint={handleAddWaypoint}
      onRemoveWaypoint={handleRemoveWaypoint}
      reaSegments={reaMapSegments}
      flightRules={flightRules}
    />
  );

  const sidebarContent = (onRequestExpand: () => void) => (
    <>
      {/* ====== FLIGHT RULES ====== */}
      <Section title={t('vfr.flightRules')}>
        <View className="flex-row flex-wrap gap-2">
          {FLIGHT_RULES.map((rule) => (
            <Pressable
              key={rule.value}
              onPress={() => setFlightRules(rule.value)}
              className={`rounded-md border px-4 py-2 ${
                flightRules === rule.value
                  ? 'border-primary bg-primary/10'
                  : 'border-border bg-surface-muted'
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  flightRules === rule.value ? 'text-primary' : 'text-foreground'
                }`}
              >
                {t(rule.labelKey)}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>

      {/* ====== AERODROMES ====== */}
      <Section title={t('vfr.aerodromes')}>
        <AerodromeSearch
          label={t('vfr.origin')}
          value={origin}
          onSelect={handleSelectOrigin}
          onClear={() => { setOrigin(null); setOriginDetail(null); setOriginRunway(''); }}
        />
        {origin ? (
          <AerodromeInfo
            aerodrome={origin}
            metar={metars[origin.icao] ?? null}
            metarLoading={metarLoading}
            runway={originRunway}
            onRunwayChange={setOriginRunway}
            flightRules={flightRules}
            onRequestExpand={onRequestExpand}
            t={t}
          />
        ) : null}

        <AerodromeSearch
          label={t('vfr.destination')}
          value={destination}
          onSelect={handleSelectDestination}
          onClear={() => { setDestination(null); setDestDetail(null); setDestRunway(''); }}
        />
        {destination ? (
          <AerodromeInfo
            aerodrome={destination}
            metar={metars[destination.icao] ?? null}
            metarLoading={metarLoading}
            runway={destRunway}
            onRunwayChange={setDestRunway}
            flightRules={flightRules}
            onRequestExpand={onRequestExpand}
            t={t}
          />
        ) : null}

        <AerodromeSearch
          label={`${t('vfr.alternate')} (${t('common.optional')})`}
          value={alternate}
          onSelect={handleSelectAlternate}
          onClear={() => { setAlternate(null); setAltRunway(''); }}
        />

        {/* Alternate suggestions */}
        {!alternate && destination && (altSuggestions.length > 0 || altSugLoading) ? (
          <View className="mb-3 ml-1">
            <Text className="mb-1.5 text-xs font-medium text-muted-foreground">
              {t('vfr.suggestedAlternates')}
            </Text>
            {altSugLoading && altSuggestions.length === 0 ? (
              <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
            ) : (
              <View className="flex-row flex-wrap gap-1.5">
                {altSuggestions.map((sug) => {
                  const catColor = sug.flightCategory
                    ? (CATEGORY_COLORS[sug.flightCategory] ?? undefined)
                    : undefined;
                  return (
                    <Pressable
                      key={sug.icao}
                      className="flex-row items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 active:bg-muted"
                      onPress={() => handleSelectAlternate(sug)}
                    >
                      {catColor ? (
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: catColor }} />
                      ) : null}
                      <Text className="text-xs font-semibold text-foreground">{sug.icao}</Text>
                      <Text className="text-[10px] text-muted-foreground">
                        {sug.distNm.toFixed(0)} NM
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {alternate ? (
          <AerodromeInfo
            aerodrome={alternate}
            metar={metars[alternate.icao] ?? null}
            metarLoading={metarLoading}
            runway={altRunway}
            onRunwayChange={setAltRunway}
            flightRules={flightRules}
            onRequestExpand={onRequestExpand}
            t={t}
          />
        ) : null}
      </Section>

      {/* ====== SIMBRIEF (IFR) ====== */}
      {hasIfr ? (
        <Section title={t('vfr.simbrief')}>
          <SimBriefPanel
            originIcao={origin?.icao ?? null}
            destinationIcao={destination?.icao ?? null}
            alternateIcao={alternate?.icao}
            callsign={callsign}
            onCallsignChange={setCallsign}
            onImport={handleSimBriefImport}
          />
          {ofpPdfUrl ? (
            <OfpViewer pdfUrl={ofpPdfUrl} />
          ) : null}
        </Section>
      ) : null}

      {/* ====== ROUTE ====== */}
      <Section title={t('vfr.route')} info={
        flightRules === 'VFR' ? t('info.routeVfr')
          : flightRules === 'IFR' ? t('info.routeIfr')
          : t('info.routeMixed')
      }>
        <Input
          label={t('vfr.routeText')}
          value={routeText}
          onChangeText={setRouteText}
          placeholder={hasIfr ? 'SID AIRWAY WAYPOINT STAR' : 'DCT SBSP DCT SBGR'}
        />
        {(flightRules === 'VFR_IFR' || flightRules === 'IFR_VFR') ? (
          <Text className="mt-1 text-[10px] text-muted-foreground">
            {t('vfr.mixedRouteHint')}
          </Text>
        ) : null}
        {/* Cruise Level selector */}
        <View className="mt-3">
          <Text className="mb-1 text-xs font-medium text-foreground">{t('vfr.cruiseLevel')}</Text>
          {cruiseSuggestion && cruiseSuggestion.altitudes.length > 0 ? (
            <>
              <Text className="mb-1.5 text-[10px] text-muted-foreground">
                {t('vfr.avgMagCourse')}: {cruiseSuggestion.averageMC}°
                {hasVfr && ruleInfo ? ` · ${t(`vfr.rule.${ruleInfo.name}`)}` : ''}
                {hasIfr ? ` · ${t('vfr.ifrRule')}` : ''}
                {hasVfr && isImc ? ` · ${t('vfr.imcAltitudes')}` : ''}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-1.5">
                  {cruiseSuggestion.altitudes.filter((a) => hasIfr ? a >= 2000 && a <= 25000 : true).map((alt) => {
                    const fl = `FL${String(Math.round(alt / 100)).padStart(3, '0')}`;
                    const isSelected = cruiseLevel === fl;
                    const blocked = cruiseAltClearance?.find((c) => c.altitude === alt)?.blocked ?? false;
                    return (
                      <Pressable
                        key={alt}
                        onPress={() => setCruiseLevel(isSelected ? '' : fl)}
                        className={`rounded-sm border px-2.5 py-1.5 ${
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : blocked
                              ? 'border-destructive/40 bg-destructive/5'
                              : 'border-border bg-surface'
                        }`}
                      >
                        <Text
                          className={`text-[11px] font-bold ${
                            isSelected ? 'text-primary' : blocked ? 'text-destructive/60' : 'text-foreground'
                          }`}
                        >
                          {blocked ? `⛅ ${fl}` : fl}
                        </Text>
                        <Text className={`text-[9px] ${blocked ? 'text-destructive/50' : 'text-muted-foreground'}`}>
                          {alt.toLocaleString()} ft
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {cruiseAltClearance?.some((c) => c.blocked) ? (
                <Text className="mt-1 text-[10px] text-destructive/70">
                  ⛅ {t('vfr.cloudClearanceWarning')}
                </Text>
              ) : null}
            </>
          ) : (
            <Input
              value={cruiseLevel}
              onChangeText={setCruiseLevel}
              placeholder="FL045"
            />
          )}
          {cruiseLevel !== '' && cruiseSuggestion && !cruiseSuggestion.altitudes.some((a) => `FL${String(Math.round(a / 100)).padStart(3, '0')}` === cruiseLevel) ? (
            <Text className="mt-1 text-[10px] text-yellow-500">
              {t('vfr.cruiseLevelWarning')}
            </Text>
          ) : null}
        </View>

        <View className="mt-3 flex-row gap-3">
          {hasVfr ? (
            <View className="flex-1">
              <Input
                label={t('vfr.todMinutes')}
                value={todMinutes}
                onChangeText={setTodMinutes}
                placeholder="5"
                keyboardType="numeric"
              />
            </View>
          ) : null}
          {hasIfr ? (
            <View className="flex-1">
              <Input
                label={t('vfr.todDistance')}
                value={todDistanceNm}
                onChangeText={setTodDistanceNm}
                placeholder={suggestedTodNm ? String(suggestedTodNm) : '30'}
                keyboardType="numeric"
              />
              {suggestedTodNm && !todDistanceNm ? (
                <Pressable onPress={() => setTodDistanceNm(String(suggestedTodNm))}>
                  <Text className="mt-0.5 text-[10px] text-primary">
                    {t('vfr.suggested')}: {suggestedTodNm} NM
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <View className="flex-1">
            <Input
              label={t('vfr.cruiseLevelManual')}
              value={cruiseLevel}
              onChangeText={setCruiseLevel}
              placeholder={hasIfr ? 'FL350' : 'FL045'}
            />
          </View>
        </View>
      </Section>

      {/* ====== ROUTE LEGS ====== */}
      {routeLegs.length > 0 ? (
        <Section
          title={t('vfr.routeLegs')}
          trailing={
            <Pressable onPress={() => setRouteWaypoints([])}>
              <Text className="text-xs font-medium text-destructive">{t('vfr.clearRoute')}</Text>
            </Pressable>
          }
        >
          <View className="rounded-sm border border-border bg-surface-muted">
            {/* Header */}
            <View className="flex-row border-b border-border px-2 py-1.5">
              <Text className="w-8 text-[10px] font-bold text-muted-foreground">#</Text>
              <Text className="flex-[2] text-[10px] font-bold text-muted-foreground">Leg</Text>
              <Text className="flex-1 text-center text-[10px] font-bold text-muted-foreground">NM</Text>
              <Text className="flex-1 text-center text-[10px] font-bold text-muted-foreground">TC</Text>
              <Text className="flex-1 text-center text-[10px] font-bold text-muted-foreground">VAR</Text>
              <Text className="flex-1 text-center text-[10px] font-bold text-muted-foreground">MC</Text>
              <Text className="flex-1 text-center text-[10px] font-bold text-muted-foreground">{t('vfr.suggestedAlt')}</Text>
              <Text className="w-8 text-center text-[10px] font-bold text-muted-foreground">Ref</Text>
            </View>
            {/* Rows */}
            {routeLegs.map((leg, idx) => (
              <View key={idx}>
                <View
                  className={`flex-row items-center px-2 py-1.5 ${idx < routeLegs.length - 1 || expandedLegRef === idx ? 'border-b border-border' : ''}`}
                >
                  <Text className="w-8 text-[10px] font-medium text-muted-foreground">{idx + 1}</Text>
                  <Text className="flex-[2] text-[10px] font-medium text-foreground" numberOfLines={1}>
                    {leg.from.name} → {leg.to.name}
                  </Text>
                  <Text className="flex-1 text-center text-[10px] text-foreground">{leg.distanceNm.toFixed(1)}</Text>
                  <Text className="flex-1 text-center text-[10px] text-foreground">{leg.trueCourse.toFixed(0)}°</Text>
                  <Text className="flex-1 text-center text-[10px] text-foreground">{leg.magneticDeclination.toFixed(0)}°</Text>
                  <Text className="flex-1 text-center text-[10px] text-foreground">{leg.magneticCourse.toFixed(0)}°</Text>
                  <Text className="flex-1 text-center text-[10px] text-foreground">
                    {leg.suggestedAltitudes.slice(0, 3).map((a) =>
                      hasIfr ? `FL${String(Math.round(a / 100)).padStart(3, '0')}` : a.toLocaleString()
                    ).join(', ')}
                  </Text>
                  <Pressable
                    onPress={() => setExpandedLegRef(expandedLegRef === idx ? null : idx)}
                    className="w-8 items-center"
                  >
                    <Text className="text-[10px] text-primary">{expandedLegRef === idx ? '▲' : '📍'}</Text>
                  </Pressable>
                </View>
                {expandedLegRef === idx ? (
                  <NearbyPoisPanel
                    lat={(leg.from.lat + leg.to.lat) / 2}
                    lng={(leg.from.lng + leg.to.lng) / 2}
                    radiusNm={Math.max(leg.distanceNm / 2, 5)}
                    legLabel={`${leg.from.name} → ${leg.to.name}`}
                  />
                ) : null}
              </View>
            ))}
            {/* Total */}
            <View className="flex-row border-t border-border px-2 py-1.5">
              <Text className="w-8 text-[10px] font-bold text-foreground" />
              <Text className="flex-[2] text-[10px] font-bold text-foreground">{t('vfr.totalDistance')}</Text>
              <Text className="flex-1 text-center text-[10px] font-bold text-foreground">{totalDistanceNm.toFixed(1)}</Text>
              <Text className="flex-1" />
              <Text className="flex-1" />
              <Text className="flex-1" />
              <Text className="flex-1" />
              <Text className="w-8" />
            </View>
          </View>

        </Section>
      ) : null}

      {/* ====== REA (VFR only) ====== */}
      {hasVfr && origin && destination && /^S[BDIIJNSW]/.test(origin.icao) ? (
        <Section title={t('vfr.rea')}>
          {reaLoading ? (
            <Text className="text-xs text-muted-foreground">{t('common.loading')}</Text>
          ) : reaRegions.length === 0 ? (
            <Text className="text-xs text-green-600 mb-2">{t('vfr.reaNoConflict')}</Text>
          ) : (
            reaRegions.map((region) => (
              <View key={region.regionId} className="mb-3">
                <View className="flex-row items-center gap-2 mb-1.5">
                  {region.hasMandatory ? (
                    <View className="rounded px-1.5 py-0.5 bg-red-100">
                      <Text className="text-[10px] font-bold text-red-700">{t('vfr.reaMandatory')}</Text>
                    </View>
                  ) : (
                    <View className="rounded px-1.5 py-0.5 bg-blue-100">
                      <Text className="text-[10px] font-bold text-blue-700">{t('vfr.reaRecommended')}</Text>
                    </View>
                  )}
                  <Text className="text-sm font-semibold text-foreground">{region.chartName}</Text>
                </View>

                {region.hasMandatory ? (
                  <Text className="text-xs text-red-600 mb-2">{t('vfr.reaWarning')}</Text>
                ) : null}

                <View className="rounded border border-border overflow-hidden mb-2">
                  {region.corridors
                    .map((corridor) => {
                      const sorted = [...corridor.segments].sort((a, b) => a.trecho - b.trecho);
                      const wps: RouteWaypoint[] = [];
                      const seen = new Set<string>();
                      for (const seg of sorted) {
                        const keyA = `${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`;
                        if (!seen.has(keyA) && seg.fixoA.nome) {
                          seen.add(keyA);
                          wps.push({ lat: seg.fixoA.lat, lng: seg.fixoA.lon, name: seg.fixoA.nome });
                        }
                        const keyB = `${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`;
                        if (!seen.has(keyB) && seg.fixoB.nome) {
                          seen.add(keyB);
                          wps.push({ lat: seg.fixoB.lat, lng: seg.fixoB.lon, name: seg.fixoB.nome });
                        }
                      }
                      if (wps.length > 0 && origin) {
                        const d0 = haversineDistanceNm(origin.latitude, origin.longitude, wps[0]!.lat, wps[0]!.lng);
                        const dN = haversineDistanceNm(origin.latitude, origin.longitude, wps[wps.length - 1]!.lat, wps[wps.length - 1]!.lng);
                        if (dN < d0) wps.reverse();
                      }
                      const score = origin && destination && wps.length > 0
                        ? haversineDistanceNm(origin.latitude, origin.longitude, wps[0]!.lat, wps[0]!.lng)
                          + haversineDistanceNm(destination.latitude, destination.longitude, wps[wps.length - 1]!.lat, wps[wps.length - 1]!.lng)
                        : Infinity;
                      return { corridor, wps, score };
                    })
                    .sort((a, b) => a.score - b.score)
                    .map(({ corridor, wps, score }, cIdx, arr) => {
                      const isBest = cIdx === 0 && arr.length > 1 && score < Infinity;
                      return (
                        <View
                          key={corridor.name}
                          className={`px-2 py-1.5 ${cIdx < arr.length - 1 ? 'border-b border-border' : ''}`}
                        >
                          <View className="flex-row items-center gap-2">
                            <View
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: corridor.tipo === 'Obrig' ? '#dc2626' : '#2563eb' }}
                            />
                            <Text className="text-xs font-semibold text-foreground">{corridor.name}</Text>
                            <Text className="text-[10px] text-muted-foreground">
                              ({corridor.tipo === 'Obrig' ? t('vfr.reaMandatory') : t('vfr.reaRecommended')})
                            </Text>
                            {isBest ? (
                              <View className="rounded px-1 py-0.5 bg-green-100">
                                <Text className="text-[8px] font-bold text-green-700">{t('vfr.reaBestMatch')}</Text>
                              </View>
                            ) : null}
                          </View>
                          {wps.length > 0 ? (
                            <View className="flex-row items-center mt-0.5 ml-4 gap-2">
                              <Text className="text-[10px] text-muted-foreground flex-1" numberOfLines={1}>
                                {wps.map((w) => w.name).join(' → ')}
                              </Text>
                              <Pressable
                                onPress={() => setRouteWaypoints(wps)}
                                className="rounded px-2 py-0.5 bg-blue-600"
                              >
                                <Text className="text-[9px] font-semibold text-white">{t('vfr.reaFollow')}</Text>
                              </Pressable>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                </View>
              </View>
            ))
          )}

          {/* Embedded REA charts — always available for Brazilian routes */}
          <ReaChartsPanel highlightRegionIds={reaRegions.map((r) => r.regionId)} />
        </Section>
      ) : null}

      {/* ====== AIRCRAFT & WEIGHT ====== */}
      <Section title={t('aircraft.selectAircraft')} info={t('info.weight')}>
        <AircraftSelect
          value={selectedAircraft}
          onSelect={handleSelectAircraft}
          onClear={handleClearAircraft}
        />

        {selectedAircraft ? (
          <View className="mb-3 flex-row flex-wrap gap-1.5">
            <SpecChip label={t('aircraft.emptyWeight')} value={`${selectedAircraft.emptyWeightKg} kg`} convert={fuelKgConversions(selectedAircraft.emptyWeightKg)} />
            <SpecChip label={t('aircraft.mtow')} value={`${selectedAircraft.mtowKg} kg`} accent convert={fuelKgConversions(selectedAircraft.mtowKg)} />
            <SpecChip label={t('aircraft.usefulLoad')} value={`${selectedAircraft.mtowKg - selectedAircraft.emptyWeightKg} kg`} />
            <SpecChip label={t('aircraft.fuelCapacity')} value={`${Math.round(maxFuelKg)} kg`} convert={fuelKgConversions(Math.round(maxFuelKg))} />
            <SpecChip label={t('aircraft.cruiseSpeed')} value={`${selectedAircraft.cruiseSpeedKts} kt`} convert={`${Math.round(selectedAircraft.cruiseSpeedKts * NM_TO_KM)} km/h`} />
          </View>
        ) : null}

        {selectedAircraft ? (
          <View className="mb-3">
            <Text className="mb-1 text-sm font-medium text-foreground">{t('aircraft.weightMode')}</Text>
            <View className="flex-row gap-2">
              <Pressable
                className={`flex-1 rounded-button border px-3 py-2 ${weightMode === 'simple' ? 'border-primary bg-primary/10' : 'border-border'}`}
                onPress={() => setWeightMode('simple')}
              >
                <Text className={`text-center text-sm ${weightMode === 'simple' ? 'font-medium text-primary' : 'text-foreground'}`}>
                  {t('aircraft.simpleMode')}
                </Text>
              </Pressable>
              <Pressable
                className={`flex-1 rounded-button border px-3 py-2 ${weightMode === 'advanced' ? 'border-primary bg-primary/10' : 'border-border'}`}
                onPress={() => setWeightMode('advanced')}
              >
                <Text className={`text-center text-sm ${weightMode === 'advanced' ? 'font-medium text-primary' : 'text-foreground'}`}>
                  {t('aircraft.advancedMode')}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        {selectedAircraft && weightMode === 'simple' ? (
          <View className="mb-3">
            <Input
              label={`${t('aircraft.payload')} (${t('aircraft.maxLabel')} ${Math.max(0, Math.round(selectedAircraft.mtowKg - selectedAircraft.emptyWeightKg - fuelOnBoardKg))} kg)`}
              value={simpleTotalWeight}
              onChangeText={setSimpleTotalWeight}
              keyboardType="numeric"
              placeholder="0"
            />
          </View>
        ) : null}

        {selectedAircraft && weightMode === 'advanced' ? (
          <View className="mb-3">
            {selectedAircraft.stations.map((station) => (
              <View key={station.id} className="mb-2">
                <Input
                  label={`${t(station.labelKey)} (${t('aircraft.maxLabel')} ${station.maxKg} kg)`}
                  value={stationWeights[station.id] ?? ''}
                  onChangeText={(v) => setStationWeights((prev) => ({ ...prev, [station.id]: v }))}
                  keyboardType="numeric"
                  placeholder="0"
                />
              </View>
            ))}
          </View>
        ) : null}

        {selectedAircraft && (payloadKg > 0 || fuelOnBoardKg > 0) ? (
          <View className={`rounded-sm border px-3 py-2 ${mtowExcessKg > 0 ? 'border-destructive bg-destructive/10' : 'border-border bg-surface-muted'}`}>
            <Row label={t('aircraft.emptyWeight')} value={`${selectedAircraft.emptyWeightKg} kg`} />
            <Row label={t('aircraft.payload')} value={`${payloadKg.toFixed(1)} kg`} />
            <Row label={t('aircraft.fuelWeight')} value={`${fuelOnBoardKg.toFixed(1)} kg`} />
            <View className="my-1 border-t border-border/50" />
            <Row label={t('aircraft.takeoffWeight')} value={`${takeoffWeightKg.toFixed(0)} kg`} bold />
            <Row label={t('aircraft.mtow')} value={`${selectedAircraft.mtowKg} kg`} />
            {mtowExcessKg > 0 ? (
              <Text className="mt-1 text-xs font-semibold text-destructive">
                {t('aircraft.overMtow', { excess: mtowExcessKg.toFixed(0) })}
              </Text>
            ) : takeoffWeightKg > 0 ? (
              <Text className="mt-1 text-xs font-medium text-green-600">
                {t('aircraft.withinLimits')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Section>

      {/* ====== FUEL ====== */}
      <Section title={t('vfr.fuel')} info={t('info.fuel')}>
        {/* Day / Night — determines reserve per RBAC 91.151 */}
        <View className="mb-3">
          <Text className="mb-1 text-sm font-medium text-foreground">{t('vfr.flightCondition')}</Text>
          <View className="flex-row gap-2">
            <Pressable
              className={`flex-1 rounded-button border px-3 py-2 ${flightCondition === 'day' ? 'border-primary bg-primary/10' : 'border-border'}`}
              onPress={() => setFlightCondition('day')}
            >
              <Text className={`text-center text-sm ${flightCondition === 'day' ? 'font-medium text-primary' : 'text-foreground'}`}>
                {t('vfr.day')} (30 min)
              </Text>
            </Pressable>
            <Pressable
              className={`flex-1 rounded-button border px-3 py-2 ${flightCondition === 'night' ? 'border-primary bg-primary/10' : 'border-border'}`}
              onPress={() => setFlightCondition('night')}
            >
              <Text className={`text-center text-sm ${flightCondition === 'night' ? 'font-medium text-primary' : 'text-foreground'}`}>
                {t('vfr.night')} (45 min)
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Consumption + Contingency */}
        <View className="mb-3 flex-row gap-3">
          <View className="flex-1">
            <Input
              label={t('vfr.consumptionPerHour')}
              value={consumptionPerHour}
              onChangeText={setConsumptionPerHour}
              keyboardType="numeric"
              placeholder="0"
            />
            {consumptionKgH > 0 ? (
              <ConversionHint text={fuelFlowConversions(consumptionKgH)} />
            ) : null}
          </View>
          <View style={{ width: 72 }}>
            <Input
              label={t('vfr.contingencyLabel')}
              value={contingencyPct}
              onChangeText={setContingencyPct}
              keyboardType="numeric"
              placeholder="5"
            />
          </View>
        </View>

        {/* Fuel breakdown */}
        {consumptionKgH > 0 ? (
          <View className="mb-3 rounded-sm border border-border bg-surface-muted px-3 py-2">
            {tripFuelKg > 0 ? (
              <>
                <ConvertibleRow label={t('vfr.tripFuel')} value={`${tripFuelKg.toFixed(1)} kg`} convert={fuelKgConversions(tripFuelKg)} />
                <Row label={t('vfr.tripTime')} value={`${Math.floor(tripMinutes / 60)}h${String(tripMinutes % 60).padStart(2, '0')}min`} />
              </>
            ) : null}
            {altFuelKg > 0 ? (
              <ConvertibleRow label={t('vfr.altFuel')} value={`${altFuelKg.toFixed(1)} kg (${altDistNm.toFixed(0)} NM)`} convert={fuelKgConversions(altFuelKg)} />
            ) : null}
            {contingencyFuelKg > 0 ? (
              <ConvertibleRow label={`${t('vfr.contingency')} (${contingencyPct}%)`} value={`${contingencyFuelKg.toFixed(1)} kg`} convert={fuelKgConversions(contingencyFuelKg)} />
            ) : null}
            <ConvertibleRow label={`${t('vfr.reserveFuel')} (${reserveMinutes} min)`} value={`${reserveFuelKg.toFixed(1)} kg`} convert={fuelKgConversions(reserveFuelKg)} />
            {minFuelKg > 0 ? (
              <>
                <View className="my-1 border-t border-border/50" />
                <ConvertibleRow label={t('vfr.minFuel')} value={`${minFuelKg.toFixed(1)} kg`} convert={fuelKgConversions(minFuelKg)} bold />
              </>
            ) : null}
          </View>
        ) : null}

        {/* Fuel on board — auto-suggested, user can override */}
        <View className="mb-3">
          <Input
            label={selectedAircraft
              ? `${t('vfr.fuelOnBoard')} (${t('aircraft.maxLabel')} ${Math.round(maxFuelKg)} kg)`
              : t('vfr.fuelOnBoard')}
            value={fuelCurrentTotal}
            onChangeText={(v) => { setFuelManuallyEdited(true); setFuelCurrentTotal(v); }}
            keyboardType="numeric"
            placeholder="0"
          />
          {fuelOnBoardKg > 0 ? (
            <ConversionHint text={fuelKgConversions(fuelOnBoardKg)} />
          ) : null}
          {maxFuelKg > 0 && fuelOnBoardKg > maxFuelKg ? (
            <Text className="mt-0.5 text-[10px] font-semibold text-destructive">
              {t('vfr.overCapacity', { excess: (fuelOnBoardKg - maxFuelKg).toFixed(0) })}
            </Text>
          ) : null}
          {minFuelKg > 0 && fuelOnBoardKg > 0 && fuelOnBoardKg < minFuelKg ? (
            <Text className="mt-0.5 text-[10px] font-semibold text-destructive">
              {t('vfr.fuelInsufficient', { deficit: (minFuelKg - fuelOnBoardKg).toFixed(1) })}
            </Text>
          ) : null}
          {minFuelKg > 0 && fuelOnBoardKg >= minFuelKg && !(maxFuelKg > 0 && fuelOnBoardKg > maxFuelKg) ? (
            <Text className="mt-0.5 text-[10px] font-medium text-green-600">
              {t('vfr.fuelSufficient')}
            </Text>
          ) : null}
        </View>

        {/* Endurance summary */}
        {fuelOnBoardKg > 0 && consumptionKgH > 0 ? (
          <View className="rounded-sm border border-border bg-surface-muted px-3 py-2">
            <ConvertibleRow label={t('vfr.perWing')} value={`${perWingKg.toFixed(1)} kg`} convert={fuelKgConversions(perWingKg)} />
            <Row
              label={t('vfr.endurance')}
              value={`${enduranceHours}h${String(enduranceRemainder).padStart(2, '0')}min (${enduranceMin} min)`}
            />
          </View>
        ) : null}
      </Section>

      {/* ====== CHECKLISTS ====== */}
      {selectedAircraft && getChecklistsForAircraft(selectedAircraft.icaoType).length > 0 ? (
        <Section title={t('vfr.checklists')}>
          <ChecklistPanel icaoType={selectedAircraft.icaoType} />
        </Section>
      ) : null}

      {/* ====== SAVE ====== */}
      <View className="px-4 pb-6 md:px-6">
        <Pressable
          className="rounded-button bg-primary px-6 py-3 active:opacity-80 disabled:opacity-50"
          onPress={handleSave}
          disabled={saving || !origin || !destination}
        >
          <Text className="text-center font-medium text-primary-foreground">
            {saving ? t('common.saving') : t('common.save')}
          </Text>
        </Pressable>
      </View>
    </>
  );

  return (
    <VfrPlanLayout
      mapElement={mapElement}
      sidebarContent={sidebarContent}
    />
  );
}

// ---------- Sub-components ----------

function Section({ title, trailing, info, children }: { title: string; trailing?: React.ReactNode; info?: string; children: React.ReactNode }) {
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <View className="border-b border-border px-4 py-4 md:px-6 md:py-5">
      <View className="mb-3 flex-row items-center justify-between">
        <View className="flex-row items-center gap-1.5">
          <Text className="text-base font-bold text-foreground">{title}</Text>
          {info ? (
            <Pressable onPress={() => setInfoOpen((v) => !v)} hitSlop={8}>
              <Text className="text-xs text-muted-foreground">ⓘ</Text>
            </Pressable>
          ) : null}
        </View>
        {trailing}
      </View>
      {infoOpen && info ? (
        <View className="mb-3 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2">
          <Text className="text-[11px] leading-4 text-muted-foreground">{info}</Text>
        </View>
      ) : null}
      {children}
    </View>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View className="flex-row items-center justify-between py-0.5">
      <Text className={`text-xs ${bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{label}</Text>
      <Text className={`text-xs ${bold ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>{value}</Text>
    </View>
  );
}

function SpecChip({ label, value, accent, convert }: { label: string; value: string; accent?: boolean; convert?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={convert ? () => setOpen((v) => !v) : undefined}>
      <View className={`rounded-md border px-2.5 py-1.5 ${accent ? 'border-primary/30 bg-primary/5' : 'border-border bg-surface-muted'}`}>
        <Text className="text-[9px] text-muted-foreground">{label}</Text>
        <Text className={`text-xs font-semibold ${accent ? 'text-primary' : 'text-foreground'}`}>{value}</Text>
        {open && convert ? (
          <Text className="mt-0.5 text-[8px] text-muted-foreground">{convert}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function ConvertibleRow({ label, value, convert, bold }: { label: string; value: string; convert: string; bold?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Pressable onPress={() => setOpen((v) => !v)}>
      <View className="flex-row items-center justify-between py-0.5">
        <Text className={`text-xs ${bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{label}</Text>
        <Text className={`text-xs ${bold ? 'font-bold text-foreground' : 'font-medium text-foreground'}`}>{value}</Text>
      </View>
      {open ? (
        <Text className="pb-0.5 text-right text-[9px] text-muted-foreground">{convert}</Text>
      ) : null}
    </Pressable>
  );
}

function ConversionHint({ text }: { text: string }) {
  return <Text className="mt-0.5 text-[9px] text-muted-foreground">{text}</Text>;
}

function AerodromeInfo({
  aerodrome,
  metar,
  metarLoading,
  runway,
  onRunwayChange,
  flightRules,
  onRequestExpand,
  t,
}: {
  aerodrome: Aerodrome;
  metar: ParsedMetar | null;
  metarLoading: boolean;
  runway: string;
  onRunwayChange: (v: string) => void;
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  onRequestExpand: () => void;
  t: (key: string) => string;
}) {
  const [chartsOpen, setChartsOpen] = useState(false);

  const toggleCharts = useCallback(() => {
    setChartsOpen((prev) => {
      if (!prev) onRequestExpand();
      return !prev;
    });
  }, [onRequestExpand]);

  return (
    <View className="mb-4 ml-1">
      {aerodrome.elevation !== null ? (
        <Text className="text-xs text-muted-foreground">
          {t('vfr.elevation')}: {aerodrome.elevation} ft
        </Text>
      ) : null}
      <View className="mt-1 flex-row items-center gap-2">
        <Text className="text-xs text-muted-foreground">{t('vfr.runwayInUse')}:</Text>
        <View style={{ width: 80 }}>
          <Input
            value={runway}
            onChangeText={onRunwayChange}
            placeholder="—"
            className="py-0.5 text-xs"
          />
        </View>
        {runway ? (
          <Text className="text-xs text-muted-foreground">({t('vfr.suggested')})</Text>
        ) : null}
      </View>
      <MetarDisplay metar={metar} loading={metarLoading && !metar} />

      <Pressable
        onPress={toggleCharts}
        className="mt-2 flex-row items-center gap-1.5"
      >
        <Text className="text-xs font-medium text-primary">
          {chartsOpen ? '▼' : '▶'} {t('vfr.charts')}
        </Text>
      </Pressable>

      {chartsOpen ? (
        <ChartsPanel icao={aerodrome.icao} flightRules={flightRules} />
      ) : null}
    </View>
  );
}

function OfpViewer({ pdfUrl }: { pdfUrl: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const iframeRef = useRef<View>(null);
  const [maximized, setMaximized] = useState(false);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const getDoc = (): Document | undefined => (globalThis as Record<string, unknown>).document as Document | undefined;
  const openUrl = (url: string) => {
    const w = (globalThis as Record<string, unknown>).window as { open?: (url: string, target: string) => void } | undefined;
    w?.open(url, '_blank');
  };

  // Inline PDF iframe
  useEffect(() => {
    if (Platform.OS !== 'web' || !expanded || !iframeRef.current) return;
    const doc = getDoc();
    if (!doc) return;
    const el = iframeRef.current as unknown as HTMLDivElement;
    el.innerHTML = '';
    const iframe = doc.createElement('iframe');
    iframe.src = pdfUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = 'OFP';
    el.appendChild(iframe);
  }, [expanded, pdfUrl]);

  // Maximized overlay — same pattern as ChartsPanel
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const doc = getDoc();
    if (!doc) return;

    if (!maximized) {
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
      return;
    }

    const overlay = doc.createElement('div');
    overlay.style.cssText =
      'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9999;background:rgba(0,0,0,0.95);display:flex;flex-direction:column;';

    const header = doc.createElement('div');
    header.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.1);';

    const title = doc.createElement('span');
    title.style.cssText = 'color:#fff;font-size:13px;font-weight:600;flex:1;';
    title.textContent = 'OFP — Operational Flight Plan';
    header.appendChild(title);

    const extBtn = doc.createElement('button');
    extBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.2);color:rgba(255,255,255,0.7);font-size:12px;cursor:pointer;padding:4px 10px;border-radius:4px;flex-shrink:0;';
    extBtn.textContent = '↗';
    extBtn.title = 'Open in new tab';
    extBtn.onclick = () => openUrl(pdfUrl);
    header.appendChild(extBtn);

    const closeBtn = doc.createElement('button');
    closeBtn.style.cssText =
      'background:none;border:1px solid rgba(255,255,255,0.3);color:#fff;font-size:16px;cursor:pointer;padding:4px 12px;border-radius:4px;flex-shrink:0;';
    closeBtn.textContent = '✕';
    closeBtn.onclick = () => setMaximized(false);
    header.appendChild(closeBtn);

    const body = doc.createElement('div');
    body.style.cssText = 'flex:1;';
    const iframe = doc.createElement('iframe');
    iframe.src = pdfUrl;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.title = 'OFP';
    body.appendChild(iframe);

    overlay.appendChild(header);
    overlay.appendChild(body);
    doc.body.appendChild(overlay);
    overlayRef.current = overlay;

    const handleEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMaximized(false); };
    doc.addEventListener('keydown', handleEsc);

    return () => {
      doc.removeEventListener('keydown', handleEsc);
      if (overlayRef.current) {
        doc.body.removeChild(overlayRef.current);
        overlayRef.current = null;
      }
    };
  }, [maximized, pdfUrl]);

  return (
    <View className="mt-3">
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        className="flex-row items-center gap-1.5"
      >
        <Text className="text-xs font-medium text-primary">
          {expanded ? '▼' : '▶'} {t('vfr.simbriefOfpView')}
        </Text>
      </Pressable>
      {expanded ? (
        <View className="mt-2">
          <View className="mb-1 flex-row items-center justify-end gap-2">
            <Text className="mr-auto text-[10px] text-muted-foreground" numberOfLines={1}>
              SimBrief OFP
            </Text>
            <Pressable
              onPress={() => openUrl(pdfUrl)}
              className="rounded-sm border border-border px-2 py-0.5 active:bg-muted"
            >
              <Text className="text-[10px] text-muted-foreground">↗</Text>
            </Pressable>
            <Pressable
              onPress={() => setMaximized(true)}
              className="rounded-sm border border-border px-2 py-0.5 active:bg-muted"
            >
              <Text className="text-[10px] font-medium text-primary">⤢</Text>
            </Pressable>
          </View>
          <View
            style={{ height: 450, borderRadius: 6, overflow: 'hidden' }}
            className="border border-border"
          >
            <View ref={iframeRef} style={{ flex: 1 }} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ---------- Helpers ----------

function suggestRunway(
  windDir: number,
  runways: { leIdent: string | null; leHeadingDeg: number | null; heIdent: string | null; heHeadingDeg: number | null; closed: boolean }[],
): string | null {
  const open = runways.filter((r) => !r.closed);
  if (open.length === 0) return null;

  let bestIdent: string | null = null;
  let bestHeadwind = -Infinity;

  for (const rwy of open) {
    for (const th of [
      { ident: rwy.leIdent, heading: rwy.leHeadingDeg },
      { ident: rwy.heIdent, heading: rwy.heHeadingDeg },
    ]) {
      if (!th.ident || th.heading === null) continue;
      const diff = ((windDir - th.heading + 540) % 360) - 180;
      const headwind = Math.cos((diff * Math.PI) / 180);
      if (headwind > bestHeadwind) {
        bestHeadwind = headwind;
        bestIdent = th.ident;
      }
    }
  }

  return bestIdent;
}
