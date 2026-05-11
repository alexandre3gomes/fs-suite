import { Input } from '@fs-suite/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { type AircraftSpec, findAircraftByIcao } from '../../data/aircraftCatalog';
import { getChecklistsForAircraft } from '../../data/checklistCatalog';
import { apiClient, API_URL } from '../../services/api.client';
import { toPng } from 'html-to-image';

import { buildFlightPlanDoc, exportFlightPlanWithAttachments } from '../../services/pdf-export';
import { useUnitsStore, formatWeight, formatVolume, formatFuelWeight, formatSpeed, formatFuelFlow } from '../../stores/units.store';


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
import { type DomElement, type DomKeyboardEvent, getDoc, openExternal } from './dom-types';
import { type RouteWaypoint, buildVfrRouteText, buildItem18, calculateRouteLegs, haversineDistanceNm, initialBearing, suggestCruiseLevel, suggestIfrCruiseLevel, calculateTodDistance, getVfrRuleInfo, filterAltitudesByCloudClearance, type AltitudeClearance, formatAltitudeDisplay, formatAltitudeIcao, parseCruiseLevelFt, getPerformanceCategory } from './vfrNavigation';

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

export interface PlanRouteLeg {
  from: string;
  to: string;
  distanceNm: number;
  trueCourse: number;
  magneticDeclination: number;
  magneticCourse: number;
  suggestedAltitudes: number[];
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
  routeLegs?: PlanRouteLeg[];
  totalDistanceNm?: number;
  tripMinutes?: number;
  cruiseSpeedKts?: number;
  tripFuelKg?: number;
  altFuelKg?: number;
  altDistanceNm?: number;
  contingencyPct?: number;
  contingencyFuelKg?: number;
  reserveFuelKg?: number;
  minFuelKg?: number;
  flightCondition?: 'day' | 'night';
  emptyWeightKg?: number;
  payloadKg?: number;
  fuelCapacityL?: number;
  remarks?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  VFR: '#16a34a',
  MVFR: '#2563eb',
  IFR: '#dc2626',
  LIFR: '#d946ef',
};

const AVGAS_KG_PER_L = 0.72;

// Runway-dependent gate selection per AIC N32/25 (SBMT/SBJD sector operations)
// Key: ICAO code; Value: map of runway designator to { entry gate, exit gate }
const RWY_GATE_MAP: Record<string, Record<string, { entry: string; exit: string }>> = {
  SBMT: {
    '30': { entry: 'Abril', exit: 'Penteado' },
    '12': { entry: 'Penteado', exit: 'Abril' },
  },
  SBJD: {
    '18': { entry: 'Lagoa', exit: 'Estádio' },
    '36': { entry: 'Estádio', exit: 'Lagoa' },
  },
};

interface Props {
  initialData?: VfrPlanData;
  onSave: (data: VfrPlanData) => Promise<void>;
  saving: boolean;
}

// ---------- Component ----------

export function VfrPlanForm({ initialData, onSave, saving }: Props) {
  const { t } = useTranslation();
  const { weight: wu, volume: vu, speed: su } = useUnitsStore();

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

  const mapHandleRef = useRef<{
    flyTo: (lat: number, lng: number) => void;
    getContainer: () => HTMLElement | null;
    fitRouteBounds: () => { center: [number, number]; zoom: number } | null;
    setView: (center: [number, number], zoom: number) => void;
  } | null>(null);

  // Route waypoints (intermediate, added via map context menu)
  const [routeWaypoints, setRouteWaypoints] = useState<RouteWaypoint[]>([]);
  const [followedCorridorName, setFollowedCorridorName] = useState<string | null>(null);
  const [corridorAltRange, setCorridorAltRange] = useState<{ min: number; max: number } | null>(null);
  const [corridorCompAlt, setCorridorCompAlt] = useState<number | null>(null);

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
  const toFL = (ft: number) => `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
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
    mapHandleRef.current?.flyTo(a.latitude, a.longitude);
  }, [fetchAerodromeInfo]);

  const handleSelectDestination = useCallback((a: Aerodrome) => {
    setDestination(a);
    void fetchAerodromeInfo(a.icao, 'destination');
  }, [fetchAerodromeInfo]);

  const handleSelectAlternate = useCallback((a: Aerodrome) => {
    setAlternate(a);
  }, []);

  // Auto-fit map to show entire route when destination or alternate changes
  useEffect(() => {
    if (!origin || !destination) return;
    const timer = setTimeout(() => {
      mapHandleRef.current?.fitRouteBounds();
    }, 300);
    return () => clearTimeout(timer);
  }, [destination?.icao, alternate?.icao]);

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
    setFollowedCorridorName(null);
    setCorridorAltRange(null);
    setCorridorCompAlt(null);
  }, []);

  const handleRemoveWaypoint = useCallback((idx: number) => {
    setRouteWaypoints((prev) => prev.filter((_, i) => i !== idx));
    setExpandedLegRef(null);
    setFollowedCorridorName(null);
    setCorridorAltRange(null);
    setCorridorCompAlt(null);
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
  const destCategory = destination ? metars[destination.icao]?.flightCategory : undefined;
  const isImc = originCategory === 'IFR' || originCategory === 'LIFR';

  const vfrWeatherWarnings = useMemo(() => {
    if (!hasVfr) return [];
    const warnings: { icao: string; category: string; ceiling: number | null; visibility: string | null }[] = [];
    const checkAd = (ad: Aerodrome | null) => {
      if (!ad) return;
      const m = metars[ad.icao];
      if (!m || m.flightCategory === 'VFR') return;
      warnings.push({ icao: ad.icao, category: m.flightCategory ?? 'UNKN', ceiling: m.ceiling, visibility: m.visibility });
    };
    checkAd(origin);
    checkAd(destination);
    checkAd(alternate);
    return warnings;
  }, [hasVfr, origin, destination, alternate, metars]);

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

  // Auto-select valid altitude when corridor restricts range
  useEffect(() => {
    if (!cruiseSuggestion) return;
    // Compulsory altitude takes absolute priority
    if (corridorCompAlt != null) {
      setCruiseLevel(toFL(corridorCompAlt));
      return;
    }
    if (!corridorAltRange) return;
    const currentFt = parseCruiseLevelFt(cruiseLevel);
    if (currentFt && currentFt >= corridorAltRange.min && currentFt <= corridorAltRange.max) return;
    const validInRange = cruiseSuggestion.altitudes.filter(
      (a) => a >= corridorAltRange.min && a <= corridorAltRange.max,
    );
    if (validInRange.length > 0) {
      setCruiseLevel(toFL(validInRange[0]!));
    } else {
      const midAlt = Math.round((corridorAltRange.min + corridorAltRange.max) / 2 / 100) * 100;
      setCruiseLevel(toFL(midAlt));
    }
  }, [corridorAltRange, corridorCompAlt, cruiseSuggestion]);

  // Cruise level validation warnings
  const cruiseLevelWarnings = useMemo(() => {
    const warnings: { key: string; severity: 'error' | 'warning' }[] = [];
    const altFt = parseCruiseLevelFt(cruiseLevel);
    if (!altFt || altFt <= 0) return warnings;

    if (corridorCompAlt != null) {
      if (altFt !== corridorCompAlt) {
        warnings.push({ key: 'reaAltViolation', severity: 'error' });
      }
    } else if (corridorAltRange) {
      if (altFt < corridorAltRange.min || altFt > corridorAltRange.max) {
        warnings.push({ key: 'reaAltViolation', severity: 'error' });
      }
    }

    if (cruiseSuggestion && hasVfr && !corridorAltRange && corridorCompAlt == null) {
      if (!cruiseSuggestion.altitudes.includes(altFt)) {
        warnings.push({ key: 'semicircularViolation', severity: 'warning' });
      }
    }

    const highestElev = Math.max(origin?.elevation ?? 0, destination?.elevation ?? 0);
    if (altFt < highestElev + 1000) {
      warnings.push({ key: 'tooLow', severity: 'error' });
    }

    return warnings;
  }, [cruiseLevel, corridorAltRange, corridorCompAlt, cruiseSuggestion, hasVfr, origin?.elevation, destination?.elevation]);

  // Auto-suggest TOD distance for IFR
  const suggestedTodNm = useMemo(() => {
    if (!hasIfr || !cruiseLevel || !destination?.elevation) return null;
    const altFt = parseCruiseLevelFt(cruiseLevel);
    if (!altFt) return null;
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
        rumoAtoB: number | null; rumoBtoA: number | null;
        altMinAtoB: number; altMaxAtoB: number; altMinBtoA: number; altMaxBtoA: number;
        altComp: number | null; altCompAtoB: number | null; altCompBtoA: number | null;
        fca: string; ats: string;
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

  // Auto-generate VFR route text with coordinates (or REA corridor format)
  useEffect(() => {
    const text = buildVfrRouteText(origin?.icao ?? null, routeWaypoints, destination?.icao ?? null, followedCorridorName);
    setRouteText(text);
  }, [origin?.icao, destination?.icao, routeWaypoints, followedCorridorName]);

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

  // Remarks (Item 18)
  const [userRemarks, setUserRemarks] = useState('');
  const performanceCategory = useMemo(
    () => selectedAircraft ? getPerformanceCategory(selectedAircraft.cruiseSpeedKts) : null,
    [selectedAircraft],
  );
  const autoRemarks = useMemo(() => {
    return buildItem18({
      corridorName: followedCorridorName,
      corridorAltRange,
      corridorCompAlt,
      dateOfFlight: new Date(),
      performanceCategory,
    });
  }, [followedCorridorName, corridorAltRange, corridorCompAlt, performanceCategory]);
  const fullRemarks = useMemo(() => {
    return buildItem18({
      corridorName: followedCorridorName,
      corridorAltRange,
      corridorCompAlt,
      userRemarks,
      dateOfFlight: new Date(),
      performanceCategory,
    });
  }, [followedCorridorName, corridorAltRange, corridorCompAlt, userRemarks, performanceCategory]);

  // SimBrief state
  const [callsign, setCallsign] = useState(initialData?.callsign ?? '');
  const [simbriefOfpId, setSimbriefOfpId] = useState(initialData?.simbriefOfpId ?? '');

  // OFP PDF for embedded viewer
  const [ofpPdfUrl, setOfpPdfUrl] = useState<string | null>(null);

  const handleSimBriefImport = useCallback((ofp: SimBriefOfpData) => {
    setSimbriefOfpId(ofp.ofpId);
    if (ofp.route) setRouteText(ofp.route);
    if (ofp.callsign) setCallsign(ofp.callsign);

    if (ofp.cruiseAltitudeFt != null && ofp.cruiseAltitudeFt > 0) {
      setCruiseLevel(toFL(ofp.cruiseAltitudeFt));
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

  const buildPlanData = (): VfrPlanData | null => {
    if (!origin || !destination) return null;
    return {
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
      visualReferences: initialData?.visualReferences,
      routeLegs: routeLegs.length > 0 ? routeLegs.map((leg) => ({
        from: leg.from.name,
        to: leg.to.name,
        distanceNm: leg.distanceNm,
        trueCourse: leg.trueCourse,
        magneticDeclination: leg.magneticDeclination,
        magneticCourse: leg.magneticCourse,
        suggestedAltitudes: leg.suggestedAltitudes,
      })) : undefined,
      totalDistanceNm: totalDistanceNm || undefined,
      tripMinutes: tripMinutes || undefined,
      cruiseSpeedKts: cruiseKts || undefined,
      tripFuelKg: tripFuelKg || undefined,
      altFuelKg: altFuelKg || undefined,
      altDistanceNm: altDistNm || undefined,
      contingencyPct: parseFloat(contingencyPct) || undefined,
      contingencyFuelKg: contingencyFuelKg || undefined,
      reserveFuelKg: reserveFuelKg || undefined,
      minFuelKg: minFuelKg || undefined,
      flightCondition,
      emptyWeightKg: selectedAircraft?.emptyWeightKg,
      payloadKg: payloadKg || undefined,
      fuelCapacityL: selectedAircraft?.fuelCapacityL,
      remarks: fullRemarks || undefined,
    };
  };

  const handleSave = () => {
    const data = buildPlanData();
    if (!data) {
      Alert.alert(t('common.error'), t('vfr.noPlanSelected'));
      return;
    }
    void onSave(data);
  };

  const [showExportModal, setShowExportModal] = useState(false);
  const [exportIncludeCharts, setExportIncludeCharts] = useState(false);
  const [exportIncludeChecklist, setExportIncludeChecklist] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasChecklists = !!selectedAircraft && getChecklistsForAircraft(selectedAircraft.icaoType).length > 0;

  const handleExportPdf = () => {
    const data = buildPlanData();
    if (!data) {
      Alert.alert(t('common.error'), t('vfr.noPlanSelected'));
      return;
    }
    setShowExportModal(true);
  };

  const handleExportConfirm = async () => {
    const data = buildPlanData();
    if (!data) return;

    setExporting(true);
    try {
      // Capture map screenshot — fit full route first, restore view after
      let mapImageDataUrl: string | undefined;
      if (Platform.OS === 'web' && mapHandleRef.current) {
        let prevView: { center: [number, number]; zoom: number } | null = null;
        try {
          prevView = mapHandleRef.current.fitRouteBounds();
          await new Promise((r) => setTimeout(r, 800));
          const container = mapHandleRef.current.getContainer();
          if (container) {
            // Hide zoom/layer controls for a clean screenshot
            const controlEl = (container as unknown as { querySelector: (s: string) => { style: { display: string } } | null }).querySelector('.leaflet-control-container');
            const prevDisplay = controlEl?.style.display ?? '';
            if (controlEl) controlEl.style.display = 'none';
            mapImageDataUrl = await (toPng as unknown as (el: unknown, opts?: Record<string, unknown>) => Promise<string>)(container, { cacheBust: true });
            if (controlEl) controlEl.style.display = prevDisplay;
          }
        } catch { /* skip map capture on failure */ }
        if (prevView) {
          mapHandleRef.current.setView(prevView.center, prevView.zoom);
        }
      }

      const hasAttachments = exportIncludeCharts || exportIncludeChecklist;
      if (!hasAttachments) {
        const doc = buildFlightPlanDoc(data, mapImageDataUrl);
        const filename = `flight-plan_${data.originIcao}-${data.destinationIcao}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.pdf`;
        doc.save(filename);
        setShowExportModal(false);
        return;
      }

      const chartUrls: string[] = [];
      if (exportIncludeCharts) {
        const icaos = [origin?.icao, destination?.icao, alternate?.icao].filter(Boolean) as string[];
        for (const icao of icaos) {
          try {
            const res = await apiClient.get<{ charts: { url: string; type: string }[] }>(`/aerodromes/${icao}/charts`);
            const filtered = res.charts.filter((c) => ['ADC', 'PDC', 'VAC', 'INFO'].includes(c.type));
            for (const chart of filtered) {
              chartUrls.push(`${API_URL}/v1/aerodromes/chart-proxy?url=${encodeURIComponent(chart.url)}`);
            }
          } catch { /* skip */ }
        }
      }

      let checklistUrl: string | undefined;
      if (exportIncludeChecklist && selectedAircraft) {
        const checklists = getChecklistsForAircraft(selectedAircraft.icaoType);
        if (checklists[0]) {
          checklistUrl = checklists[0].pdfUrl;
        }
      }

      await exportFlightPlanWithAttachments(data, { chartUrls, checklistUrl }, mapImageDataUrl);
    } catch (err) {
      console.error('PDF export error:', err);
      if (Platform.OS === 'web') {
        (globalThis as unknown as { alert: (msg: string) => void }).alert(
          `${t('common.error')}: ${err instanceof Error ? err.message : 'Export failed'}`,
        );
      } else {
        Alert.alert(t('common.error'), 'Export failed');
      }
    } finally {
      setExporting(false);
      setShowExportModal(false);
    }
  };

  const mapElement = (
    <AerodromeMap
      onSelectOrigin={handleSelectOrigin}
      onSelectDestination={handleSelectDestination}
      onSelectAlternate={handleSelectAlternate}
      onMapReady={(handle) => { mapHandleRef.current = handle; }}
      routeOrigin={routeOriginPos}
      routeDestination={routeDestPos}
      routeAlternate={routeAltPos}
      routeWaypoints={routeWaypoints}
      onAddWaypoint={handleAddWaypoint}
      onRemoveWaypoint={handleRemoveWaypoint}
      reaSegments={reaMapSegments}
      selectedReaCorridorName={followedCorridorName}
      flightRules={flightRules}
    />
  );

  const sidebarContent = (onRequestExpand: () => void) => (
    <>
      {/* ====== FLIGHT RULES ====== */}
      <Section title={t('vfr.flightRules')}>
        <View className="gap-2">
          {[FLIGHT_RULES.slice(0, 2), FLIGHT_RULES.slice(2, 4)].map((row, rowIdx) => (
            <View key={rowIdx} className="flex-row gap-2">
              {row.map((rule) => {
                const disabled = rule.value !== 'VFR';
                const active = flightRules === rule.value;
                return (
                  <Pressable
                    key={rule.value}
                    onPress={() => { if (!disabled) setFlightRules(rule.value); }}
                    disabled={disabled}
                    className={`flex-1 items-center justify-center rounded-md border px-2 py-2.5 ${
                      disabled
                        ? 'border-border bg-muted/30 opacity-50'
                        : active
                          ? 'border-primary bg-primary/10'
                          : 'border-border bg-surface-muted'
                    }`}
                  >
                    <Text
                      className={`text-center text-sm font-semibold ${
                        disabled
                          ? 'text-muted-foreground'
                          : active ? 'text-primary' : 'text-foreground'
                      }`}
                    >
                      {t(rule.labelKey)}
                    </Text>
                    {disabled && (
                      <Text className="mt-0.5 text-center text-[9px] font-medium text-muted-foreground">
                        {t('dashboard.comingSoon')}
                      </Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
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

      {/* ====== VFR WEATHER WARNING ====== */}
      {vfrWeatherWarnings.length > 0 ? (
        <View className="mx-1 -mt-1 mb-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2">
          <Text className="text-xs font-semibold text-amber-800">
            {t('vfr.weatherWarningTitle')}
          </Text>
          {vfrWeatherWarnings.map((w) => (
            <Text key={w.icao} className="mt-0.5 text-[11px] text-amber-700">
              {w.icao}: {w.category}
              {w.ceiling !== null ? ` · ${t('vfr.ceiling')} ${w.ceiling} ft` : ''}
              {w.visibility ? ` · ${t('vfr.visibility')} ${w.visibility} SM` : ''}
            </Text>
          ))}
        </View>
      ) : null}

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
          placeholder={hasIfr ? 'SID AIRWAY WAYPOINT STAR' : 'SBSP DCT 2338S04640W 2345S04655W DCT SBGR'}
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
                  {cruiseSuggestion.altitudes
                    .filter((a) => hasIfr ? a >= 2000 && a <= 25000 : true)
                    .filter((a) => corridorCompAlt != null ? a === corridorCompAlt : corridorAltRange ? a >= corridorAltRange.min && a <= corridorAltRange.max : true)
                    .map((alt) => {
                    const fl = toFL(alt);
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
            <View className="flex-row items-center rounded-md border border-input bg-background">
              <Text className="pl-3 text-sm font-medium text-muted-foreground">FL</Text>
              <TextInput
                value={cruiseLevel.replace(/^FL/i, '')}
                onChangeText={(v) => setCruiseLevel(v ? `FL${v.replace(/\D/g, '')}` : '')}
                placeholder="045"
                keyboardType="numeric"
                maxLength={3}
                className="flex-1 px-2 py-2.5 text-sm text-foreground"
                placeholderTextColor="hsl(220, 8.9%, 46.1%)"
              />
            </View>
          )}
          {/* Constraint reason tags */}
          {corridorAltRange || corridorCompAlt != null || cruiseLevelWarnings.length > 0 ? (
            <View className="mt-1.5 gap-1">
              {corridorCompAlt != null ? (
                <View className="rounded-sm border border-amber-300 bg-amber-50 px-2 py-1">
                  <Text className="text-[10px] font-bold text-amber-800">
                    {corridorCompAlt} ft ✦
                  </Text>
                </View>
              ) : corridorAltRange ? (
                <View className="rounded-sm border border-green-200 bg-green-50 px-2 py-1">
                  <Text className="text-[10px] font-medium text-green-800">
                    {t('vfr.reaAltRange', { min: corridorAltRange.min, max: corridorAltRange.max })}
                  </Text>
                </View>
              ) : null}
              {cruiseLevelWarnings.map((w) => (
                <View
                  key={w.key}
                  className={`rounded-sm border px-2 py-1 ${
                    w.severity === 'error'
                      ? 'border-destructive/30 bg-destructive/5'
                      : 'border-yellow-300 bg-yellow-50'
                  }`}
                >
                  <Text className={`text-[10px] font-medium ${
                    w.severity === 'error' ? 'text-destructive' : 'text-yellow-700'
                  }`}>
                    {t(`vfr.${w.key}`)}
                  </Text>
                </View>
              ))}
            </View>
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
            <Text className="mb-1.5 text-sm font-medium text-foreground">{t('vfr.cruiseLevelManual')}</Text>
            <View className="flex-row items-center rounded-md border border-input bg-background">
              <Text className="pl-3 text-sm font-medium text-muted-foreground">FL</Text>
              <TextInput
                value={cruiseLevel.replace(/^FL/i, '')}
                onChangeText={(v) => setCruiseLevel(v ? `FL${v.replace(/\D/g, '')}` : '')}
                placeholder="045"
                keyboardType="numeric"
                maxLength={3}
                className="flex-1 px-2 py-2.5 text-sm text-foreground"
                placeholderTextColor="hsl(220, 8.9%, 46.1%)"
              />
            </View>
            {cruiseLevel ? (() => {
              const ft = parseCruiseLevelFt(cruiseLevel);
              return ft ? (
                <Text className="mt-1 text-[9px] text-muted-foreground">
                  {ft.toLocaleString()} ft · ICAO: {formatAltitudeIcao(ft, origin?.icao)}
                </Text>
              ) : null;
            })() : null}
          </View>
        </View>
      </Section>

      {/* ====== ROUTE LEGS ====== */}
      {routeLegs.length > 0 ? (
        <Section
          title={t('vfr.routeLegs')}
          trailing={
            <Pressable onPress={() => { setRouteWaypoints([]); setFollowedCorridorName(null); setCorridorAltRange(null); }}>
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

                      // Build ordered waypoints following segment sequence (A→B direction)
                      const wpsAtoB: RouteWaypoint[] = [];
                      const seenAB = new Set<string>();
                      for (const seg of sorted) {
                        const kA = `${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`;
                        if (!seenAB.has(kA) && seg.fixoA.nome) {
                          seenAB.add(kA);
                          wpsAtoB.push({ lat: seg.fixoA.lat, lng: seg.fixoA.lon, name: seg.fixoA.nome });
                        }
                        const kB = `${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`;
                        if (!seenAB.has(kB) && seg.fixoB.nome) {
                          seenAB.add(kB);
                          wpsAtoB.push({ lat: seg.fixoB.lat, lng: seg.fixoB.lon, name: seg.fixoB.nome });
                        }
                      }

                      // Find entry (closest to origin) and exit (closest to destination)
                      // then extract only the relevant sub-path
                      let wps: RouteWaypoint[] = [];
                      let reversed = false;
                      if (wpsAtoB.length >= 2 && origin && destination) {
                        let entryIdx = 0;
                        let entryDist = Infinity;
                        let exitIdx = 0;
                        let exitDist = Infinity;
                        for (let i = 0; i < wpsAtoB.length; i++) {
                          const dO = haversineDistanceNm(origin.latitude, origin.longitude, wpsAtoB[i]!.lat, wpsAtoB[i]!.lng);
                          const dD = haversineDistanceNm(destination.latitude, destination.longitude, wpsAtoB[i]!.lat, wpsAtoB[i]!.lng);
                          if (dO < entryDist) { entryDist = dO; entryIdx = i; }
                          if (dD < exitDist) { exitDist = dD; exitIdx = i; }
                        }
                        if (entryIdx <= exitIdx) {
                          wps = wpsAtoB.slice(entryIdx, exitIdx + 1);
                        } else {
                          wps = wpsAtoB.slice(exitIdx, entryIdx + 1).reverse();
                          reversed = true;
                        }
                      } else {
                        wps = wpsAtoB;
                      }

                      // One-way validation: check if any segment forbids this direction
                      // rumoAtoB===null means A→B forbidden; rumoBtoA===null means B→A forbidden
                      const directionBlocked = sorted.some((seg) => {
                        const kA = `${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`;
                        const kB = `${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`;
                        const usedInPath = wps.some((w) => {
                          const k = `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`;
                          return k === kA || k === kB;
                        });
                        if (!usedInPath) return false;
                        if (reversed && seg.rumoBtoA === null) return true;
                        if (!reversed && seg.rumoAtoB === null) return true;
                        return false;
                      });
                      if (directionBlocked) return { corridor, wps: [] as RouteWaypoint[], altRange: null, compAlt: null as number | null, score: Infinity };

                      // Extract altitude for segments in the used sub-path
                      // Priority: compulsory direction-specific > compulsory general > directional min/max > general min/max
                      const usedCoords = new Set(wps.map((w) => `${w.lat.toFixed(4)},${w.lng.toFixed(4)}`));
                      let altMin = 0;
                      let altMax = Infinity;
                      let compAlt: number | null = null;
                      for (const seg of sorted) {
                        const kA = `${seg.fixoA.lat.toFixed(4)},${seg.fixoA.lon.toFixed(4)}`;
                        const kB = `${seg.fixoB.lat.toFixed(4)},${seg.fixoB.lon.toFixed(4)}`;
                        if (!usedCoords.has(kA) && !usedCoords.has(kB)) continue;

                        // Compulsory altitude (highest priority)
                        const dirComp = reversed ? seg.altCompBtoA : seg.altCompAtoB;
                        if (dirComp != null) { compAlt = dirComp; }
                        else if (seg.altComp != null) { compAlt = seg.altComp; }

                        // Range altitudes (lower priority, used if no compulsory)
                        const segMin = (reversed ? seg.altMinBtoA : seg.altMinAtoB) || seg.altMinAtoB || seg.altMinBtoA;
                        const segMax = (reversed ? seg.altMaxBtoA : seg.altMaxAtoB) || seg.altMaxAtoB || seg.altMaxBtoA;
                        if (segMin > 0) altMin = Math.max(altMin, segMin);
                        if (segMax > 0) altMax = Math.min(altMax, segMax);
                      }
                      const altRange = altMin > 0 && altMax < Infinity ? { min: altMin, max: altMax } : null;

                      const score = origin && destination && wps.length > 0
                        ? haversineDistanceNm(origin.latitude, origin.longitude, wps[0]!.lat, wps[0]!.lng)
                          + haversineDistanceNm(destination.latitude, destination.longitude, wps[wps.length - 1]!.lat, wps[wps.length - 1]!.lng)
                        : Infinity;
                      return { corridor, wps, altRange, compAlt, score };
                    })
                    .filter(({ wps }) => {
                      if (!origin || !destination) return true;
                      if (wps.length < 2) return false;
                      const subBearing = initialBearing(wps[0]!.lat, wps[0]!.lng, wps[wps.length - 1]!.lat, wps[wps.length - 1]!.lng);
                      const odBearing = initialBearing(origin.latitude, origin.longitude, destination.latitude, destination.longitude);
                      const diff = ((subBearing - odBearing) % 360 + 360) % 360;
                      const angDiff = diff > 180 ? 360 - diff : diff;
                      if (angDiff > 90) return false;
                      const entryDistToDest = haversineDistanceNm(wps[0]!.lat, wps[0]!.lng, destination.latitude, destination.longitude);
                      const exitDistToDest = haversineDistanceNm(wps[wps.length - 1]!.lat, wps[wps.length - 1]!.lng, destination.latitude, destination.longitude);
                      const progress = entryDistToDest - exitDistToDest;
                      let pathDist = 0;
                      for (let i = 1; i < wps.length; i++) {
                        pathDist += haversineDistanceNm(wps[i - 1]!.lat, wps[i - 1]!.lng, wps[i]!.lat, wps[i]!.lng);
                      }
                      if (pathDist > 0 && progress / pathDist < 0.5) return false;
                      return true;
                    })
                    .sort((a, b) => a.score - b.score)
                    .map(({ corridor, wps, altRange, compAlt, score }, cIdx, arr) => {
                      const isBest = cIdx === 0 && arr.length > 1 && score < Infinity;
                      const isFollowed = followedCorridorName === corridor.name;
                      return (
                        <Pressable
                          key={corridor.name}
                          onPress={() => {
                            if (wps.length === 0) return;
                            const entry = wps[0]!;
                            let combinedWps = wps;
                            let combinedAltRange = altRange;
                            let combinedName = corridor.name;

                            // Find the correct connecting corridor (portão) based on direction of travel.
                            // REA corridors have defined headings (rumoAtoB/rumoBtoA). The correct
                            // portão is the one whose flow direction aligns with our approach bearing
                            // from origin to the main corridor's entry point.
                            const angDiff = (a: number, b: number) => { const d = ((a - b) % 360 + 360) % 360; return d > 180 ? 360 - d : d; };
                            const approachBearing = origin
                              ? initialBearing(origin.latitude, origin.longitude, entry.lat, entry.lng)
                              : 0;
                            const CONNECT_THRESHOLD_NM = 1.5;

                            interface ConnectorCandidate {
                              wps: RouteWaypoint[];
                              segments: typeof corridor.segments;
                              name: string;
                              bearingDiff: number;
                            }
                            const candidates: ConnectorCandidate[] = [];

                            for (const other of region.corridors) {
                              if (other.name === corridor.name) continue;
                              const otherSegs = [...other.segments].sort((a, b) => a.trecho - b.trecho);
                              const uniqueWps: RouteWaypoint[] = [];
                              const seen2 = new Set<string>();
                              for (const seg of otherSegs) {
                                for (const fix of [seg.fixoA, seg.fixoB]) {
                                  const k = `${fix.lat.toFixed(4)},${fix.lon.toFixed(4)}`;
                                  if (!seen2.has(k) && fix.nome) {
                                    seen2.add(k);
                                    uniqueWps.push({ lat: fix.lat, lng: fix.lon, name: fix.nome });
                                  }
                                }
                              }
                              if (uniqueWps.length < 2 || !origin) continue;

                              // Find junction (closest wp to main corridor entry)
                              let junctionIdx = 0;
                              let junctionDist = Infinity;
                              for (let i = 0; i < uniqueWps.length; i++) {
                                const d = haversineDistanceNm(uniqueWps[i]!.lat, uniqueWps[i]!.lng, entry.lat, entry.lng);
                                if (d < junctionDist) { junctionDist = d; junctionIdx = i; }
                              }
                              if (junctionDist >= CONNECT_THRESHOLD_NM) continue;

                              // Find origin-nearest wp in the connector corridor
                              let originNearestIdx = 0;
                              let originNearestDist = Infinity;
                              for (let i = 0; i < uniqueWps.length; i++) {
                                const d = haversineDistanceNm(uniqueWps[i]!.lat, uniqueWps[i]!.lng, origin.latitude, origin.longitude);
                                if (d < originNearestDist) { originNearestDist = d; originNearestIdx = i; }
                              }

                              // Trim to sub-path from origin-nearest wp to junction (handles both long corridors and portões)
                              const subStart = Math.min(originNearestIdx, junctionIdx);
                              const subEnd = Math.max(originNearestIdx, junctionIdx);
                              const subWps = uniqueWps.slice(subStart, subEnd + 1);
                              if (subWps.length < 1) continue;

                              // Order: origin side first, junction last
                              const connWps = originNearestIdx <= junctionIdx ? subWps : [...subWps].reverse();

                              // Heading from connector origin toward junction
                              const connHeading = connWps.length >= 2
                                ? initialBearing(connWps[0]!.lat, connWps[0]!.lng, connWps[connWps.length - 1]!.lat, connWps[connWps.length - 1]!.lng)
                                : approachBearing;
                              const diff = angDiff(connHeading, approachBearing);
                              if (diff <= 90) {
                                candidates.push({ wps: connWps, segments: otherSegs, name: other.name, bearingDiff: diff });
                              }
                            }

                            // Filter connector candidates by one-way rules and runway-dependent gates
                            const originGateMap = origin ? RWY_GATE_MAP[origin.icao] : undefined;
                            const destGateMap = destination ? RWY_GATE_MAP[destination.icao] : undefined;
                            const requiredEntry = originGateMap?.[originRunway]?.entry;
                            const requiredExit = destGateMap?.[destRunway]?.exit;
                            const validCandidates = candidates.filter((c) => {
                              // Runway-dependent gate: if a required entry gate is set, only allow that portão
                              if (requiredEntry && c.name.toLowerCase().includes(requiredEntry.toLowerCase()) === false) {
                                // Check if this is one of the gated aerodromes' portões
                                const gateNames = originGateMap ? Object.values(originGateMap).flatMap((g) => [g.entry, g.exit]) : [];
                                if (gateNames.some((gn) => c.name.toLowerCase().includes(gn.toLowerCase()))) return false;
                              }
                              if (requiredExit && c.name.toLowerCase().includes(requiredExit.toLowerCase()) === false) {
                                const gateNames = destGateMap ? Object.values(destGateMap).flatMap((g) => [g.entry, g.exit]) : [];
                                if (gateNames.some((gn) => c.name.toLowerCase().includes(gn.toLowerCase()))) return false;
                              }
                              for (const seg of c.segments) {
                                const farWp = c.wps[0]!;
                                const dToA = haversineDistanceNm(farWp.lat, farWp.lng, seg.fixoA.lat, seg.fixoA.lon);
                                const dToB = haversineDistanceNm(farWp.lat, farWp.lng, seg.fixoB.lat, seg.fixoB.lon);
                                if (dToA < dToB && seg.rumoAtoB === null) return false;
                                if (dToB < dToA && seg.rumoBtoA === null) return false;
                              }
                              return true;
                            });

                            let combinedCompAlt = compAlt;
                            if (validCandidates.length > 0) {
                              validCandidates.sort((a, b) => a.bearingDiff - b.bearingDiff);
                              const best = validCandidates[0]!;
                              const connWithoutJunction = best.wps.slice(0, -1);
                              combinedWps = [...connWithoutJunction, ...wps];
                              combinedName = `${best.name} + ${corridor.name}`;

                              // Merge connector altitude constraints
                              let cAltMin = altRange?.min ?? 0;
                              let cAltMax = altRange?.max ?? Infinity;
                              for (const seg of best.segments) {
                                // Compulsory from connector overrides
                                const dirComp = seg.altCompAtoB ?? seg.altCompBtoA;
                                if (dirComp != null) combinedCompAlt = dirComp;
                                else if (seg.altComp != null) combinedCompAlt = seg.altComp;

                                const sMin = seg.altMinAtoB || seg.altMinBtoA;
                                const sMax = seg.altMaxAtoB || seg.altMaxBtoA;
                                if (sMin > 0) cAltMin = Math.max(cAltMin, sMin);
                                if (sMax > 0) cAltMax = Math.min(cAltMax, sMax);
                              }
                              combinedAltRange = cAltMin > 0 && cAltMax < Infinity ? { min: cAltMin, max: cAltMax } : altRange;
                            }

                            // Exit-side connector: find a corridor that bridges the exit toward destination
                            if (destination && combinedWps.length >= 2) {
                              const exitWp = combinedWps[combinedWps.length - 1]!;
                              const currentExitDist = haversineDistanceNm(exitWp.lat, exitWp.lng, destination.latitude, destination.longitude);

                              interface ExitCandidate {
                                appendWps: RouteWaypoint[];
                                junctionIdx: number;
                                destDist: number;
                                name: string;
                                segments: typeof corridor.segments;
                              }
                              const exitCandidates: ExitCandidate[] = [];

                              for (const other of region.corridors) {
                                if (other.name === corridor.name) continue;
                                if (combinedName.includes(other.name)) continue;
                                const otherSegs = [...other.segments].sort((a, b) => a.trecho - b.trecho);
                                const otherWps: RouteWaypoint[] = [];
                                const seenE = new Set<string>();
                                for (const seg of otherSegs) {
                                  for (const fix of [seg.fixoA, seg.fixoB]) {
                                    const k = `${fix.lat.toFixed(4)},${fix.lon.toFixed(4)}`;
                                    if (!seenE.has(k) && fix.nome) {
                                      seenE.add(k);
                                      otherWps.push({ lat: fix.lat, lng: fix.lon, name: fix.nome });
                                    }
                                  }
                                }
                                if (otherWps.length < 2) continue;

                                // Find shared waypoint between combinedWps and this corridor
                                for (let ci = 0; ci < combinedWps.length; ci++) {
                                  const cw = combinedWps[ci]!;
                                  const cwKey = `${cw.lat.toFixed(4)},${cw.lng.toFixed(4)}`;
                                  const otherIdx = otherWps.findIndex((ow) => `${ow.lat.toFixed(4)},${ow.lng.toFixed(4)}` === cwKey);
                                  if (otherIdx < 0) continue;

                                  // Find destination-nearest wp in other corridor
                                  let destNearestIdx = 0;
                                  let destNearestDist = Infinity;
                                  for (let i = 0; i < otherWps.length; i++) {
                                    const d = haversineDistanceNm(otherWps[i]!.lat, otherWps[i]!.lng, destination.latitude, destination.longitude);
                                    if (d < destNearestDist) { destNearestDist = d; destNearestIdx = i; }
                                  }

                                  // Only useful if the other corridor gets closer to destination
                                  if (destNearestDist >= currentExitDist) continue;

                                  // Extract sub-path from junction to dest-nearest
                                  const eStart = Math.min(otherIdx, destNearestIdx);
                                  const eEnd = Math.max(otherIdx, destNearestIdx);
                                  const eSub = otherWps.slice(eStart, eEnd + 1);
                                  // Order: junction first, dest-nearest last
                                  const ordered = otherIdx <= destNearestIdx ? eSub : [...eSub].reverse();
                                  // Remove junction (already in combinedWps)
                                  const appendWps = ordered.slice(1);
                                  if (appendWps.length === 0) continue;

                                  exitCandidates.push({
                                    appendWps,
                                    junctionIdx: ci,
                                    destDist: destNearestDist,
                                    name: other.name,
                                    segments: otherSegs,
                                  });
                                }
                              }

                              if (exitCandidates.length > 0) {
                                exitCandidates.sort((a, b) => a.destDist - b.destDist);
                                const bestExit = exitCandidates[0]!;
                                // Trim main corridor at junction and append exit corridor
                                combinedWps = [...combinedWps.slice(0, bestExit.junctionIdx + 1), ...bestExit.appendWps];
                                combinedName = `${combinedName} + ${bestExit.name}`;
                              }
                            }

                            setRouteWaypoints(combinedWps);
                            setFollowedCorridorName(combinedName);
                            setCorridorAltRange(combinedAltRange);
                            setCorridorCompAlt(combinedCompAlt);
                          }}
                          className={`px-2 py-1.5 ${cIdx < arr.length - 1 ? 'border-b border-border' : ''} ${isFollowed ? 'bg-green-50' : ''}`}
                        >
                          <View className="flex-row items-center gap-2">
                            <View
                              className="w-2 h-2 rounded-full"
                              style={{ backgroundColor: isFollowed ? '#16a34a' : corridor.tipo === 'Obrig' ? '#dc2626' : '#2563eb' }}
                            />
                            <Text className="text-xs font-semibold text-foreground">{corridor.name}</Text>
                            <Text className="text-[10px] text-muted-foreground">
                              ({corridor.tipo === 'Obrig' ? t('vfr.reaMandatory') : t('vfr.reaRecommended')})
                            </Text>
                            {compAlt != null ? (
                              <Text className="text-[9px] font-semibold text-amber-600">
                                {compAlt} ft ✦
                              </Text>
                            ) : altRange ? (
                              <Text className="text-[9px] text-muted-foreground">
                                {altRange.min}–{altRange.max} ft
                              </Text>
                            ) : null}
                            {isBest ? (
                              <View className="rounded px-1 py-0.5 bg-green-100">
                                <Text className="text-[8px] font-bold text-green-700">{t('vfr.reaBestMatch')}</Text>
                              </View>
                            ) : null}
                            {isFollowed ? (
                              <View className="rounded px-1 py-0.5 bg-green-600">
                                <Text className="text-[8px] font-bold text-white">✓ {t('vfr.reaFollow')}</Text>
                              </View>
                            ) : null}
                          </View>
                          {wps.length > 0 ? (
                            <Text className="text-[10px] text-muted-foreground mt-0.5 ml-4" numberOfLines={1}>
                              {wps.map((w) => w.name).join(' → ')}
                            </Text>
                          ) : null}
                        </Pressable>
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
          <View className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 gap-0.5">
            <Row label={t('aircraft.emptyWeight')} value={formatWeight(selectedAircraft.emptyWeightKg, wu)} />
            <Row label={t('aircraft.mtow')} value={formatWeight(selectedAircraft.mtowKg, wu)} bold />
            <Row label={t('aircraft.usefulLoad')} value={formatWeight(selectedAircraft.mtowKg - selectedAircraft.emptyWeightKg, wu)} />
            <Row label={t('aircraft.fuelCapacity')} value={formatVolume(selectedAircraft.fuelCapacityL, vu)} />
            <Row label={t('aircraft.cruiseSpeed')} value={formatSpeed(selectedAircraft.cruiseSpeedKts, su)} />
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
              label={`${t('aircraft.payload')} (${t('aircraft.maxLabel')} ${formatWeight(Math.max(0, selectedAircraft.mtowKg - selectedAircraft.emptyWeightKg - fuelOnBoardKg), wu)})`}
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
                  label={`${t(station.labelKey)} (${t('aircraft.maxLabel')} ${formatWeight(station.maxKg, wu)})`}
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
            <Row label={t('aircraft.payload')} value={formatWeight(payloadKg, wu)} />
            <Row label={t('aircraft.fuelWeight')} value={formatWeight(fuelOnBoardKg, wu)} />
            <View className="my-1 border-t border-border/50" />
            <Row label={t('aircraft.takeoffWeight')} value={`${formatWeight(takeoffWeightKg, wu)}  /  ${formatWeight(selectedAircraft.mtowKg, wu)}`} bold />
            {mtowExcessKg > 0 ? (
              <Text className="mt-1 text-xs font-semibold text-destructive">
                {t('aircraft.overMtow', { excess: formatWeight(mtowExcessKg, wu) })}
              </Text>
            ) : takeoffWeightKg > 0 ? (
              <Text className="mt-1 text-xs font-medium text-green-600">
                {t('aircraft.withinLimits')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Section>

      {/* ====== REMARKS (Item 18) ====== */}
      <Section title={t('vfr.remarksTitle')}>
        {autoRemarks ? (
          <View className="mb-2 rounded-sm border border-border bg-surface-muted px-3 py-2">
            <Text className="text-[10px] font-medium text-muted-foreground">{t('vfr.remarksAuto')}</Text>
            <Text className="mt-0.5 font-mono text-xs text-foreground" selectable>{autoRemarks}</Text>
          </View>
        ) : null}
        <Input
          label={t('vfr.remarksUser')}
          value={userRemarks}
          onChangeText={setUserRemarks}
          placeholder={t('vfr.remarksPlaceholder')}
        />
        {fullRemarks ? (
          <View className="mt-2 rounded-sm border border-primary/20 bg-primary/5 px-3 py-2">
            <Text className="text-[10px] font-medium text-primary">{t('vfr.remarksPreview')}</Text>
            <Text className="mt-0.5 font-mono text-xs text-foreground" selectable>{fullRemarks}</Text>
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
              <Text className="mt-0.5 text-[9px] text-muted-foreground">{formatFuelFlow(consumptionKgH, vu)}</Text>
            ) : null}
          </View>
          <View style={{ minWidth: 64, maxWidth: 80 }}>
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
                <Row label={t('vfr.tripFuel')} value={formatFuelWeight(tripFuelKg, vu)} />
                <Row label={t('vfr.tripTime')} value={`${Math.floor(tripMinutes / 60)}h${String(tripMinutes % 60).padStart(2, '0')}min`} />
              </>
            ) : null}
            {altFuelKg > 0 ? (
              <Row label={t('vfr.altFuel')} value={`${formatFuelWeight(altFuelKg, vu)} (${altDistNm.toFixed(0)} NM)`} />
            ) : null}
            {contingencyFuelKg > 0 ? (
              <Row label={`${t('vfr.contingency')} (${contingencyPct}%)`} value={formatFuelWeight(contingencyFuelKg, vu)} />
            ) : null}
            <Row label={`${t('vfr.reserveFuel')} (${reserveMinutes} min)`} value={formatFuelWeight(reserveFuelKg, vu)} />
            {minFuelKg > 0 ? (
              <>
                <View className="my-1 border-t border-border/50" />
                <Row label={t('vfr.minFuel')} value={formatFuelWeight(minFuelKg, vu)} bold />
              </>
            ) : null}
          </View>
        ) : null}

        {/* Fuel on board — auto-suggested, user can override */}
        <View className="mb-3">
          <Input
            label={selectedAircraft
              ? `${t('vfr.fuelOnBoard')} (${t('aircraft.maxLabel')} ${formatVolume(selectedAircraft.fuelCapacityL, vu)})`
              : t('vfr.fuelOnBoard')}
            value={fuelCurrentTotal}
            onChangeText={(v) => { setFuelManuallyEdited(true); setFuelCurrentTotal(v); }}
            keyboardType="numeric"
            placeholder="0"
          />
          {fuelOnBoardKg > 0 ? (
            <Text className="mt-0.5 text-[9px] text-muted-foreground">{formatFuelWeight(fuelOnBoardKg, vu)}</Text>
          ) : null}
          {maxFuelKg > 0 && fuelOnBoardKg > maxFuelKg ? (
            <Text className="mt-0.5 text-[10px] font-semibold text-destructive">
              {t('vfr.overCapacity', { excess: formatFuelWeight(fuelOnBoardKg - maxFuelKg, vu) })}
            </Text>
          ) : null}
          {minFuelKg > 0 && fuelOnBoardKg > 0 && fuelOnBoardKg < minFuelKg ? (
            <Text className="mt-0.5 text-[10px] font-semibold text-destructive">
              {t('vfr.fuelInsufficient', { deficit: formatFuelWeight(minFuelKg - fuelOnBoardKg, vu) })}
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
            <Row label={t('vfr.perWing')} value={formatFuelWeight(perWingKg, vu)} />
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

      {/* ====== ACTIONS ====== */}
      <View className="flex-row gap-3 px-4 pb-6 md:px-6">
        <Pressable
          className="flex-1 rounded-button bg-primary px-6 py-3 active:opacity-80 disabled:opacity-50"
          onPress={handleSave}
          disabled={saving || !origin || !destination}
        >
          <Text className="text-center font-medium text-primary-foreground">
            {saving ? t('common.saving') : t('common.save')}
          </Text>
        </Pressable>
        {Platform.OS === 'web' && (
          <Pressable
            className="rounded-button border border-primary bg-transparent px-6 py-3 active:opacity-80 disabled:opacity-50"
            onPress={handleExportPdf}
            disabled={!origin || !destination}
          >
            <Text className="text-center font-medium text-primary">
              {t('vfr.exportPdf')}
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );

  return (
    <>
      <VfrPlanLayout
        mapElement={mapElement}
        sidebarContent={sidebarContent}
      />
      {showExportModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowExportModal(false)}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => { if (!exporting) setShowExportModal(false); }}
          >
            <Pressable
              style={{ width: '90%', maxWidth: 380 }}
              className="rounded-lg border border-border bg-card p-5 shadow-xl"
              onPress={() => {}}
            >
              <Text className="mb-4 text-base font-bold text-foreground">{t('vfr.exportTitle')}</Text>

              <Pressable
                className="flex-row items-center gap-3 py-2"
                onPress={() => setExportIncludeCharts((v) => !v)}
                disabled={exporting}
              >
                <View className={`h-5 w-5 items-center justify-center rounded border ${exportIncludeCharts ? 'border-primary bg-primary' : 'border-border'}`}>
                  {exportIncludeCharts ? <Text className="text-xs font-bold text-primary-foreground">✓</Text> : null}
                </View>
                <Text className="text-sm text-foreground">{t('vfr.exportIncludeCharts')}</Text>
              </Pressable>

              {hasChecklists ? (
                <Pressable
                  className="flex-row items-center gap-3 py-2"
                  onPress={() => setExportIncludeChecklist((v) => !v)}
                  disabled={exporting}
                >
                  <View className={`h-5 w-5 items-center justify-center rounded border ${exportIncludeChecklist ? 'border-primary bg-primary' : 'border-border'}`}>
                    {exportIncludeChecklist ? <Text className="text-xs font-bold text-primary-foreground">✓</Text> : null}
                  </View>
                  <Text className="text-sm text-foreground">{t('vfr.exportIncludeChecklist')}</Text>
                </Pressable>
              ) : null}

              {(exportIncludeCharts || exportIncludeChecklist) ? (
                <Text className="mt-2 text-[11px] text-muted-foreground">{t('vfr.exportAttachmentNote')}</Text>
              ) : null}

              {exporting ? (
                <View className="mt-5 items-center gap-2 py-2">
                  <ActivityIndicator size="small" color="#2254cc" />
                  <Text className="text-sm text-muted-foreground">{t('vfr.exportExporting')}</Text>
                </View>
              ) : (
                <View className="mt-5 flex-row gap-3">
                  <Pressable
                    className="flex-1 rounded-button border border-border px-4 py-2.5"
                    onPress={() => setShowExportModal(false)}
                  >
                    <Text className="text-center text-sm font-medium text-foreground">{t('vfr.exportCancel')}</Text>
                  </Pressable>
                  <Pressable
                    className="flex-1 rounded-button bg-primary px-4 py-2.5"
                    onPress={() => { void handleExportConfirm(); }}
                  >
                    <Text className="text-center text-sm font-medium text-primary-foreground">
                      {t('vfr.exportConfirm')}
                    </Text>
                  </Pressable>
                </View>
              )}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </>
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
  const overlayRef = useRef<DomElement | null>(null);

  // Inline PDF iframe
  useEffect(() => {
    if (Platform.OS !== 'web' || !expanded || !iframeRef.current) return;
    const doc = getDoc();
    if (!doc) return;
    const el = iframeRef.current as unknown as DomElement;
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
    extBtn.onclick = () => openExternal(pdfUrl);
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

    const handleEsc = (e: DomKeyboardEvent) => { if (e.key === 'Escape') setMaximized(false); };
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
              onPress={() => openExternal(pdfUrl)}
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
