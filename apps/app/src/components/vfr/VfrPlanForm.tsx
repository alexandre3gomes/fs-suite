import type { AnyAircraftProfile, UserAircraftProfile, WeightStation } from '@fs-suite/types';
import { Input } from '@fs-suite/ui';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { toPng } from 'html-to-image';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { getChecklistsForAircraft } from '../../data/checklistCatalog';
import { useAircraftProfiles } from '../../hooks/useAircraftProfiles';
import { notify } from '../../lib/notify';
import { trackAction, trackSuccess, trackFailure, categorizeError } from '../../services/analytics';
import { apiClient, API_URL } from '../../services/api.client';
import { exportFlightPlanLnm } from '../../services/lnmpln-export';
import type { AiValidationResult } from '../../services/pdf-export';
import { buildFlightPlanDoc, exportFlightPlanWithAttachments } from '../../services/pdf-export';
import { exportFlightPlanCharts, exportFlightPlanPln } from '../../services/pln-export';
import { skyVectorApi } from '../../services/skyvector.service';
import { useUnitsStore, formatWeight, formatFuel, formatSpeed, kgToFuelAmount, fuelAmountToKg, fuelFlowSuffix, type FuelUnit } from '../../stores/units.store';
import { CopyButton } from '../CopyButton';

import { AerodromeMap, type AerodromeOverlay } from './AerodromeMap';
import { AerodromeSearch, type Aerodrome } from './AerodromeSearch';
import { AircraftProfileModal } from './AircraftProfileModal';
import { AircraftSelect } from './AircraftSelect';
import { ChartsPanel, type ChartOverlay } from './ChartsPanel';
import { ChecklistPanel } from './ChecklistPanel';
import { MetarDisplay, type ParsedMetar } from './MetarDisplay';
import { NearbyPoisPanel } from './NearbyPoisPanel';
import { ReaChartsPanel } from './ReaChartsPanel';
import { ReaCorridorSuggestions, type ReaDetectionRegion } from './ReaCorridorSuggestions';
import { SimBriefPanel, type SimBriefOfpData } from './SimBriefPanel';
import { TafDisplay, type ParsedTaf } from './TafDisplay';
import { VfrPlanLayout } from './VfrPlanLayout';
import { type DomElement, type DomKeyboardEvent, getDoc, openExternal } from './dom-types';
import { AVGAS_KG_PER_L, computeFuelPlan, formatEndurance } from './vfrFuel';
import { type RouteWaypoint, type AltitudeTransition, type RouteSegment, type TocTodPosition, type EnrichedLeg, type AircraftPerformance, type ClimbDescentPlan, type LegAltConstraint, toVfrCoord, buildVfrRouteText, parseVfrRouteText, buildItem18, calculateRouteLegs, haversineDistanceNm, suggestCruiseLevel, suggestIfrCruiseLevel, calculateTodDistance, getVfrRuleInfo, filterAltitudesByCloudClearance, type AltitudeClearance, formatAltitudeIcao, parseCruiseLevelFt, getDefaultTransitionAltitude, getPerformanceCategory, calculateDefaultTpaFt, segmentRouteLegs, calculateTocDistance, calculateTodFromTpa, interpolatePositionOnRoute, enrichRouteLegs, computeClimbDescentPlan, computeAltitudeProfile } from './vfrNavigation';
import { defaultDepartureTime, toDatetimeLocalValue, fromDatetimeLocalValue, formatZulu, isNightFlight, validateVfrPlan, type PlanViability } from './weatherTimeUtils';

function SimpleMarkdown({ text, italic }: { text: string; italic?: boolean }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;

  const flushTable = () => {
    if (tableRows.length === 0) return;
    const headers = tableRows[0] ?? [];
    const dataRows = tableRows.filter((_, i) => i >= 2);
    elements.push(
      <View key={`tbl-${elements.length}`} className="my-2 rounded border border-border overflow-hidden">
        {headers.length > 0 && (
          <View className="flex-row bg-surface-muted">
            {headers.map((h, i) => (
              <View key={i} className="flex-1 px-2 py-1.5 border-r border-border">
                <Text className="text-[10px] font-semibold text-foreground">{h.trim()}</Text>
              </View>
            ))}
          </View>
        )}
        {dataRows.map((row, ri) => (
          <View key={ri} className="flex-row border-t border-border">
            {row.map((cell, ci) => (
              <View key={ci} className="flex-1 px-2 py-1 border-r border-border">
                <Text className="text-[10px] text-muted-foreground">{cell.trim()}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>,
    );
    tableRows = [];
    inTable = false;
  };

  for (const line of lines) {
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      inTable = true;
      const cells = line.split('|').slice(1, -1);
      tableRows.push(cells);
      continue;
    }
    if (inTable) flushTable();

    const trimmed = line.trim();
    if (!trimmed) continue;

    if (/^[-|:\s]+$/.test(trimmed)) continue;

    if (trimmed.startsWith('### ')) {
      elements.push(<Text key={elements.length} className="text-xs font-semibold text-foreground mt-2 mb-0.5">{trimmed.slice(4)}</Text>);
    } else if (trimmed.startsWith('## ')) {
      elements.push(<Text key={elements.length} className="text-sm font-semibold text-foreground mt-2 mb-0.5">{trimmed.slice(3)}</Text>);
    } else if (trimmed.startsWith('# ')) {
      elements.push(<Text key={elements.length} className="text-sm font-bold text-foreground mt-2 mb-0.5">{trimmed.slice(2)}</Text>);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      const content = trimmed.slice(2).replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
      elements.push(
        <View key={elements.length} className="flex-row ml-2 mt-0.5">
          <Text className="text-xs text-muted-foreground mr-1.5">•</Text>
          <Text className={`text-xs text-muted-foreground leading-5 flex-1 ${italic ? 'italic' : ''}`}>{content}</Text>
        </View>,
      );
    } else {
      const content = trimmed.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
      elements.push(<Text key={elements.length} className={`text-xs text-muted-foreground leading-5 ${italic ? 'italic' : ''}`}>{content}</Text>);
    }
  }
  if (inTable) flushTable();

  return <View>{elements}</View>;
}

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
  timeMin?: number;
  groundSpeedKts?: number;
  magneticHeading?: number;
  selectedAltitudeFt?: number;
}

export interface VfrPlanData {
  originIcao: string;
  originName: string;
  originElevationFt?: number;
  originRunwayInUse?: string;
  originMetarRaw?: string;
  originTafRaw?: string;
  originLatitude?: number;
  originLongitude?: number;
  destinationIcao: string;
  destinationName: string;
  destinationElevationFt?: number;
  destinationRunwayInUse?: string;
  destinationMetarRaw?: string;
  destinationTafRaw?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  destinationTpaFt?: number;
  destinationTpaSource?: 'default' | 'custom';
  altitudeChanges?: { atWaypoint: string; toAltFt: number }[];
  alternateIcao?: string;
  alternateName?: string;
  alternateElevationFt?: number;
  alternateRunwayInUse?: string;
  alternateMetarRaw?: string;
  alternateTafRaw?: string;
  alternateLatitude?: number;
  alternateLongitude?: number;
  originRunways?: { ident: string; headingDeg: number | null; lengthFt: number | null }[];
  destinationRunways?: { ident: string; headingDeg: number | null; lengthFt: number | null }[];
  alternateRunways?: { ident: string; headingDeg: number | null; lengthFt: number | null }[];
  reaCorridors?: { regionName: string; corridorName: string; tipo: string; segments: { from: string; to: string; altMin: number; altMax: number; altComp: number | null }[] }[];
  routeText?: string;
  cruiseLevel?: string;
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
  registration?: string;
  simbriefOfpId?: string;
  status?: 'DRAFT' | 'COMPLETED';
  routeWaypoints?: { lat: number; lng: number; name: string }[];
  routes?: { sequence: number; waypointIdent: string; latitude: number; longitude: number }[];
  routeLegs?: PlanRouteLeg[];
  totalDistanceNm?: number;
  tripMinutes?: number;
  cruiseSpeedKts?: number;
  tripFuelKg?: number;
  altFuelKg?: number;
  altDistanceNm?: number;
  alternateRouteWaypoints?: { lat: number; lng: number; name: string }[];
  alternateRouteText?: string;
  alternateTotalDistanceNm?: number;
  alternatePlannedAltitude?: number;
  contingencyPct?: number;
  contingencyFuelKg?: number;
  reserveFuelKg?: number;
  minFuelKg?: number;
  flightCondition?: 'day' | 'night';
  emptyWeightKg?: number;
  payloadKg?: number;
  fuelCapacityL?: number;
  fuelBurnLph?: number;
  aircraftStations?: unknown;
  stations?: { id: string; labelKey: string; maxKg: number; arm: number }[];
  remarks?: string;
  performanceCategory?: string;
  item18Text?: string;
  plannedDepartureTime?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  VFR: '#16a34a',
  MVFR: '#2563eb',
  IFR: '#dc2626',
  LIFR: '#d946ef',
};

interface Props {
  initialData?: VfrPlanData;
  onSave: (data: VfrPlanData) => Promise<void>;
  saving: boolean;
  onDelete?: () => void;
}

function formatLegMmSs(min: number): string {
  const totalSec = Math.round(min * 60);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Inline-editable altitude cell for the leg table. Commits on blur or Enter;
 * shows the current per-leg altitude as a plain numeric value.
 */
function EditableAltCell({
  value,
  onCommit,
}: {
  value: number | null;
  onCommit: (altFt: number) => void;
}) {
  const [draft, setDraft] = useState<string>(value != null ? String(value) : '');

  useEffect(() => {
    setDraft(value != null ? String(value) : '');
  }, [value]);

  const commit = () => {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n > 0 && n !== value) {
      onCommit(n);
    } else {
      setDraft(value != null ? String(value) : '');
    }
  };

  return (
    <TextInput
      value={draft}
      onChangeText={(v) => setDraft(v.replace(/[^0-9]/g, ''))}
      onBlur={commit}
      onSubmitEditing={commit}
      keyboardType="numeric"
      placeholder="—"
      className="w-20 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-center text-[10px] text-foreground"
    />
  );
}

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View className="flex-row items-center gap-1.5">
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityLabel={text}
      >
        <Text className="text-[10px] text-muted-foreground">ⓘ</Text>
      </Pressable>
      {open ? (
        <Pressable onPress={() => setOpen(false)} className="rounded-sm bg-primary/5 px-2 py-0.5">
          <Text className="text-[11px] text-muted-foreground">{text}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- SVG Icon helpers (web only, uses ref to set innerHTML) ----------

function SvgIcon({ svg, size = 18 }: { svg: string; size?: number }) {
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS === 'web' && ref.current) {
      (ref.current as unknown as { innerHTML: string }).innerHTML = svg;
    }
  }, [svg]);
  return <View ref={ref} style={{ width: size, height: size }} />;
}

const ICON_SAVE = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
const ICON_AI = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.09 6.26L20 10l-5.91 1.74L12 18l-2.09-6.26L4 10l5.91-1.74z"/><path d="M18 18l1 3 1-3 3-1-3-1-1-3-1 3-3 1z"/></svg>`;
const ICON_PDF = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><polyline points="9 15 12 18 15 15"/></svg>`;
const ICON_TRASH = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
const ICON_ROUTE = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>`;
const ICON_PLN = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></svg>`;
const ICON_LNM = (c = '#fff') => `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`;

function FabButton({ onPress, disabled, svg, title, bg, size = 34 }: { onPress: () => void; disabled?: boolean; svg: string; title: string; bg: string; size?: number }) {
  const iconSize = Math.round(size * 0.48);
  const btnRef = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS === 'web' && btnRef.current && title) {
      (btnRef.current as unknown as { title: string }).title = title;
    }
  }, [title]);
  return (
    <Pressable
      ref={btnRef}
      onPress={onPress}
      disabled={disabled}
      style={{
        width: size, height: size, borderRadius: size / 2, backgroundColor: bg,
        opacity: disabled ? 0.35 : 0.75,
        alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.2, shadowRadius: 4, elevation: 4,
        ...(Platform.OS === 'web' ? { cursor: disabled ? 'default' : 'pointer', transition: 'opacity 0.15s' } as Record<string, unknown> : {}),
      }}
    >
      <SvgIcon svg={svg} size={iconSize} />
    </Pressable>
  );
}

// ---------- Component ----------

export function VfrPlanForm({ initialData, onSave, saving, onDelete }: Props) {
  const { t } = useTranslation();
  const { weight: wu, fuel: fu, speed: su } = useUnitsStore();
  const { entries: aircraftEntries, catalog: aircraftCatalog, shared: sharedProfiles, loading: catalogLoading, error: catalogError, refresh: refreshProfiles } = useAircraftProfiles();

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

  // Departure time
  const [plannedDepartureTime, setPlannedDepartureTime] = useState<Date>(
    initialData?.plannedDepartureTime
      ? new Date(initialData.plannedDepartureTime)
      : defaultDepartureTime(),
  );

  // Aerodrome state
  const [origin, setOrigin] = useState<Aerodrome | null>(null);
  const [destination, setDestination] = useState<Aerodrome | null>(null);
  const [alternate, setAlternate] = useState<Aerodrome | null>(null);

  // Aerodrome details (with runways)
  const [originDetail, setOriginDetail] = useState<AerodromeWithRunways | null>(null);
  const [destDetail, setDestDetail] = useState<AerodromeWithRunways | null>(null);

  // Active aerodrome chart overlay shown on the map (single-overlay MVP)
  // Multiple chart overlays plot at once (origin / destination / alternate VACs).
  const [activeAerodromeOverlays, setActiveAerodromeOverlays] = useState<AerodromeOverlay[]>([]);
  const handleShowAerodromeOverlay = useCallback((o: ChartOverlay) => {
    setActiveAerodromeOverlays((prev) => (prev.some((x) => x.id === o.id) ? prev : [...prev, o]));
    trackAction('aerodrome_overlay_shown', { icao: o.icao, chart_type: o.chartType });
  }, []);
  // Remove a specific overlay by its chart source URL (ChartsPanel toggle).
  const handleHideAerodromeOverlay = useCallback((chartUrl: string) => {
    setActiveAerodromeOverlays((prev) => prev.filter((x) => x.sourceUrl !== chartUrl));
  }, []);
  // Remove a specific overlay by its id (the map control's ✕ button).
  const handleCloseAerodromeOverlay = useCallback((id: string) => {
    setActiveAerodromeOverlays((prev) => prev.filter((x) => x.id !== id));
  }, []);

  // Map state

  const mapHandleRef = useRef<{
    flyTo: (lat: number, lng: number) => void;
    getContainer: () => HTMLElement | null;
    fitRouteBounds: () => { center: [number, number]; zoom: number } | null;
    setView: (center: [number, number], zoom: number) => void;
  } | null>(null);

  // Route waypoints (intermediate, added via map context menu)
  const [routeWaypoints, setRouteWaypoints] = useState<RouteWaypoint[]>(
    initialData?.routeWaypoints ?? [],
  );
  const [followedCorridorName, setFollowedCorridorName] = useState<string | null>(null);
  const [corridorAltRange, setCorridorAltRange] = useState<{ min: number; max: number } | null>(null);
  const [corridorCompAlt, setCorridorCompAlt] = useState<number | null>(null);

  // Alternate-leg (destination → alternate) parity. Same shape as main route
  // but stored separately because ICAO Item 15 only carries the main route.
  // REA Obrig compliance is mandatory for this leg too (ICA 100-12).
  const [alternateRouteWaypoints, setAlternateRouteWaypoints] = useState<RouteWaypoint[]>(
    initialData?.alternateRouteWaypoints ?? [],
  );
  const [followedAlternateCorridorName, setFollowedAlternateCorridorName] = useState<string | null>(null);
  const [alternateRouteText, setAlternateRouteText] = useState(initialData?.alternateRouteText ?? '');
  const [alternatePlannedAltitudeFt, setAlternatePlannedAltitudeFt] = useState<number | null>(
    initialData?.alternatePlannedAltitude ?? null,
  );
  // Detected REA corridors crossed by the destination→alternate segment.
  const [alternateReaRegions, setAlternateReaRegions] = useState<ReaDetectionRegion[]>([]);

  // Fetch per-leg REA altitude constraints when route changes
  useEffect(() => {
    if (!origin || !destination || routeWaypoints.length === 0) {
      setReaLegAltitudes([]);
      return;
    }
    const allWps: { lat: number; lon: number; name: string }[] = [
      { lat: origin.latitude, lon: origin.longitude, name: origin.icao },
      ...routeWaypoints.map((w) => ({ lat: w.lat, lon: w.lng, name: w.name })),
      { lat: destination.latitude, lon: destination.longitude, name: destination.icao },
    ];
    const wpsStr = allWps.map((w) => `${w.lat}:${w.lon}`).join(',');
    apiClient
      .get<{ legs: { altComp: number | null; altMin: number; altMax: number; from: string }[] }>(`/rea/navigate/altitudes?waypoints=${encodeURIComponent(wpsStr)}`)
      .then((data) => {
        const legs: LegAltConstraint[] = data.legs.map((l, i) => ({
          altComp: l.altComp,
          altMin: l.altMin,
          altMax: l.altMax,
          fromName: allWps[i]?.name ?? l.from,
          toName: allWps[i + 1]?.name,
        }));
        setReaLegAltitudes(legs);
      })
      .catch(() => setReaLegAltitudes([]));
  }, [origin, destination, routeWaypoints]);

  // METAR state
  const [metars, setMetars] = useState<Record<string, ParsedMetar>>({});
  const [metarLoading, setMetarLoading] = useState(false);

  // TAF state
  const [tafs, setTafs] = useState<Record<string, ParsedTaf>>({});
  const [tafLoading, setTafLoading] = useState(false);

  // Route safety (aerodrome wx + SIGMET intersection + winds aloft)
  interface RouteSafetyData {
    items: { id: string; severity: string; message: string; action?: string; source?: string }[];
    performanceAdjustments?: {
      averageHeadwindKts: number;
      estimatedTimeIncreaseMinutes: number;
      additionalFuelRequiredKg: number;
    };
    hazardSegments: { fromIdx: number; toIdx: number; hazardType: string; severity: string }[];
  }
  const [routeSafety, setRouteSafety] = useState<RouteSafetyData | null>(null);
  const [routeSafetyLoading, setRouteSafetyLoading] = useState(false);

  // Alternate suggestions
  const [altSuggestions, setAltSuggestions] = useState<(Aerodrome & { distNm: number; flightCategory?: string | null })[]>([]);
  const [altSugLoading, setAltSugLoading] = useState(false);

  // Runway in use
  const [originRunway, setOriginRunway] = useState('');
  const [destRunway, setDestRunway] = useState('');
  const [altRunway, setAltRunway] = useState('');

  // Destination TPA (Traffic Pattern Altitude) — editable, defaults computed by aircraft category
  const [destTpaCustomFt, setDestTpaCustomFt] = useState<number | null>(initialData?.destinationTpaSource === 'custom' ? initialData?.destinationTpaFt ?? null : null);

  // Manual altitude transitions defined by the pilot for longer flights
  // (multi-corridor, terrain changes, etc.). Each entry: at waypoint X, change to altitude Y ft.
  const [altitudeChanges, setAltitudeChanges] = useState<{ atWaypoint: string; toAltFt: number }[]>(initialData?.altitudeChanges ?? []);
  // Tracks whether altitudeChanges came from the auto-profile (so we can update them on route changes).
  // Set to false on initial load when the plan has saved manual data, to preserve user choices.
  const [altChangesAuto, setAltChangesAuto] = useState<boolean>(!initialData?.altitudeChanges && !initialData?.cruiseLevel);

  // REA per-leg altitude constraints from the backend
  const [reaLegAltitudes, setReaLegAltitudes] = useState<LegAltConstraint[]>([]);

  // Route
  const [routeText, setRouteText] = useState(initialData?.routeText ?? '');
  const [cruiseLevel, setCruiseLevel] = useState(initialData?.cruiseLevel ?? '');
  const [segmentLevels, setSegmentLevels] = useState<Record<string, string>>({});
  const toFL = (ft: number) => formatAltitudeIcao(ft, origin?.icao);
  const [todDistanceNm, setTodDistanceNm] = useState(initialData?.todDistanceNm?.toString() ?? '');

  // Aircraft & weight
  const findAircraft = useCallback(
    (icao: string) => aircraftEntries.find((e) => e.profile.icaoType === icao)?.profile ?? null,
    [aircraftEntries],
  );
  const [selectedAircraft, setSelectedAircraft] = useState<AnyAircraftProfile | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingProfile, setEditingProfile] = useState<UserAircraftProfile | null>(null);
  const [preselectedBaseId, setPreselectedBaseId] = useState<string | null>(null);
  const [weightMode, setWeightMode] = useState<'simple' | 'advanced'>('simple');
  const [simpleTotalWeight, setSimpleTotalWeight] = useState('');
  const [stationWeights, setStationWeights] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!catalogLoading && initialData?.aircraftType && !selectedAircraft) {
      const found = findAircraft(initialData.aircraftType);
      if (found) setSelectedAircraft(found);
    }
  }, [catalogLoading, initialData?.aircraftType, selectedAircraft, findAircraft]);

  // Fuel inputs store the value in the user's currently selected fuel unit
  // (kg | lbs | L | gal). Canonical kg/h and kg are derived on demand and used
  // for calculations and DB persistence.
  const initialFu = useUnitsStore.getState().fuel;
  const fuelDecimals = (unit: FuelUnit): number => (unit === 'kg' || unit === 'lbs' ? 0 : 1);
  const fuelKgToInputStr = (kg: number, unit: FuelUnit): string =>
    kg > 0 ? kgToFuelAmount(kg, unit).toFixed(fuelDecimals(unit)) : '';

  const [consumptionPerHour, setConsumptionPerHour] = useState(
    () => fuelKgToInputStr((initialData?.fuelConsumptionPerHour ?? 0) * AVGAS_KG_PER_L, initialFu),
  );
  const [fuelCurrentTotal, setFuelCurrentTotal] = useState(
    () => fuelKgToInputStr((initialData?.fuelCurrentTotal ?? 0) * AVGAS_KG_PER_L, initialFu),
  );
  const [fuelManuallyEdited, setFuelManuallyEdited] = useState(!!initialData?.fuelCurrentTotal);
  const [flightCondition, setFlightCondition] = useState<'day' | 'night'>(
    initialData?.fuelReserveMinutes === 45 ? 'night' : 'day',
  );
  const [contingencyPct, setContingencyPct] = useState('5');
  const reserveMinutes = flightCondition === 'night' ? 45 : 30;

  // Restore initial aerodromes — use pre-fetched coordinates when available, fetch details for runways
  useEffect(() => {
    const fetchDetail = async (icao: string, role: 'origin' | 'destination' | 'alternate') => {
      try {
        const detail = await apiClient.get<AerodromeWithRunways>(`/aerodromes/${icao}`);
        if (role === 'origin') {
          setOrigin((prev) => prev ? { ...prev, latitude: detail.latitude, longitude: detail.longitude, iata: detail.iata, city: detail.city, country: detail.country, type: detail.type } : prev);
          setOriginDetail(detail);
        } else if (role === 'destination') {
          setDestination((prev) => prev ? { ...prev, latitude: detail.latitude, longitude: detail.longitude, iata: detail.iata, city: detail.city, country: detail.country, type: detail.type } : prev);
          setDestDetail(detail);
        } else {
          setAlternate((prev) => prev ? { ...prev, latitude: detail.latitude, longitude: detail.longitude, iata: detail.iata, city: detail.city, country: detail.country, type: detail.type } : prev);
        }
      } catch { /* ignore */ }
    };
    const fetches: Promise<void>[] = [];
    if (initialData?.originIcao) {
      setOrigin({ icao: initialData.originIcao, name: initialData.originName, iata: null, city: null, country: null, latitude: initialData.originLatitude ?? 0, longitude: initialData.originLongitude ?? 0, elevation: initialData.originElevationFt ?? null, type: null });
      setOriginRunway(initialData.originRunwayInUse ?? '');
      fetches.push(fetchDetail(initialData.originIcao, 'origin'));
    }
    if (initialData?.destinationIcao) {
      setDestination({ icao: initialData.destinationIcao, name: initialData.destinationName, iata: null, city: null, country: null, latitude: initialData.destinationLatitude ?? 0, longitude: initialData.destinationLongitude ?? 0, elevation: initialData.destinationElevationFt ?? null, type: null });
      setDestRunway(initialData.destinationRunwayInUse ?? '');
      fetches.push(fetchDetail(initialData.destinationIcao, 'destination'));
    }
    if (initialData?.alternateIcao) {
      setAlternate({ icao: initialData.alternateIcao, name: initialData.alternateName ?? '', iata: null, city: null, country: null, latitude: initialData.alternateLatitude ?? 0, longitude: initialData.alternateLongitude ?? 0, elevation: initialData.alternateElevationFt ?? null, type: null });
      setAltRunway(initialData.alternateRunwayInUse ?? '');
      fetches.push(fetchDetail(initialData.alternateIcao, 'alternate'));
    }
    if (fetches.length > 0) {
      void Promise.all(fetches).then(() => {
        setTimeout(() => mapHandleRef.current?.fitRouteBounds(), 400);
      });
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

  const fetchTafs = useCallback(async (icaos: string[]) => {
    if (icaos.length === 0) return;
    setTafLoading(true);
    try {
      const data = await apiClient.get<ParsedTaf[]>(`/weather/taf?icaos=${icaos.join(',')}`);
      const map: Record<string, ParsedTaf> = {};
      for (const t of data) map[t.icaoId] = t;
      setTafs((prev) => ({ ...prev, ...map }));
    } catch { /* ignore */ }
    setTafLoading(false);
  }, []);

  // Reset everything tied to the previous origin/destination pair: route
  // waypoints, followed corridor, its altitude constraints, and any
  // altitude transitions (which reference waypoint names that no longer
  // exist). Without this, switching the destination keeps the waypoints
  // from the previous corridor and the leg table renders origin →
  // stale-corridor → new dest, and Item 18 RMK keeps the stale
  // altitude-change list.
  const resetCorridorState = useCallback(() => {
    setRouteWaypoints([]);
    setFollowedCorridorName(null);
    setCorridorAltRange(null);
    setCorridorCompAlt(null);
    setAltitudeChanges([]);
    setAltChangesAuto(true);
  }, []);

  // Auto-fetch on aerodrome selection + fly map to it
  const handleSelectOrigin = useCallback((a: Aerodrome) => {
    setOrigin(a);
    setOriginRunway('');
    resetCorridorState();
    void fetchAerodromeInfo(a.icao, 'origin');
    mapHandleRef.current?.flyTo(a.latitude, a.longitude);
  }, [fetchAerodromeInfo, resetCorridorState]);

  const handleSelectDestination = useCallback((a: Aerodrome) => {
    setDestination(a);
    setDestRunway('');
    resetCorridorState();
    void fetchAerodromeInfo(a.icao, 'destination');
  }, [fetchAerodromeInfo, resetCorridorState]);

  const handleSelectAlternate = useCallback((a: Aerodrome) => {
    setAlternate(a);
    setAltRunway('');
  }, []);

  // Auto-fit map to show entire route when destination or alternate changes
  useEffect(() => {
    if (!origin || !destination) return;
    const timer = setTimeout(() => {
      mapHandleRef.current?.fitRouteBounds();
    }, 300);
    return () => clearTimeout(timer);
  }, [destination?.icao, alternate?.icao]);

  // Fetch METAR + TAF for all selected aerodromes
  useEffect(() => {
    const icaos = [origin?.icao, destination?.icao, alternate?.icao].filter(Boolean) as string[];
    if (icaos.length > 0) {
      void fetchMetars(icaos);
      void fetchTafs(icaos);
    }
  }, [origin?.icao, destination?.icao, alternate?.icao, fetchMetars, fetchTafs]);

  // Silently drop overlays whose ICAO is no longer on the plan
  useEffect(() => {
    const planIcaos = new Set(
      [origin?.icao, destination?.icao, alternate?.icao].filter(Boolean) as string[],
    );
    setActiveAerodromeOverlays((prev) => {
      const next = prev.filter((o) => planIcaos.has(o.icao));
      return next.length === prev.length ? prev : next;
    });
  }, [origin?.icao, destination?.icao, alternate?.icao]);

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
  const acStations: WeightStation[] = selectedAircraft?.stations ?? [];
  const payloadKg = useMemo(() => {
    if (weightMode === 'simple') return parseFloat(simpleTotalWeight) || 0;
    if (acStations.length === 0) return 0;
    return acStations.reduce(
      (sum, s) => sum + (parseFloat(stationWeights[s.id] ?? '0') || 0),
      0,
    );
  }, [weightMode, simpleTotalWeight, acStations, stationWeights]);

  // Visual ref expanded state — tracks which leg index is expanded
  const [expandedLegRef, setExpandedLegRef] = useState<number | null>(null);

  // Route waypoint handlers
  const [pendingWaypoint, setPendingWaypoint] = useState<RouteWaypoint | null>(null);
  const [insertPosition, setInsertPosition] = useState<'before' | 'after'>('after');
  // Anchor key encoding lets one continuous list cover both segments:
  //   'origin' / 'destination' / 'alternate'  → aerodromes (positions fixed)
  //   'main-<N>'                              → index N in the main route
  //   'alt-<N>'                               → index N in the alternate route
  // The segment a new waypoint lands on is derived from the anchor + position
  // at insert time (see resolveInsert below), so the user only needs ONE
  // "Add waypoint" button — picking "after destination" lands in the
  // alternate leg automatically when an alternate aerodrome is set.
  const [insertRefIndex, setInsertRefIndex] = useState<string>('origin');

  // Pending altitude to apply once the user picks where to insert the waypoint
  const pendingAltFtRef = useRef<number | null>(null);

  const handleAddWaypoint = useCallback((wp: RouteWaypoint, altFt?: number) => {
    setPendingWaypoint(wp);
    pendingAltFtRef.current = altFt ?? null;
    setInsertPosition('after');
    // Default anchor: after the last main waypoint; origin if main is empty.
    setInsertRefIndex(routeWaypoints.length > 0 ? `main-${routeWaypoints.length - 1}` : 'origin');
  }, [routeWaypoints.length]);

  const handleRemoveAlternateWaypoint = useCallback((idx: number) => {
    setAlternateRouteWaypoints((prev) => prev.filter((_, i) => i !== idx));
    setFollowedAlternateCorridorName(null);
  }, []);

  const handleUpdateAlternateWaypoint = useCallback((idx: number, wp: RouteWaypoint) => {
    setAlternateRouteWaypoints((prev) => prev.map((w, i) => i === idx ? wp : w));
    setFollowedAlternateCorridorName(null);
  }, []);

  const confirmInsertWaypoint = useCallback(() => {
    if (!pendingWaypoint) return;
    const hasAlt = alternate != null;
    // Resolve anchor + position → (segment, insertion index inside that segment).
    const resolve = (mainLen: number, altLen: number): { segment: 'main' | 'alternate'; index: number } => {
      if (insertRefIndex === 'origin') return { segment: 'main', index: 0 };
      if (insertRefIndex === 'alternate') return { segment: 'alternate', index: altLen };
      if (insertRefIndex === 'destination') {
        if (insertPosition === 'after' && hasAlt) return { segment: 'alternate', index: 0 };
        return { segment: 'main', index: mainLen };
      }
      if (insertRefIndex.startsWith('main-')) {
        const i = parseInt(insertRefIndex.slice(5), 10);
        return { segment: 'main', index: insertPosition === 'before' ? i : i + 1 };
      }
      if (insertRefIndex.startsWith('alt-')) {
        const i = parseInt(insertRefIndex.slice(4), 10);
        return { segment: 'alternate', index: insertPosition === 'before' ? i : i + 1 };
      }
      return { segment: 'main', index: 0 };
    };
    const target = resolve(routeWaypoints.length, alternateRouteWaypoints.length);
    if (target.segment === 'alternate') {
      setAlternateRouteWaypoints((prev) => {
        const next = [...prev];
        next.splice(target.index, 0, pendingWaypoint);
        return next;
      });
      setFollowedAlternateCorridorName(null);
    } else {
      setRouteWaypoints((prev) => {
        const next = [...prev];
        next.splice(target.index, 0, pendingWaypoint);
        return next;
      });
      if (pendingAltFtRef.current != null && pendingAltFtRef.current > 0) {
        const altFt = pendingAltFtRef.current;
        const wpName = pendingWaypoint.name;
        setAltChangesAuto(false);
        setAltitudeChanges((prev) => {
          const filtered = prev.filter((t) => t.atWaypoint !== wpName);
          return [...filtered, { atWaypoint: wpName, toAltFt: altFt }];
        });
      }
      setFollowedCorridorName(null);
      setCorridorAltRange(null);
      setCorridorCompAlt(null);
    }
    pendingAltFtRef.current = null;
    setPendingWaypoint(null);
  }, [pendingWaypoint, insertPosition, insertRefIndex, alternate, routeWaypoints.length, alternateRouteWaypoints.length]);

  const handleRemoveWaypoint = useCallback((idx: number) => {
    const removedName = routeWaypoints[idx]?.name;
    setRouteWaypoints((prev) => prev.filter((_, i) => i !== idx));
    if (removedName) {
      setAltitudeChanges((prev) => prev.filter((t) => t.atWaypoint !== removedName));
    }
    setExpandedLegRef(null);
    setFollowedCorridorName(null);
    setCorridorAltRange(null);
    setCorridorCompAlt(null);
  }, [routeWaypoints]);

  const handleUpdateWaypoint = useCallback((idx: number, wp: RouteWaypoint) => {
    const oldName = routeWaypoints[idx]?.name;
    setRouteWaypoints((prev) => prev.map((w, i) => i === idx ? wp : w));
    if (oldName && oldName !== wp.name) {
      setAltitudeChanges((prev) =>
        prev.map((t) => (t.atWaypoint === oldName ? { ...t, atWaypoint: wp.name } : t)),
      );
    }
    setFollowedCorridorName(null);
    setCorridorAltRange(null);
    setCorridorCompAlt(null);
  }, [routeWaypoints]);

  const handleSetAltitudeAtWaypoint = useCallback((wpName: string, altFt: number | null) => {
    setAltChangesAuto(false);
    setAltitudeChanges((prev) => {
      const filtered = prev.filter((t) => t.atWaypoint !== wpName);
      if (altFt == null || altFt <= 0) return filtered;
      return [...filtered, { atWaypoint: wpName, toAltFt: altFt }];
    });
  }, []);

  // handleSetLegAltitude is declared after routeLegs is defined (see below)
  // so that the closure captures it correctly.

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

  // Base fuel/weight variables
  // Derived canonical values (kg / kg-per-hour). Parse the input strings in
  // the currently selected fuel unit and convert to kg.
  const consumptionKgH = fuelAmountToKg(parseFloat(consumptionPerHour) || 0, fu);
  const fuelOnBoardKg = fuelAmountToKg(parseFloat(fuelCurrentTotal) || 0, fu);

  // When the user switches the fuel unit (kg ↔ lbs ↔ L ↔ gal), re-render the
  // input strings so the displayed amount preserves its canonical kg value.
  const prevFuRef = useRef(fu);
  useEffect(() => {
    const oldFu = prevFuRef.current;
    if (oldFu === fu) return;
    prevFuRef.current = fu;
    setConsumptionPerHour((prev) => {
      const num = parseFloat(prev);
      if (!num || num <= 0) return prev;
      const kgH = fuelAmountToKg(num, oldFu);
      return kgToFuelAmount(kgH, fu).toFixed(fuelDecimals(fu));
    });
    setFuelCurrentTotal((prev) => {
      const num = parseFloat(prev);
      if (!num || num <= 0) return prev;
      const kg = fuelAmountToKg(num, oldFu);
      return kgToFuelAmount(kg, fu).toFixed(fuelDecimals(fu));
    });
  }, [fu]);
  const cruiseKts = selectedAircraft?.cruiseSpeedKts ?? null;

  const aircraftPerf: AircraftPerformance | null = useMemo(() => {
    if (!selectedAircraft || selectedAircraft.cruiseSpeedKts == null || selectedAircraft.cruiseSpeedKts <= 0) return null;
    const cs = selectedAircraft.cruiseSpeedKts;
    return {
      climbSpeedKts: selectedAircraft.climbSpeedKts ?? Math.round(cs * 0.65),
      cruiseSpeedKts: cs,
      descentSpeedKts: selectedAircraft.descentSpeedKts ?? Math.round(cs * 0.8),
      climbRateFpm: selectedAircraft.climbRateFpm ?? 700,
      descentRateFpm: selectedAircraft.descentRateFpm ?? 500,
    };
  }, [selectedAircraft]);

  const originWindDir = origin ? (metars[origin.icao]?.windDirection ?? null) : null;
  const originWindSpd = origin ? (metars[origin.icao]?.windSpeed ?? null) : null;

  const enrichedLegs: EnrichedLeg[] = useMemo(() => {
    if (!aircraftPerf || routeLegs.length === 0) return [];
    const altFt = parseCruiseLevelFt(cruiseLevel);
    return enrichRouteLegs(
      routeLegs,
      aircraftPerf,
      origin?.elevation ?? 0,
      destination?.elevation ?? 0,
      altFt,
      typeof originWindDir === 'number' ? originWindDir : null,
      originWindSpd,
    );
  }, [routeLegs, aircraftPerf, cruiseLevel, origin, destination, originWindDir, originWindSpd]);

  // Editing a leg's altitude inline. The transition is recorded at the leg's
  // "to" waypoint (operationally: be at this altitude when reaching that
  // waypoint). The leg edited gets the new altitude, and any subsequent legs
  // carry it forward until a further transition fires.
  const handleSetLegAltitude = useCallback((legIdx: number, altFt: number) => {
    if (!Number.isFinite(altFt) || altFt <= 0) return;
    const leg = routeLegs[legIdx];
    if (!leg) return;
    setAltChangesAuto(false);
    const wpName = leg.to.name;
    setAltitudeChanges((prev) => {
      const filtered = prev.filter((t) => t.atWaypoint !== wpName);
      return [...filtered, { atWaypoint: wpName, toAltFt: altFt }];
    });
  }, [routeLegs]);

  // Fuel calculations — use wind-corrected ETE from enriched legs when available.
  // The arithmetic lives in computeFuelPlan (vfrFuel.ts) so it stays pure and
  // unit-tested; the component only feeds it canonical kg / kt inputs.
  const altDistNm = destination && alternate
    ? haversineDistanceNm(destination.latitude, destination.longitude, alternate.latitude, alternate.longitude)
    : 0;
  const acEmptyWeightKg = selectedAircraft?.emptyWeightKg ?? null;
  const acMtowKg = selectedAircraft?.mtowKg ?? null;
  const fuelPlan = computeFuelPlan({
    consumptionKgH,
    cruiseKts,
    totalDistanceNm,
    enrichedLegsTimeMin: enrichedLegs.length > 0
      ? enrichedLegs.reduce((s, l) => s + l.timeMin, 0)
      : null,
    altDistNm,
    contingencyPct: parseFloat(contingencyPct) || 0,
    reserveMinutes,
    fuelOnBoardKg,
    fuelCapacityL: selectedAircraft?.fuelCapacityL ?? null,
    emptyWeightKg: acEmptyWeightKg,
    mtowKg: acMtowKg,
    payloadKg,
  });
  const {
    tripMinutes,
    tripFuelKg,
    altFuelKg,
    contingencyFuelKg,
    reserveFuelKg,
    minFuelKg,
    maxFuelKg,
    canComputeWeight,
    takeoffWeightKg,
    mtowExcessKg,
    perWingKg,
    enduranceMin,
  } = fuelPlan;
  const { hours: enduranceHours, minutes: enduranceRemainder } = formatEndurance(enduranceMin);

  // Computed epochs for time-aware weather
  const departureEpochSec = useMemo(() => Math.floor(plannedDepartureTime.getTime() / 1000), [plannedDepartureTime]);
  const arrivalEpochSec = useMemo(
    () => tripMinutes > 0 ? departureEpochSec + tripMinutes * 60 : null,
    [departureEpochSec, tripMinutes],
  );
  const alternateArrivalEpochSec = useMemo(() => {
    if (!arrivalEpochSec || cruiseKts == null || cruiseKts <= 0 || altDistNm <= 0) return null;
    return arrivalEpochSec + Math.round((altDistNm / cruiseKts) * 3600);
  }, [arrivalEpochSec, cruiseKts, altDistNm]);

  // Fetch route safety (aerodrome wx + SIGMET intersection + winds aloft) — debounced
  useEffect(() => {
    if (!origin || !destination) { setRouteSafety(null); return; }
    const waypoints: { lat: number; lon: number }[] = [];
    waypoints.push({ lat: origin.latitude, lon: origin.longitude });
    for (const wp of routeWaypoints) waypoints.push({ lat: wp.lat, lon: wp.lng });
    waypoints.push({ lat: destination.latitude, lon: destination.longitude });
    if (waypoints.length < 2) { setRouteSafety(null); return; }

    const timer = setTimeout(() => {
      setRouteSafetyLoading(true);
      apiClient.post<RouteSafetyData>('/weather/route-safety', {
        waypoints,
        originIcao: origin.icao,
        destinationIcao: destination.icao,
        alternateIcao: alternate?.icao,
        cruiseLevel: cruiseLevel || undefined,
        cruiseSpeedKts: selectedAircraft?.cruiseSpeedKts ?? undefined,
        fuelBurnLph: selectedAircraft?.fuelBurnLph ?? undefined,
        totalDistanceNm: totalDistanceNm > 0 ? totalDistanceNm : undefined,
        departureEpochSec,
        arrivalEpochSec: arrivalEpochSec ?? undefined,
      })
        .then(setRouteSafety)
        .catch(() => setRouteSafety(null))
        .finally(() => setRouteSafetyLoading(false));
    }, 2000);

    return () => clearTimeout(timer);
  }, [origin, destination, alternate, routeWaypoints, cruiseLevel, selectedAircraft, totalDistanceNm, departureEpochSec, arrivalEpochSec]);

  // Auto-detect day/night based on civil twilight at origin (departure) and destination (arrival)
  useEffect(() => {
    if (!origin) return;
    const arrivalTime = arrivalEpochSec ? new Date(arrivalEpochSec * 1000) : null;
    const night = isNightFlight(
      plannedDepartureTime,
      arrivalTime,
      origin.latitude,
      origin.longitude,
      destination?.latitude ?? null,
      destination?.longitude ?? null,
    );
    setFlightCondition(night ? 'night' : 'day');
  }, [plannedDepartureTime, arrivalEpochSec, origin, destination]);

  // Auto-suggest fuel on board when min fuel is calculable and user hasn't manually edited
  useEffect(() => {
    if (minFuelKg > 0 && !fuelManuallyEdited) {
      setFuelCurrentTotal(Math.ceil(minFuelKg).toString());
    }
  }, [minFuelKg, fuelManuallyEdited]);

  // Wind-adjusted performance: GS, ETE, fuel delta
  const windAdjustedGS = useMemo(() => {
    if (!routeSafety?.performanceAdjustments || !cruiseKts) return null;
    return Math.round(cruiseKts - routeSafety.performanceAdjustments.averageHeadwindKts);
  }, [routeSafety?.performanceAdjustments, cruiseKts]);

  const windAdjustedTripMin = useMemo(() => {
    if (!routeSafety?.performanceAdjustments || tripMinutes <= 0) return null;
    return Math.round(tripMinutes + routeSafety.performanceAdjustments.estimatedTimeIncreaseMinutes);
  }, [routeSafety?.performanceAdjustments, tripMinutes]);

  const windAdjustedArrivalSec = useMemo(() => {
    if (windAdjustedTripMin == null || windAdjustedTripMin <= 0) return null;
    return departureEpochSec + windAdjustedTripMin * 60;
  }, [departureEpochSec, windAdjustedTripMin]);

  // Flight viability validation (client-side structural + backend weather merged)
  const planViability: PlanViability = useMemo(() => {
    if (!hasVfr) return { status: 'viable', items: [] };
    const result = validateVfrPlan({
      departureTime: plannedDepartureTime,
      origin,
      destination,
      alternate,
      aircraft: selectedAircraft,
      cruiseLevel,
      totalDistanceNm,
      fuelOnBoardKg,
      minFuelKg,
      takeoffWeightKg,
      mtowKg: selectedAircraft?.mtowKg ?? null,
      flightCondition,
      enduranceMin,
      icaoPrefix: origin?.icao?.substring(0, 2) ?? '',
    });

    if (routeSafety?.items.length) {
      const existingIds = new Set(result.items.map((i) => i.id));
      for (const si of routeSafety.items) {
        if (!existingIds.has(si.id)) {
          result.items.push({
            id: si.id,
            severity: si.severity as 'blocking' | 'actionable' | 'warning' | 'unverifiable',
            message: si.message,
            action: si.action,
            source: si.source,
          });
        }
      }
    }

    const hasBlocking = result.items.some((i) => i.severity === 'blocking');
    const hasActionable = result.items.some((i) => i.severity === 'actionable');
    const hasUnverifiable = result.items.some((i) => i.severity === 'unverifiable');
    const hasWarning = result.items.some((i) => i.severity === 'warning');
    if (hasBlocking) result.status = 'not-viable';
    else if (hasActionable) result.status = 'incomplete';
    else if (hasUnverifiable) result.status = 'unverifiable';
    else if (hasWarning) result.status = 'viable-with-warnings';
    else result.status = 'viable';

    return result;
  }, [
    hasVfr, plannedDepartureTime, origin, destination, alternate, selectedAircraft,
    cruiseLevel, totalDistanceNm, fuelOnBoardKg, minFuelKg, takeoffWeightKg,
    selectedAircraft?.mtowKg, flightCondition, enduranceMin, origin?.icao, routeSafety,
  ]);

  // Suggested cruise level based on average magnetic course and departure region
  const cruiseSuggestion = useMemo(
    () => hasIfr
      ? suggestIfrCruiseLevel(routeLegs, origin?.icao)
      : suggestCruiseLevel(routeLegs, origin?.icao),
    [routeLegs, origin?.icao, hasIfr],
  );

  const ruleInfo = useMemo(
    () => origin?.icao ? getVfrRuleInfo(origin.icao) : null,
    [origin?.icao],
  );

  // Split route into segments (corridor vs free) with per-segment altitudes
  const routeSegments: RouteSegment[] = useMemo(
    () => hasIfr ? [] : segmentRouteLegs(routeLegs, followedCorridorName, corridorAltRange, corridorCompAlt, origin?.icao),
    [routeLegs, followedCorridorName, corridorAltRange, corridorCompAlt, origin?.icao, hasIfr],
  );

  // Per-leg selected altitude based on cruise + manual altitude transitions.
  // Semantic: a transition AT waypoint X means "be at this altitude when
  // reaching X" — i.e. the leg ENDING at X (and all subsequent legs, until
  // another transition) flies the new altitude. This matches how pilots
  // think about compulsory gate altitudes ("3500 ft AT Lagos") and how ICAO
  // Item 18 RMK lists transition fixes.
  const legSelectedAltFt = useMemo<(number | undefined)[]>(() => {
    const out = new Array<number | undefined>(routeLegs.length).fill(undefined);
    const cruiseFt = parseCruiseLevelFt(cruiseLevel);
    const transitionsByWp = new Map<string, number>();
    for (const tr of altitudeChanges) transitionsByWp.set(tr.atWaypoint, tr.toAltFt);

    let currentAlt: number | undefined = cruiseFt ?? undefined;
    for (let i = 0; i < routeLegs.length; i++) {
      const leg = routeLegs[i]!;
      const transition = transitionsByWp.get(leg.to.name);
      if (transition != null) currentAlt = transition;
      out[i] = currentAlt;
    }
    return out;
  }, [routeLegs, cruiseLevel, altitudeChanges]);

  const cruiseAltClearance: AltitudeClearance[] | null = useMemo(() => {
    if (!cruiseSuggestion || hasIfr) return null;
    const originMetar = origin ? metars[origin.icao] : undefined;
    if (!originMetar || originMetar.clouds.length === 0) return null;
    const elev = origin?.elevation ?? 0;
    return filterAltitudesByCloudClearance(cruiseSuggestion.altitudes, originMetar.clouds, elev);
  }, [cruiseSuggestion, hasIfr, origin, metars]);

  // Auto-computed altitude profile based on REA per-leg constraints.
  // Returns the optimal single altitude (when possible) or base + transitions for multi-altitude flights.
  const autoAltitudeProfile = useMemo(() => {
    if (reaLegAltitudes.length === 0) return null;
    const fallback = cruiseSuggestion?.altitudes[0] ?? 3500;
    return computeAltitudeProfile(reaLegAltitudes, fallback);
  }, [reaLegAltitudes, cruiseSuggestion]);

  // Apply auto profile when REA altitudes change AND user hasn't manually overridden
  useEffect(() => {
    if (!autoAltitudeProfile || !altChangesAuto) return;
    const newLevel = toFL(autoAltitudeProfile.baseCruiseFt);
    if (cruiseLevel !== newLevel) setCruiseLevel(newLevel);
    // Only update transitions if they differ from auto (to avoid render loop)
    const equal = altitudeChanges.length === autoAltitudeProfile.transitions.length
      && altitudeChanges.every((t, i) =>
        t.atWaypoint === autoAltitudeProfile.transitions[i]?.atWaypoint
        && t.toAltFt === autoAltitudeProfile.transitions[i]?.toAltFt,
      );
    if (!equal) setAltitudeChanges(autoAltitudeProfile.transitions);
  }, [autoAltitudeProfile, altChangesAuto]);

  // Unified cruise altitude options — single list for the whole route.
  // Real VFR rule: one cruise altitude for the route. Per-segment splits only
  // happen via explicit pilot-defined transitions (Camada 2).
  const cruiseOptions = useMemo<number[]>(() => {
    if (!cruiseSuggestion) return [];
    const corridorSeg = routeSegments.find((s) => s.type === 'corridor');
    // Corridor compulsory altitude wins (no alternatives). Treat 0 as "no comp
    // altitude" — defends against degenerate backend values.
    const compAlt = corridorSeg?.corridorCompAlt ?? null;
    if (compAlt != null && compAlt > 0) return [compAlt];

    let opts = cruiseSuggestion.altitudes;
    if (hasIfr) opts = opts.filter((a) => a >= 2000 && a <= 25000);
    // Corridor range: filter semi-circular altitudes to the corridor band.
    // If no semi-circular altitude fits (e.g. Juliete 3500-4000 against the
    // westbound even+500 ladder), the corridor mandate wins — fall back to
    // the range's endpoints so the pilot still has valid options.
    const range = corridorSeg?.corridorAltRange;
    if (range) {
      const filtered = opts.filter((a) => a >= range.min && a <= range.max);
      if (filtered.length > 0) {
        opts = filtered;
      } else {
        opts = range.max !== range.min ? [range.min, range.max] : [range.min];
      }
    }
    return opts;
  }, [cruiseSuggestion, routeSegments, hasIfr]);

  // Auto-select a single cruise altitude for the whole route on first load
  // or when constraints change. Real VFR rule: one altitude for the route.
  // Picks the first non-cloud-blocked option from cruiseOptions; preserves the
  // user's current selection if still valid.
  useEffect(() => {
    if (cruiseOptions.length === 0) return;
    const blocked = new Set(cruiseAltClearance?.filter((c) => c.blocked).map((c) => c.altitude));
    const currentFt = parseCruiseLevelFt(cruiseLevel);
    const currentValid = currentFt != null && cruiseOptions.includes(currentFt) && !blocked.has(currentFt);

    const targetFt = currentValid
      ? currentFt!
      : (cruiseOptions.find((a) => !blocked.has(a)) ?? cruiseOptions[0]!);
    const targetFL = toFL(targetFt);

    if (!currentValid && cruiseLevel !== targetFL) {
      setCruiseLevel(targetFL);
    }
    // Propagate to all segments — single-altitude profile
    if (routeSegments.length > 0) {
      const next: Record<string, string> = {};
      let changed = false;
      for (const seg of routeSegments) {
        next[seg.id] = currentValid ? toFL(currentFt!) : targetFL;
        if (segmentLevels[seg.id] !== next[seg.id]) changed = true;
      }
      if (changed) setSegmentLevels(next);
    }
  }, [cruiseOptions, cruiseAltClearance, routeSegments, cruiseLevel]);

  // Sync cruiseLevel from segment levels (use first segment's level for ICAO Field 15)
  useEffect(() => {
    if (routeSegments.length === 0) return;
    const primary = routeSegments[0]!;
    const fl = segmentLevels[primary.id];
    if (fl && fl !== cruiseLevel) {
      setCruiseLevel(fl);
    }
  }, [segmentLevels, routeSegments]);

  // Cruise level validation warnings
  const cruiseLevelWarnings = useMemo(() => {
    const warnings: { key: string; severity: 'error' | 'warning' }[] = [];
    const altFt = parseCruiseLevelFt(cruiseLevel);
    if (!altFt || altFt <= 0) return warnings;

    if (routeSegments.length === 0) {
      if (corridorCompAlt != null && corridorCompAlt > 0) {
        if (altFt !== corridorCompAlt) {
          warnings.push({ key: 'reaAltViolation', severity: 'error' });
        }
      } else if (corridorAltRange) {
        if (altFt < corridorAltRange.min || altFt > corridorAltRange.max) {
          warnings.push({ key: 'reaAltViolation', severity: 'error' });
        }
      }

      if (cruiseSuggestion && hasVfr && !corridorAltRange && (corridorCompAlt == null || corridorCompAlt <= 0)) {
        if (!cruiseSuggestion.altitudes.includes(altFt)) {
          warnings.push({ key: 'semicircularViolation', severity: 'warning' });
        }
      }
    }

    const highestElev = Math.max(origin?.elevation ?? 0, destination?.elevation ?? 0);
    if (altFt < highestElev + 1000) {
      warnings.push({ key: 'tooLow', severity: 'error' });
    }

    return warnings;
  }, [cruiseLevel, corridorAltRange, corridorCompAlt, cruiseSuggestion, hasVfr, origin?.elevation, destination?.elevation, routeSegments]);

  // Auto-suggest TOD distance for IFR
  const suggestedTodNm = useMemo(() => {
    if (!hasIfr || !cruiseLevel || !destination?.elevation) return null;
    const altFt = parseCruiseLevelFt(cruiseLevel);
    if (!altFt) return null;
    return calculateTodDistance(altFt, destination.elevation);
  }, [hasIfr, cruiseLevel, destination?.elevation]);

  const performanceCategory = useMemo(
    () => selectedAircraft?.cruiseSpeedKts != null ? getPerformanceCategory(selectedAircraft.cruiseSpeedKts) : null,
    [selectedAircraft],
  );

  // Effective destination TPA: custom value if set, otherwise computed by category + elevation
  const destTpaDefaultFt = useMemo<number | null>(() => {
    if (!destination?.elevation || !performanceCategory) return null;
    return calculateDefaultTpaFt(destination.elevation, performanceCategory);
  }, [destination?.elevation, performanceCategory]);

  const destTpaFt = destTpaCustomFt ?? destTpaDefaultFt;
  const destTpaSource: 'default' | 'custom' = destTpaCustomFt != null ? 'custom' : 'default';

  // TOC / TOD positions on the route for map markers
  const tocTodPositions: TocTodPosition[] = useMemo(() => {
    if (!selectedAircraft || !origin || !destination || routeLegs.length === 0) return [];
    const altFt = parseCruiseLevelFt(cruiseLevel);
    if (!altFt || altFt <= 0) return [];

    const routePoints: { lat: number; lng: number }[] = [
      { lat: origin.latitude, lng: origin.longitude },
      ...routeWaypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng })),
      { lat: destination.latitude, lng: destination.longitude },
    ];
    const totalDistNm = routeLegs.reduce((s, l) => s + l.distanceNm, 0);
    const results: TocTodPosition[] = [];

    const tocNm = selectedAircraft.cruiseSpeedKts != null ? calculateTocDistance(origin.elevation ?? 0, altFt, 700, selectedAircraft.cruiseSpeedKts) : 0;
    if (tocNm > 0 && tocNm < totalDistNm) {
      const pos = interpolatePositionOnRoute(routePoints, tocNm);
      if (pos) results.push({ ...pos, distanceFromOriginNm: tocNm, label: 'TOC' });
    }

    const targetTpa = destTpaFt ?? (destination.elevation ?? 0);
    const todNm = calculateTodFromTpa(altFt, targetTpa, 500, selectedAircraft.cruiseSpeedKts ?? 100, 2);
    const todFromOrigin = totalDistNm - todNm;
    if (todNm > 0 && todFromOrigin > 0 && todFromOrigin < totalDistNm) {
      const pos = interpolatePositionOnRoute(routePoints, todFromOrigin);
      if (pos) results.push({ ...pos, distanceFromOriginNm: todFromOrigin, label: 'TOD' });
    }

    return results;
  }, [selectedAircraft, origin, destination, routeLegs, cruiseLevel, routeWaypoints, destTpaFt]);

  // Climb / Descent plan anchored to visual references (waypoint + time)
  const climbDescentPlan: ClimbDescentPlan = useMemo(() => {
    if (!aircraftPerf || enrichedLegs.length === 0 || !origin) return {};
    const altFt = parseCruiseLevelFt(cruiseLevel);
    if (!altFt) return {};
    const tpa = destTpaFt ?? (destination?.elevation ?? 0);
    return computeClimbDescentPlan(
      enrichedLegs,
      origin.elevation ?? 0,
      tpa,
      altFt,
      aircraftPerf.climbRateFpm,
      aircraftPerf.climbSpeedKts,
      500,
      2,
      altitudeChanges,
    );
  }, [aircraftPerf, enrichedLegs, origin, destination, cruiseLevel, destTpaFt, altitudeChanges]);

  // REA detection — feeds the map overlay and charts panel (the corridor
  // suggestion cards fetch their own entry→exit options independently).
  const [reaRegions, setReaRegions] = useState<ReaDetectionRegion[]>([]);

  useEffect(() => {
    if (!origin || !destination) { setReaRegions([]); return; }
    // Skip if coordinates not yet available (restored plans with 0,0)
    if (origin.latitude === 0 && origin.longitude === 0) return;
    if (destination.latitude === 0 && destination.longitude === 0) return;

    // Detect on the FIXED origin→destination segment only — never the
    // already-applied routeWaypoints. Detecting on the live route made the
    // suggestion list grow/shift every time a corridor was picked (the chosen
    // path weaves through new regions), so the options appeared to "sum" and a
    // corridor valid at first could vanish or read as invalid after a pick.
    // Picking a corridor must be an exclusive, stable choice for the O→D leg.
    const waypoints: { lat: number; lon: number }[] = [
      { lat: origin.latitude, lon: origin.longitude },
      { lat: destination.latitude, lon: destination.longitude },
    ];

    const wpStr = waypoints.map((w) => `${w.lat}:${w.lon}`).join(',');

    apiClient.get<{ regions: ReaDetectionRegion[] }>(`/rea/detect?waypoints=${wpStr}`)
      .then((r) => setReaRegions(r.regions))
      .catch(() => setReaRegions([]));
  }, [origin, destination]);

  // Parallel REA detection for the destination → alternate segment. Same
  // ICA 100-12 rules apply.
  useEffect(() => {
    if (!destination || !alternate) { setAlternateReaRegions([]); return; }
    if (destination.latitude === 0 && destination.longitude === 0) return;
    if (alternate.latitude === 0 && alternate.longitude === 0) return;

    // Same as the main leg: detect on the fixed destination→alternate segment
    // only, not the applied alternate route, so the corridor options stay
    // stable and each pick is an exclusive choice.
    const wps: { lat: number; lon: number }[] = [
      { lat: destination.latitude, lon: destination.longitude },
      { lat: alternate.latitude, lon: alternate.longitude },
    ];
    const wpStr = wps.map((w) => `${w.lat}:${w.lon}`).join(',');

    apiClient.get<{ regions: ReaDetectionRegion[] }>(`/rea/detect?waypoints=${wpStr}`)
      .then((r) => setAlternateReaRegions(r.regions))
      .catch(() => setAlternateReaRegions([]));
  }, [destination, alternate]);

  const [reaViolations, setReaViolations] = useState<{ from: string; to: string; message: string; severity: 'error' | 'warning' }[]>([]);

  useEffect(() => {
    if (!followedCorridorName || routeWaypoints.length < 2) {
      setReaViolations([]);
      return;
    }
    const wpStr = routeWaypoints.map((w) => `${w.lat}:${w.lng}`).join(',');
    const altFt = cruiseLevel ? parseCruiseLevelFt(cruiseLevel) : undefined;
    const altParam = altFt ? `&altitude=${altFt}` : '';
    apiClient
      .get<{ valid: boolean; violations: { from: string; to: string; message: string; severity: 'error' | 'warning' }[] }>(
        `/rea/navigate/validate?waypoints=${wpStr}${altParam}`,
      )
      .then((r) => setReaViolations(r.violations))
      .catch(() => setReaViolations([]));
  }, [routeWaypoints, cruiseLevel, followedCorridorName]);

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
  const handleSelectAircraft = useCallback((aircraft: AnyAircraftProfile) => {
    setSelectedAircraft(aircraft);
    if (aircraft.fuelBurnLph != null) {
      const currentFu = useUnitsStore.getState().fuel;
      setConsumptionPerHour(fuelKgToInputStr(aircraft.fuelBurnLph * AVGAS_KG_PER_L, currentFu));
    }
    const defaults: Record<string, string> = {};
    if (aircraft.stations) {
      for (const s of aircraft.stations) {
        defaults[s.id] = s.defaultKg.toString();
      }
    }
    setStationWeights(defaults);
  }, []);

  const handleClearAircraft = useCallback(() => {
    setSelectedAircraft(null);
    setStationWeights({});
  }, []);

  const handleProfileSaved = useCallback((saved: UserAircraftProfile) => {
    void refreshProfiles();
    setSelectedAircraft(saved);
  }, [refreshProfiles]);

  const handleProfileDeleted = useCallback((profileId: string) => {
    void refreshProfiles();
    if (selectedAircraft?.id === profileId) {
      setSelectedAircraft(null);
      setStationWeights({});
    }
  }, [refreshProfiles, selectedAircraft?.id]);

  // Remarks (Item 18)
  const [userRemarks, setUserRemarks] = useState('');

  // Altitude transitions for ICAO Item 18 RMK — derived from altitudeChanges (user-defined or auto-suggested from REA)
  const altitudeTransitions = useMemo((): AltitudeTransition[] => {
    if (altitudeChanges.length === 0) return [];
    const baseFt = parseCruiseLevelFt(cruiseLevel);
    if (!baseFt) return [];

    const transitions: AltitudeTransition[] = [];
    let prevAlt = baseFt;
    for (const ch of altitudeChanges) {
      if (ch.toAltFt !== prevAlt) {
        transitions.push({ fix: ch.atWaypoint, fromAlt: prevAlt, toAlt: ch.toAltFt });
        prevAlt = ch.toAltFt;
      }
    }
    return transitions;
  }, [altitudeChanges, cruiseLevel]);

  const autoRemarks = useMemo(() => {
    return buildItem18({
      corridorName: followedCorridorName,
      corridorAltRange,
      corridorCompAlt,
      altitudeTransitions,
      dateOfFlight: plannedDepartureTime,
      performanceCategory,
    });
  }, [followedCorridorName, corridorAltRange, corridorCompAlt, altitudeTransitions, plannedDepartureTime, performanceCategory]);
  const fullRemarks = useMemo(() => {
    return buildItem18({
      corridorName: followedCorridorName,
      corridorAltRange,
      corridorCompAlt,
      altitudeTransitions,
      userRemarks,
      dateOfFlight: plannedDepartureTime,
      performanceCategory,
    });
  }, [followedCorridorName, corridorAltRange, corridorCompAlt, altitudeTransitions, userRemarks, plannedDepartureTime, performanceCategory]);

  // SimBrief state
  const [callsign, setCallsign] = useState(initialData?.callsign ?? '');
  const [registration, setRegistration] = useState(initialData?.registration ?? '');
  const [simbriefOfpId, setSimbriefOfpId] = useState(initialData?.simbriefOfpId ?? '');

  // Plain-text renderings for the copy-to-clipboard buttons.
  const fmtAerodrome = (a: { icao: string } | null, rwy: string): string =>
    a ? `${a.icao}${rwy ? `/RW${rwy}` : ''}` : '—';

  // Route with departure/destination aerodromes + runway, e.g.
  // "SBST/35 DCT 2338S04640W DCT SBMT/12" — a briefing/SkyVector depiction,
  // distinct from the bare ICAO Item 15 route the plain copy produces.
  const routeFullText = useMemo(() => {
    const dep = origin ? `${origin.icao}${originRunway ? `/${originRunway}` : ''}` : '';
    const arr = destination ? `${destination.icao}${destRunway ? `/${destRunway}` : ''}` : '';
    return [dep, routeText, arr].filter(Boolean).join(' ');
  }, [origin, originRunway, destination, destRunway, routeText]);

  // SkyVector "open in" link: ORIGIN + waypoints (as ICAO coords) + DEST in the
  // ?fpl= flight-plan param. Waypoints go as coordinates (gate/visual names
  // wouldn't resolve in SkyVector). The legit way to use SkyVector — a contextual
  // link out, not embedding their proprietary tiles.
  const skyVectorUrl = useMemo(() => {
    if (!origin || !destination) return null;
    // Speed + altitude ride as an ICAO field-15 modifier (/F095N0120). SkyVector
    // honors it on an enroute fix, NOT on the departure airport — so attach it to
    // the first waypoint when there is one (fallback: departure). "F" for flight
    // levels (not "FL"); altitude then speed. ETD/tail/fuel are NOT supported in
    // SkyVector's URL (profile/form only), so they're omitted by design.
    const ft = parseCruiseLevelFt(cruiseLevel);
    const altToken = ft != null ? formatAltitudeIcao(ft, origin.icao).replace(/^FL/, 'F') : '';
    const spdToken =
      cruiseKts != null && cruiseKts > 0 ? `N${String(Math.round(cruiseKts)).padStart(4, '0')}` : '';
    const mod = altToken || spdToken ? `/${altToken}${spdToken}` : '';
    const waypoints = routeWaypoints.map((w) => toVfrCoord(w.lat, w.lng));
    // Tokens (ICAO idents + ICAO-format coordinates) are URL-safe; '+' is
    // SkyVector's waypoint separator, so it must stay literal (not encoded).
    const parts =
      waypoints.length > 0
        ? [origin.icao, `${waypoints[0]}${mod}`, ...waypoints.slice(1), destination.icao]
        : [`${origin.icao}${mod}`, destination.icao];
    return `https://skyvector.com/?fpl=${parts.join('+')}`;
  }, [origin, destination, routeWaypoints, cruiseLevel, cruiseKts]);

  const openSkyVector = useCallback(() => {
    if (skyVectorUrl) void Linking.openURL(skyVectorUrl);
  }, [skyVectorUrl]);

  // Import a Garmin/SkyVector .fpl: pick the file, send to the API (parse +
  // resolve origin/destination), and populate the plan. Mid points become
  // waypoints (always); origin/destination only if found in our airport DB.
  const importFromSkyVector = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.[0]) return;
      const uri = res.assets[0].uri;
      const text =
        Platform.OS === 'web'
          ? await (await fetch(uri)).text()
          : await FileSystem.readAsStringAsync(uri);
      const r = await skyVectorApi.importFpl(text);
      if (r.origin) setOrigin(r.origin);
      if (r.destination) setDestination(r.destination);
      setRouteWaypoints(r.waypoints);
      setFollowedCorridorName(null);
      setCorridorAltRange(null);
      setCorridorCompAlt(null);
      if (r.unresolved.length > 0) {
        notify(
          t('vfr.importFplPartial'),
          t('vfr.importFplUnresolved', { idents: r.unresolved.join(', ') }),
        );
      } else {
        notify(t('vfr.importFplDone'));
      }
    } catch {
      notify(t('common.error'), t('vfr.importFplError'));
    }
  }, [t]);

  // Operational summary for the Flight Viability panel — DEP/ARR/ALT, perf and
  // the viability verdict with its items. Good for a quick briefing/Discord paste.
  const viabilitySummaryText = useMemo(() => {
    const statusLabel =
      planViability.status === 'viable' ? t('vfr.viable')
      : planViability.status === 'viable-with-warnings' ? t('vfr.viableWithWarnings')
      : planViability.status === 'incomplete' ? t('vfr.incomplete')
      : planViability.status === 'not-viable' ? t('vfr.notViable')
      : t('vfr.unverifiable');
    const lines: string[] = [statusLabel];
    if (callsign || registration) {
      lines.push(`C/S ${callsign || registration}${registration && callsign ? `  REG ${registration}` : ''}`);
    }
    lines.push(`DEP ${fmtAerodrome(origin, originRunway)}`);
    lines.push(`ARR ${fmtAerodrome(destination, destRunway)}`);
    if (alternate) lines.push(`ALT ${fmtAerodrome(alternate, altRunway)}`);
    const perf = [
      cruiseLevel ? `CRZ ${cruiseLevel}` : null,
      cruiseKts && cruiseKts > 0 ? `TAS ${cruiseKts} kt` : null,
      windAdjustedGS != null ? `GS ${windAdjustedGS} kt` : null,
      totalDistanceNm > 0 ? `DIST ${Math.round(totalDistanceNm)} nm` : null,
    ].filter(Boolean).join('  ');
    if (perf) lines.push(perf);
    for (const item of planViability.items) lines.push(`• ${item.message}`);
    return lines.join('\n');
  }, [planViability, callsign, registration, origin, originRunway, destination, destRunway, alternate, altRunway, cruiseLevel, cruiseKts, windAdjustedGS, totalDistanceNm, t]);

  // Full plan dump for filing elsewhere (SimBrief/IVAO/VATSIM/Discord): header,
  // aerodromes, cruise, route(s) and Item 18 RMK.
  const fullPlanText = useMemo(() => {
    const lines: string[] = [];
    const head = [callsign || registration, registration && callsign ? `(${registration})` : null, selectedAircraft?.icaoType]
      .filter(Boolean).join(' ');
    if (head) lines.push(head);
    lines.push(`DEP ${fmtAerodrome(origin, originRunway)}  ARR ${fmtAerodrome(destination, destRunway)}${alternate ? `  ALT ${fmtAerodrome(alternate, altRunway)}` : ''}`);
    if (cruiseLevel) lines.push(`CRZ ${cruiseLevel}`);
    if (routeText) lines.push(`RTE ${routeText}`);
    if (alternate && alternateRouteText) lines.push(`ALTN RTE ${alternateRouteText}`);
    if (fullRemarks) lines.push(`RMK ${fullRemarks}`);
    return lines.join('\n');
  }, [callsign, registration, selectedAircraft, origin, originRunway, destination, destRunway, alternate, altRunway, cruiseLevel, routeText, alternateRouteText, fullRemarks]);

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

    // Runways from OFP
    if (ofp.originRunway) setOriginRunway(ofp.originRunway);
    if (ofp.destinationRunway) setDestRunway(ofp.destinationRunway);
    if (ofp.alternateRunway) setAltRunway(ofp.alternateRunway);

    // Fuel — backend already normalizes to kg; render in the current fuel unit.
    const currentFu = useUnitsStore.getState().fuel;
    if (ofp.fuelPlanRampKg != null && ofp.fuelPlanRampKg > 0) {
      setFuelCurrentTotal(fuelKgToInputStr(ofp.fuelPlanRampKg, currentFu));
      setFuelManuallyEdited(true);
    }

    if (ofp.fuelAvgFlowKgH != null && ofp.fuelAvgFlowKgH > 0) {
      setConsumptionPerHour(fuelKgToInputStr(ofp.fuelAvgFlowKgH, currentFu));
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
      originLatitude: origin.latitude ?? undefined,
      originLongitude: origin.longitude ?? undefined,
      originRunwayInUse: originRunway || undefined,
      originMetarRaw: metars[origin.icao]?.raw,
      originTafRaw: tafs[origin.icao]?.raw,
      destinationIcao: destination.icao,
      destinationName: destination.name,
      destinationElevationFt: destination.elevation ?? undefined,
      destinationLatitude: destination.latitude ?? undefined,
      destinationLongitude: destination.longitude ?? undefined,
      destinationRunwayInUse: destRunway || undefined,
      destinationMetarRaw: metars[destination.icao]?.raw,
      destinationTafRaw: tafs[destination.icao]?.raw,
      destinationTpaFt: destTpaFt ?? undefined,
      destinationTpaSource: destTpaFt != null ? destTpaSource : undefined,
      altitudeChanges: altitudeChanges.length > 0 ? altitudeChanges : undefined,
      alternateIcao: alternate?.icao,
      alternateName: alternate?.name,
      alternateElevationFt: alternate?.elevation ?? undefined,
      alternateLatitude: alternate?.latitude ?? undefined,
      alternateLongitude: alternate?.longitude ?? undefined,
      alternateRunwayInUse: altRunway || undefined,
      alternateMetarRaw: alternate ? metars[alternate.icao]?.raw : undefined,
      alternateTafRaw: alternate ? tafs[alternate.icao]?.raw : undefined,
      originRunways: originDetail?.runways.flatMap((r) => {
        const entries: { ident: string; headingDeg: number | null; lengthFt: number | null }[] = [];
        if (r.leIdent) entries.push({ ident: r.leIdent, headingDeg: r.leHeadingDeg, lengthFt: r.lengthFt });
        if (r.heIdent) entries.push({ ident: r.heIdent, headingDeg: r.heHeadingDeg, lengthFt: r.lengthFt });
        return entries;
      }),
      destinationRunways: destDetail?.runways.flatMap((r) => {
        const entries: { ident: string; headingDeg: number | null; lengthFt: number | null }[] = [];
        if (r.leIdent) entries.push({ ident: r.leIdent, headingDeg: r.leHeadingDeg, lengthFt: r.lengthFt });
        if (r.heIdent) entries.push({ ident: r.heIdent, headingDeg: r.heHeadingDeg, lengthFt: r.lengthFt });
        return entries;
      }),
      alternateRunways: undefined,
      reaCorridors: reaRegions.length > 0 ? reaRegions.flatMap((r) =>
        r.corridors.map((c) => ({
          regionName: r.chartName,
          corridorName: c.name,
          tipo: c.tipo,
          segments: c.segments.map((s) => ({
            from: s.fixoA.nome,
            to: s.fixoB.nome,
            altMin: s.altMinAtoB,
            altMax: s.altMaxAtoB,
            altComp: s.altComp,
          })),
        })),
      ) : undefined,
      routeText: routeText || undefined,
      cruiseLevel: cruiseLevel || undefined,
      todDistanceNm: todDistanceNm ? parseFloat(todDistanceNm) : undefined,
      aircraftType: selectedAircraft?.icaoType ?? undefined,
      aircraftName: selectedAircraft ? `${selectedAircraft.manufacturer ?? ''} ${selectedAircraft.model ?? selectedAircraft.name}`.trim() : undefined,
      fuelConsumptionPerHour: consumptionKgH ? consumptionKgH / AVGAS_KG_PER_L : undefined,
      fuelCurrentTotal: fuelOnBoardKg ? fuelOnBoardKg / AVGAS_KG_PER_L : undefined,
      fuelReserveMinutes: reserveMinutes,
      fuelRequiredTotal: minFuelKg ? minFuelKg / AVGAS_KG_PER_L : undefined,
      fuelPerWing: perWingKg ? perWingKg / AVGAS_KG_PER_L : undefined,
      enduranceMinutes: enduranceMin || undefined,
      takeoffWeightKg: takeoffWeightKg ?? undefined,
      mtowKg: selectedAircraft?.mtowKg ?? undefined,
      callsign: callsign || undefined,
      registration: registration || undefined,
      simbriefOfpId: simbriefOfpId || undefined,
      visualReferences: initialData?.visualReferences,
      routeWaypoints: routeWaypoints.length > 0 ? routeWaypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng, name: wp.name })) : undefined,
      alternateRouteWaypoints: alternateRouteWaypoints.length > 0
        ? alternateRouteWaypoints.map((wp) => ({ lat: wp.lat, lng: wp.lng, name: wp.name }))
        : undefined,
      alternateRouteText: alternateRouteText || undefined,
      alternatePlannedAltitude: alternatePlannedAltitudeFt ?? undefined,
      routeLegs: routeLegs.length > 0 ? routeLegs.map((leg, i) => ({
        from: leg.from.name,
        to: leg.to.name,
        distanceNm: leg.distanceNm,
        trueCourse: leg.trueCourse,
        magneticDeclination: leg.magneticDeclination,
        magneticCourse: leg.magneticCourse,
        suggestedAltitudes: leg.suggestedAltitudes,
        timeMin: enrichedLegs[i]?.timeMin,
        groundSpeedKts: enrichedLegs[i]?.groundSpeedKts,
        magneticHeading: enrichedLegs[i]?.magneticHeading,
        selectedAltitudeFt: legSelectedAltFt[i],
      })) : undefined,
      totalDistanceNm: totalDistanceNm || undefined,
      tripMinutes: tripMinutes || undefined,
      cruiseSpeedKts: cruiseKts ?? undefined,
      tripFuelKg: tripFuelKg || undefined,
      altFuelKg: altFuelKg || undefined,
      altDistanceNm: altDistNm || undefined,
      contingencyPct: parseFloat(contingencyPct) || undefined,
      contingencyFuelKg: contingencyFuelKg || undefined,
      reserveFuelKg: reserveFuelKg || undefined,
      minFuelKg: minFuelKg || undefined,
      flightCondition,
      emptyWeightKg: selectedAircraft?.emptyWeightKg ?? undefined,
      payloadKg: payloadKg || undefined,
      fuelCapacityL: selectedAircraft?.fuelCapacityL ?? undefined,
      fuelBurnLph: selectedAircraft?.fuelBurnLph ?? undefined,
      aircraftStations: acStations.length > 0 ? acStations : undefined,
      stations: acStations.length > 0
        ? acStations.map((s) => ({ id: s.id, labelKey: s.labelKey, maxKg: s.maxKg, arm: s.arm }))
        : undefined,
      remarks: fullRemarks || undefined,
      performanceCategory: performanceCategory || undefined,
      item18Text: fullRemarks || undefined,
      plannedDepartureTime: plannedDepartureTime.toISOString(),
    };
  };

  const handleSave = () => {
    const data = buildPlanData();
    if (!data) {
      notify(t('common.error'), t('vfr.noPlanSelected'));
      return;
    }
    const savePayload: Partial<VfrPlanData> & Record<string, unknown> = {
      flightRules: data.flightRules,
      originIcao: data.originIcao,
      originName: data.originName,
      originElevationFt: data.originElevationFt,
      originRunwayInUse: data.originRunwayInUse,
      originMetarRaw: data.originMetarRaw,
      destinationIcao: data.destinationIcao,
      destinationName: data.destinationName,
      destinationElevationFt: data.destinationElevationFt,
      destinationRunwayInUse: data.destinationRunwayInUse,
      destinationMetarRaw: data.destinationMetarRaw,
      destinationTpaFt: data.destinationTpaFt,
      destinationTpaSource: data.destinationTpaSource,
      altitudeChanges: data.altitudeChanges,
      alternateIcao: data.alternateIcao,
      alternateName: data.alternateName,
      alternateElevationFt: data.alternateElevationFt,
      alternateRunwayInUse: data.alternateRunwayInUse,
      alternateMetarRaw: data.alternateMetarRaw,
      aircraftType: data.aircraftType,
      aircraftName: data.aircraftName,
      takeoffWeightKg: data.takeoffWeightKg,
      mtowKg: data.mtowKg,
      callsign: data.callsign,
      registration: data.registration,
      simbriefOfpId: data.simbriefOfpId,
      routeText: data.routeText,
      cruiseLevel: data.cruiseLevel,
      plannedAltitude: data.cruiseLevel ? parseCruiseLevelFt(data.cruiseLevel) ?? undefined : undefined,
      todDistanceNm: data.todDistanceNm,
      fuelConsumptionPerHour: data.fuelConsumptionPerHour,
      fuelCurrentTotal: data.fuelCurrentTotal,
      fuelReserveMinutes: data.fuelReserveMinutes,
      fuelRequiredTotal: data.fuelRequiredTotal,
      fuelPerWing: data.fuelPerWing,
      emptyWeightKg: data.emptyWeightKg,
      fuelCapacityL: data.fuelCapacityL,
      fuelBurnLph: data.fuelBurnLph,
      aircraftStations: data.aircraftStations,
      cruiseSpeedKts: data.cruiseSpeedKts,
      enduranceMinutes: data.enduranceMinutes,
      visualReferences: data.visualReferences,
      status: data.status,
      remarks: data.remarks,
      // Operational time basis
      plannedDepartureUtc: plannedDepartureTime.toISOString(),
      estimatedElapsedMin: tripMinutes > 0 ? tripMinutes : undefined,
      estimatedArrivalUtc: arrivalEpochSec
        ? new Date(arrivalEpochSec * 1000).toISOString()
        : undefined,
      totalDistanceNm: totalDistanceNm > 0 ? totalDistanceNm : undefined,
      groundSpeed: windAdjustedGS ?? (cruiseKts ? Math.round(cruiseKts) : undefined),
      weatherBasis: new Date().toISOString(),
      routes: (routeWaypoints.length + alternateRouteWaypoints.length) > 0
        ? [
            ...routeWaypoints.map((wp, i) => ({
              sequence: i,
              waypointIdent: wp.name.slice(0, 50),
              latitude: wp.lat,
              longitude: wp.lng,
              role: 'MAIN' as const,
            })),
            ...alternateRouteWaypoints.map((wp, i) => ({
              sequence: i,
              waypointIdent: wp.name.slice(0, 50),
              latitude: wp.lat,
              longitude: wp.lng,
              role: 'ALTERNATE' as const,
            })),
          ]
        : undefined,
      alternateRouteText: alternateRouteText || undefined,
      alternateTotalDistanceNm: data.altDistanceNm,
      alternatePlannedAltitude: alternatePlannedAltitudeFt ?? undefined,
    };
    void onSave(savePayload as VfrPlanData);
  };

  const [showRouteTextModal, setShowRouteTextModal] = useState(false);
  const [routeTextDraft, setRouteTextDraft] = useState('');

  const [showExportModal, setShowExportModal] = useState(false);
  const [showSimExportModal, setShowSimExportModal] = useState(false);
  const [exportIncludeCharts, setExportIncludeCharts] = useState(false);
  const [exportIncludeChecklist, setExportIncludeChecklist] = useState(false);
  const [exportIncludeAiAnalysis, setExportIncludeAiAnalysis] = useState(false);
  const [exporting, setExporting] = useState(false);

  const hasChecklists = !!selectedAircraft?.icaoType && getChecklistsForAircraft(selectedAircraft.icaoType).length > 0;

  const handleExportPdf = () => {
    const data = buildPlanData();
    if (!data) {
      notify(t('common.error'), t('vfr.noPlanSelected'));
      return;
    }
    trackAction('export_modal_opened', {
      origin_icao: data.originIcao,
      destination_icao: data.destinationIcao,
    });
    setShowExportModal(true);
  };

  const handleExportFlightFile = async (
    kind: 'msfs' | 'charts' | 'lnm',
    exporter: (data: VfrPlanData) => Promise<boolean>,
  ) => {
    const data = buildPlanData();
    if (!data) {
      notify(t('common.error'), t('vfr.noPlanSelected'));
      return;
    }
    try {
      const ok = await exporter(data);
      if (!ok) {
        notify(t('common.error'), t('vfr.plnMissingCoords'));
        return;
      }
      trackSuccess(`export_${kind}`, { origin_icao: data.originIcao, destination_icao: data.destinationIcao });
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure(`export_${kind}`, errorType, { status_code: statusCode });
      notify(t('common.error'), t('vfr.exportFailed'));
    }
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
          await new Promise((r) => setTimeout(r, 1200));
          const container = mapHandleRef.current.getContainer();
          if (container) {
            const controlEl = (container as unknown as { querySelector: (s: string) => { style: { display: string } } | null }).querySelector('.leaflet-control-container');
            const prevDisplay = controlEl?.style.display ?? '';
            if (controlEl) controlEl.style.display = 'none';
            mapImageDataUrl = await (toPng as unknown as (el: unknown, opts?: Record<string, unknown>) => Promise<string>)(container, {
              cacheBust: false,
              skipFonts: true,
              filter: (node: unknown) => {
                const el = node as { classList?: { contains: (c: string) => boolean } };
                if (el.classList?.contains('leaflet-control-container')) return false;
                return true;
              },
            });
            if (controlEl) controlEl.style.display = prevDisplay;
          }
        } catch (e) { console.warn('Map capture failed:', e); }
        if (prevView) {
          mapHandleRef.current.setView(prevView.center, prevView.zoom);
        }
      }

      const aiData = exportIncludeAiAnalysis && validationResult ? validationResult : undefined;
      const hasAttachments = exportIncludeCharts || exportIncludeChecklist;
      const exportProps = {
        origin_icao: data.originIcao,
        destination_icao: data.destinationIcao,
        includes_charts: exportIncludeCharts,
        includes_checklist: exportIncludeChecklist,
        includes_ai: exportIncludeAiAnalysis,
        has_map_image: !!mapImageDataUrl,
      };
      trackAction('export_requested', exportProps);
      if (!hasAttachments) {
        const doc = buildFlightPlanDoc(data, mapImageDataUrl, aiData, planViability, climbDescentPlan);
        const filename = `flight-plan_${data.originIcao}-${data.destinationIcao}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.pdf`;
        doc.save(filename);
        trackSuccess('export_completed', { ...exportProps, attachment_count: 0 });
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
      if (exportIncludeChecklist && selectedAircraft?.icaoType) {
        const checklists = getChecklistsForAircraft(selectedAircraft.icaoType);
        if (checklists[0]) {
          checklistUrl = checklists[0].pdfUrl;
        }
      }

      await exportFlightPlanWithAttachments(data, { chartUrls, checklistUrl }, mapImageDataUrl, aiData, planViability, climbDescentPlan);
      trackSuccess('export_completed', { ...exportProps, attachment_count: chartUrls.length + (checklistUrl ? 1 : 0) });
    } catch (err) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('export_failed', errorType, { status_code: statusCode });
      console.error('PDF export error:', err);
      notify(t('common.error'), err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
      setShowExportModal(false);
    }
  };

  // AI Validation
  const [, setByokProvider] = useState<string | null>(null);

  useEffect(() => {
    apiClient
      .get<{ provider: string | null; hasKey: boolean }>('/integrations/ai-validation/connection')
      .then((data) => { if (data.hasKey && data.provider) setByokProvider(data.provider); })
      .catch(() => {});
  }, []);

  const [showValidationModal, setShowValidationModal] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<AiValidationResult | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const requestAiValidation = async () => {
    const data = buildPlanData();
    if (!data) {
      notify(t('common.error'), t('vfr.noPlanSelected'));
      trackFailure('ai_validation_blocked_missing_inputs', 'validation');
      return;
    }
    setValidating(true);
    setValidationError(null);
    setValidationResult(null);
    trackAction('ai_validation_requested', {
      origin_icao: data.originIcao,
      destination_icao: data.destinationIcao,
      flight_rules: data.flightRules,
    });
    try {
      const aiPayload = { ...data };
      delete aiPayload.aircraftStations;
      const result = await apiClient.post<AiValidationResult>(
        '/ai-validation/validate', aiPayload,
      );
      setValidationResult(result);
      trackSuccess('ai_validation_succeeded', {
        origin_icao: data.originIcao,
        destination_icao: data.destinationIcao,
        overall_status: result.overallStatus,
        provider: result.meta?.provider,
        has_byok: result.meta?.byok ?? false,
      });
    } catch (err: unknown) {
      const { errorType, statusCode } = categorizeError(err);
      trackFailure('ai_validation_failed', errorType, {
        status_code: statusCode,
        rate_limited: statusCode === 429,
      });
      const status = (err as { status?: number }).status;
      if (status === 402) {
        setValidationError(t('vfr.aiValidationKeyError'));
      } else if (status === 429) {
        setValidationError(t('vfr.aiValidationRateLimit'));
      } else {
        setValidationError(err instanceof Error ? err.message : t('vfr.aiValidationError'));
      }
    } finally {
      setValidating(false);
    }
  };

  const aiMissingItems = useMemo(() => {
    const missing: string[] = [];
    if (!origin) missing.push(t('vfr.origin'));
    if (!destination) missing.push(t('vfr.destination'));
    if (!selectedAircraft) missing.push(t('aircraft.selectAircraft'));
    if (origin && !metars[origin.icao]) missing.push('METAR');
    if (totalDistanceNm <= 0) missing.push(t('vfr.route'));
    if (!cruiseLevel) missing.push(t('vfr.cruiseLevel'));
    return missing;
  }, [origin, destination, selectedAircraft, metars, totalDistanceNm, cruiseLevel, t]);

  const aiReady = aiMissingItems.length === 0;

  const handleAiValidate = () => {
    trackAction('ai_validation_opened', { has_previous_result: !!validationResult });
    setShowValidationModal(true);
    if (!validationResult) {
      void requestAiValidation();
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
      onUpdateWaypoint={handleUpdateWaypoint}
      onSetAltitudeAtWaypoint={handleSetAltitudeAtWaypoint}
      alternateRouteWaypoints={alternateRouteWaypoints}
      onRemoveAlternateWaypoint={handleRemoveAlternateWaypoint}
      onUpdateAlternateWaypoint={handleUpdateAlternateWaypoint}
      defaultCruiseAltFt={parseCruiseLevelFt(cruiseLevel) ?? null}
      waypointAltitudesFt={routeWaypoints.map((wp) =>
        altitudeChanges.find((t) => t.atWaypoint === wp.name)?.toAltFt ?? null,
      )}
      reaSegments={reaMapSegments}
      selectedReaCorridorName={followedCorridorName}
      flightRules={flightRules}
      tocTodPositions={tocTodPositions}
      hazardSegments={routeSafety?.hazardSegments}
      aerodromeOverlays={activeAerodromeOverlays}
      onCloseAerodromeOverlay={handleCloseAerodromeOverlay}
    />
  );

  const sidebarContent = (_onRequestExpand: () => void) => (
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

      {/* ====== CALLSIGN & REGISTRATION ====== */}
      <Section title={`Callsign / ${t('vfr.registration')}`}>
        <View className="flex-row gap-2">
          <View className="flex-1">
            <Input
              label="Callsign"
              value={callsign}
              onChangeText={setCallsign}
              placeholder="TAM3456"
            />
          </View>
          <View className="flex-1">
            <Input
              label={t('vfr.registration')}
              value={registration}
              onChangeText={setRegistration}
              placeholder="PR-ABC"
            />
          </View>
        </View>
      </Section>

      {/* ====== DEPARTURE TIME ====== */}
      <Section title={t('vfr.departureTime')}>
        <View className="flex-row items-center gap-3">
          {Platform.OS === 'web' ? (
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(plannedDepartureTime)}
              onChange={(e: unknown) => {
                const val = (e as { target: { value: string } }).target.value;
                if (val) setPlannedDepartureTime(fromDatetimeLocalValue(val));
              }}
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 6,
                border: '1px solid #d4d4d8',
                fontSize: 14,
                fontFamily: 'monospace',
                backgroundColor: 'transparent',
                color: 'inherit',
              }}
            />
          ) : (
            <TextInput
              value={toDatetimeLocalValue(plannedDepartureTime).replace('T', ' ')}
              onChangeText={(val) => {
                const normalized = val.replace(' ', 'T');
                const d = fromDatetimeLocalValue(normalized);
                if (!isNaN(d.getTime())) setPlannedDepartureTime(d);
              }}
              placeholder="YYYY-MM-DD HH:MM"
              className="flex-1 rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-foreground"
            />
          )}
        </View>
        <Text className="mt-1 text-[10px] text-muted-foreground">
          UTC — {t('vfr.departureTimeInfo')}
        </Text>
      </Section>

      {/* ====== AERODROMES ====== */}
      <Section title={t('vfr.aerodromes')}>
        <Pressable
          onPress={() => {
            void importFromSkyVector();
          }}
          className="mb-3 flex-row items-center gap-2 self-start rounded-md border border-border px-3 py-2 active:opacity-70"
          style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined}
        >
          <Text className="text-xs font-medium text-primary">{t('vfr.importFpl')} ↥</Text>
        </Pressable>
        <AerodromeSearch
          label={t('vfr.origin')}
          value={origin}
          onSelect={handleSelectOrigin}
          onClear={() => { setOrigin(null); setOriginDetail(null); setOriginRunway(''); resetCorridorState(); }}
        />
        {origin ? (
          <AerodromeInfo
            aerodrome={origin}
            metar={metars[origin.icao] ?? null}
            metarLoading={metarLoading}
            taf={tafs[origin.icao] ?? null}
            tafLoading={tafLoading}
            tafTargetEpoch={departureEpochSec}
            tafTargetLabel="ETD"
            showTaf
            runway={originRunway}
            onRunwayChange={setOriginRunway}
            flightRules={flightRules}
            runways={originDetail?.runways}
            activeOverlays={activeAerodromeOverlays}
            onShowOverlay={handleShowAerodromeOverlay}
            onHideOverlay={handleHideAerodromeOverlay}
            t={t}
          />
        ) : null}

        <AerodromeSearch
          label={t('vfr.destination')}
          value={destination}
          onSelect={handleSelectDestination}
          onClear={() => { setDestination(null); setDestDetail(null); setDestRunway(''); resetCorridorState(); }}
        />
        {destination ? (
          <AerodromeInfo
            aerodrome={destination}
            metar={metars[destination.icao] ?? null}
            metarLoading={metarLoading}
            taf={tafs[destination.icao] ?? null}
            tafLoading={tafLoading}
            tafTargetEpoch={arrivalEpochSec ?? undefined}
            tafTargetLabel="ETA"
            showTaf
            runway={destRunway}
            onRunwayChange={setDestRunway}
            flightRules={flightRules}
            runways={destDetail?.runways}
            activeOverlays={activeAerodromeOverlays}
            onShowOverlay={handleShowAerodromeOverlay}
            onHideOverlay={handleHideAerodromeOverlay}
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
            taf={tafs[alternate.icao] ?? null}
            tafLoading={tafLoading}
            tafTargetEpoch={alternateArrivalEpochSec ?? undefined}
            tafTargetLabel="ETA"
            showTaf
            runway={altRunway}
            onRunwayChange={setAltRunway}
            flightRules={flightRules}
            activeOverlays={activeAerodromeOverlays}
            onShowOverlay={handleShowAerodromeOverlay}
            onHideOverlay={handleHideAerodromeOverlay}
            t={t}
          />
        ) : null}
      </Section>

      {/* ====== AIRCRAFT & WEIGHT ====== */}
      <Section title={t('aircraft.selectAircraft')} info={t('info.weight')}>
        <AircraftSelect
          value={selectedAircraft}
          onSelect={handleSelectAircraft}
          onClear={handleClearAircraft}
          entries={aircraftEntries}
          loading={catalogLoading}
          error={catalogError}
          onCreateProfile={() => {
            const preId = !selectedAircraft
              ? null
              : selectedAircraft.isTemplate
                ? selectedAircraft.id
                : selectedAircraft.isShared
                  ? selectedAircraft.id
                  : aircraftCatalog.find((e) => e.icaoType === selectedAircraft.icaoType)?.id ?? null;
            setPreselectedBaseId(preId);
            setEditingProfile(null);
            setShowProfileModal(true);
          }}
          onEditProfile={(p) => { setEditingProfile(p); setShowProfileModal(true); }}
        />

        {selectedAircraft ? (
          <View className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2 gap-0.5">
            {selectedAircraft.dataCompleteness !== 'complete' ? (
              <View style={{ backgroundColor: '#fefce8', borderRadius: 6, padding: 8, marginBottom: 4 }}>
                <Text style={{ fontSize: 11, color: '#a16207' }}>
                  {selectedAircraft.dataCompleteness === 'skeleton'
                    ? 'Dados básicos — apenas identificação disponível. Cálculos de peso e combustível indisponíveis.'
                    : 'Dados parciais — alguns campos podem estar indisponíveis. Valores marcados como N/D não foram verificados.'}
                </Text>
              </View>
            ) : null}
            <Row label={t('aircraft.emptyWeight')} value={selectedAircraft.emptyWeightKg != null ? formatWeight(selectedAircraft.emptyWeightKg, wu) : 'N/D'} />
            <Row label={t('aircraft.mtow')} value={selectedAircraft.mtowKg != null ? formatWeight(selectedAircraft.mtowKg, wu) : 'N/D'} bold />
            <Row label={t('aircraft.usefulLoad')} value={canComputeWeight ? formatWeight(acMtowKg! - acEmptyWeightKg!, wu) : 'N/D'} />
            <Row label={t('aircraft.fuelCapacity')} value={selectedAircraft.fuelCapacityL != null ? formatFuel(selectedAircraft.fuelCapacityL * AVGAS_KG_PER_L, fu) : 'N/D'} />
            <Row label={t('aircraft.cruiseSpeed')} value={selectedAircraft.cruiseSpeedKts != null ? formatSpeed(selectedAircraft.cruiseSpeedKts, su) : 'N/D'} />
          </View>
        ) : null}

        {selectedAircraft && canComputeWeight ? (
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

        {selectedAircraft && canComputeWeight && weightMode === 'simple' ? (
          <View className="mb-3">
            <Input
              label={`${t('aircraft.payload')} (${t('aircraft.maxLabel')} ${formatWeight(Math.max(0, acMtowKg! - acEmptyWeightKg! - fuelOnBoardKg), wu)})`}
              value={simpleTotalWeight}
              onChangeText={setSimpleTotalWeight}
              keyboardType="numeric"
              placeholder="0"
            />
          </View>
        ) : null}

        {selectedAircraft && canComputeWeight && weightMode === 'advanced' && acStations.length > 0 ? (
          <View className="mb-3">
            {acStations.map((station) => (
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

        {selectedAircraft && canComputeWeight && (payloadKg > 0 || fuelOnBoardKg > 0) ? (
          <View className={`rounded-sm border px-3 py-2 ${(mtowExcessKg ?? 0) > 0 ? 'border-destructive bg-destructive/10' : 'border-border bg-surface-muted'}`}>
            <Row label={t('aircraft.payload')} value={formatWeight(payloadKg, wu)} />
            <Row label={t('aircraft.fuelWeight')} value={formatWeight(fuelOnBoardKg, wu)} />
            <View className="my-1 border-t border-border/50" />
            <Row label={t('aircraft.takeoffWeight')} value={`${formatWeight(takeoffWeightKg!, wu)}  /  ${formatWeight(acMtowKg!, wu)}`} bold />
            {(mtowExcessKg ?? 0) > 0 ? (
              <Text className="mt-1 text-xs font-semibold text-destructive">
                {t('aircraft.overMtow', { excess: formatWeight(mtowExcessKg!, wu) })}
              </Text>
            ) : (takeoffWeightKg ?? 0) > 0 ? (
              <Text className="mt-1 text-xs font-medium text-green-600">
                {t('aircraft.withinLimits')}
              </Text>
            ) : null}
          </View>
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

      {/* ====== REA (VFR only) ====== */}
      {hasVfr && origin && destination && /^S[BDIIJNSW]/.test(origin.icao) ? (
        <Section title={t('vfr.rea')}>
          <ReaCorridorSuggestions
            violations={reaViolations}
            startPoint={origin}
            endPoint={destination}
            followedCorridorName={followedCorridorName}
            onApplyCorridor={({ waypoints, corridorName, altRange, compAlt }) => {
              setRouteWaypoints(waypoints);
              setFollowedCorridorName(corridorName);
              setCorridorAltRange(altRange);
              setCorridorCompAlt(compAlt);
            }}
          />

          {/* Embedded REA charts — always available for Brazilian routes */}
          <ReaChartsPanel highlightRegionIds={reaRegions.map((r) => r.regionId)} />
        </Section>
      ) : null}

      {/* ====== REA Alternate (VFR only, destination → alternate) ====== */}
      {hasVfr && destination && alternate && /^S[BDIIJNSW]/.test(destination.icao) ? (
        <Section title={`${t('vfr.rea')} · ${t('vfr.alternate')}`}>
          <ReaCorridorSuggestions
            startPoint={destination}
            endPoint={alternate}
            followedCorridorName={followedAlternateCorridorName}
            onApplyCorridor={({ waypoints, corridorName, compAlt }) => {
              setAlternateRouteWaypoints(waypoints);
              setFollowedAlternateCorridorName(corridorName);
              // Adopt corridor's compulsory altitude only if the alt-leg
              // altitude hasn't been set yet — never overwrite a user value.
              if (compAlt != null && alternatePlannedAltitudeFt == null) {
                setAlternatePlannedAltitudeFt(compAlt);
              }
            }}
          />
        </Section>
      ) : null}


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
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View className="rounded-sm border border-border bg-surface-muted" style={{ minWidth: 720 }}>
            {/* Header */}
            <View className="flex-row border-b border-border px-2 py-1.5">
              <Text className="w-6 text-[10px] font-bold text-muted-foreground">#</Text>
              <Text style={{ width: 110 }} className="text-[10px] font-bold text-muted-foreground">Leg</Text>
              <Text style={{ width: 45 }} className="text-center text-[10px] font-bold text-muted-foreground">NM</Text>
              <Text style={{ width: 42 }} className="text-center text-[10px] font-bold text-muted-foreground">MH</Text>
              <Text style={{ width: 42 }} className="text-center text-[10px] font-bold text-muted-foreground">GS</Text>
              <Text style={{ width: 90 }} className="text-center text-[10px] font-bold text-muted-foreground">{t('vfr.suggestedAlt')}</Text>
              <Text style={{ width: 50 }} className="text-center text-[10px] font-bold text-muted-foreground">ETE</Text>
              <Text style={{ width: 28 }} className="text-center text-[10px] font-bold text-muted-foreground">Ref</Text>
            </View>
            {/* Rows */}
            {routeLegs.map((leg, idx) => {
              const el = enrichedLegs[idx];
              const ete = el ? formatLegMmSs(el.timeMin) : '—';
              const phaseColor = el?.phase === 'climb' ? '#f59e0b' : el?.phase === 'descent' ? '#8b5cf6' : undefined;
              return (
              <View key={idx}>
                <View
                  className={`flex-row items-center px-2 py-1.5 ${idx < routeLegs.length - 1 || expandedLegRef === idx ? 'border-b border-border' : ''}`}
                >
                  <Text className="w-6 text-[10px] font-medium text-muted-foreground" style={phaseColor ? { color: phaseColor } : undefined}>{idx + 1}</Text>
                  <Text style={{ width: 110 }} className="text-[10px] font-medium text-foreground" numberOfLines={1}>
                    {leg.from.name} → {leg.to.name}
                  </Text>
                  <Text style={{ width: 45 }} className="text-center text-[10px] text-foreground">{leg.distanceNm.toFixed(1)}</Text>
                  <Text style={{ width: 42 }} className="text-center text-[10px] text-foreground">{el ? `${el.magneticHeading}°` : '—'}</Text>
                  <Text style={{ width: 42 }} className="text-center text-[10px] font-medium text-foreground">{el ? el.groundSpeedKts : '—'}</Text>
                  <View style={{ width: 90 }} className="items-center">
                    <EditableAltCell
                      value={legSelectedAltFt[idx] ?? null}
                      onCommit={(v) => handleSetLegAltitude(idx, v)}
                    />
                  </View>
                  <Text style={{ width: 50 }} className="text-center text-[10px] font-medium text-foreground">{ete}</Text>
                  <Pressable
                    onPress={() => setExpandedLegRef(expandedLegRef === idx ? null : idx)}
                    style={{ width: 28 }}
                    className="items-center"
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
              );
            })}
            {/* Total */}
            <View className="flex-row border-t border-border px-2 py-1.5">
              <Text className="w-6 text-[10px] font-bold text-foreground" />
              <Text style={{ width: 110 }} className="text-[10px] font-bold text-foreground">{t('vfr.totalDistance')}</Text>
              <Text style={{ width: 45 }} className="text-center text-[10px] font-bold text-foreground">{totalDistanceNm.toFixed(1)}</Text>
              <Text style={{ width: 42 }} />
              <Text style={{ width: 42 }} />
              <Text style={{ width: 90 }} />
              <Text style={{ width: 50 }} className="text-center text-[10px] font-bold text-foreground">
                {enrichedLegs.length > 0 ? formatLegMmSs(enrichedLegs[enrichedLegs.length - 1]!.cumulativeTimeMin) : ''}
              </Text>
              <Text style={{ width: 28 }} />
            </View>
          </View>
          </ScrollView>
          {(climbDescentPlan.toc || climbDescentPlan.tod || (climbDescentPlan.transitions?.length ?? 0) > 0) ? (
            <View className="mt-3 gap-2">
              {climbDescentPlan.toc ? (
                <View className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
                  <View className="mb-1 flex-row items-center gap-1.5">
                    <View className="h-2 w-2 rounded-full bg-amber-500" />
                    <Text className="text-[11px] font-bold text-amber-700">{t('vfr.tocPlan')}</Text>
                  </View>
                  <Text className="text-[11px] text-foreground">
                    {t('vfr.tocInstructions', {
                      from: climbDescentPlan.toc.fromWaypoint,
                      time: formatLegMmSs(climbDescentPlan.toc.timeFromWaypointMin),
                      heading: climbDescentPlan.toc.headingMag,
                    })}
                  </Text>
                  <Text className="mt-1 text-[10px] text-muted-foreground">
                    {t('vfr.tocClimbDetails', {
                      rate: climbDescentPlan.toc.verticalRateFpm,
                      duration: formatLegMmSs(climbDescentPlan.toc.durationMin),
                      target: climbDescentPlan.toc.targetAltFt.toLocaleString(),
                    })}
                  </Text>
                </View>
              ) : null}
              {(climbDescentPlan.transitions ?? []).map((tr, idx) => {
                const isClimb = tr.kind === 'transition-climb';
                return (
                  <View key={`${tr.fromWaypoint}-${idx}`} className={`rounded-md border px-3 py-2 ${isClimb ? 'border-amber-500/40 bg-amber-500/5' : 'border-violet-500/40 bg-violet-500/5'}`}>
                    <View className="mb-1 flex-row items-center gap-1.5">
                      <View className={`h-2 w-2 rounded-full ${isClimb ? 'bg-amber-500' : 'bg-violet-500'}`} />
                      <Text className={`text-[11px] font-bold ${isClimb ? 'text-amber-700' : 'text-violet-700'}`}>
                        {t(isClimb ? 'vfr.transitionClimb' : 'vfr.transitionDescent')}
                      </Text>
                    </View>
                    <Text className="text-[11px] text-foreground">
                      {t('vfr.transitionInstructions', { at: tr.fromWaypoint })}
                    </Text>
                    <Text className="mt-1 text-[10px] text-muted-foreground">
                      {t('vfr.transitionDetails', {
                        rate: tr.verticalRateFpm,
                        duration: formatLegMmSs(tr.durationMin),
                        from: tr.fromAltFt?.toLocaleString() ?? '—',
                        target: tr.targetAltFt.toLocaleString(),
                      })}
                    </Text>
                  </View>
                );
              })}
              {climbDescentPlan.tod ? (
                <View className="rounded-md border border-violet-500/40 bg-violet-500/5 px-3 py-2">
                  <View className="mb-1 flex-row items-center gap-1.5">
                    <View className="h-2 w-2 rounded-full bg-violet-500" />
                    <Text className="text-[11px] font-bold text-violet-700">{t('vfr.todPlan')}</Text>
                  </View>
                  <Text className="text-[11px] text-foreground">
                    {t('vfr.todInstructions', {
                      from: climbDescentPlan.tod.fromWaypoint,
                      time: formatLegMmSs(climbDescentPlan.tod.timeFromWaypointMin),
                      heading: climbDescentPlan.tod.headingMag,
                    })}
                  </Text>
                  <Text className="mt-1 text-[10px] text-muted-foreground">
                    {t('vfr.todDescentDetails', {
                      rate: climbDescentPlan.tod.verticalRateFpm,
                      duration: formatLegMmSs(climbDescentPlan.tod.durationMin),
                      target: climbDescentPlan.tod.targetAltFt.toLocaleString(),
                      next: climbDescentPlan.tod.nextWaypoint,
                    })}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

        </Section>
      ) : null}

      {/* ====== ROUTE ====== */}
      <Section
        title={t('vfr.route')}
        info={
          flightRules === 'VFR' ? t('info.routeVfr')
            : flightRules === 'IFR' ? t('info.routeIfr')
            : t('info.routeMixed')
        }
      >
        {/* Label row with the copy control sitting right above the input.
            Tapping it offers "Route" (bare Item 15) or "Full route" (with
            departure/destination + runway). */}
        <View className="mb-1.5 flex-row items-center justify-between">
          <Text className="text-sm font-medium text-foreground">{t('vfr.routeText')}</Text>
          <View className="flex-row items-center gap-3">
            {skyVectorUrl ? (
              <Pressable
                onPress={openSkyVector}
                style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as never) : undefined}
              >
                <Text className="text-xs font-medium text-primary">{t('vfr.openSkyVector')} ↗</Text>
              </Pressable>
            ) : null}
            {(routeText || origin || destination) ? (
              <CopyButton
                options={[
                  { label: t('vfr.copyRoutePlain'), text: routeText },
                  { label: t('vfr.copyRouteFull'), text: routeFullText },
                ]}
              />
            ) : null}
          </View>
        </View>
        <Input
          value={routeText}
          onChangeText={setRouteText}
          placeholder={hasIfr ? 'SID AIRWAY WAYPOINT STAR' : 'DCT 2338S04640W DCT 2345S04655W DCT'}
        />
        {(flightRules === 'VFR_IFR' || flightRules === 'IFR_VFR') ? (
          <Text className="mt-1 text-[10px] text-muted-foreground">
            {t('vfr.mixedRouteHint')}
          </Text>
        ) : null}

        {/* Alternate route — destination → alternate. Only shown when an
            alternate is set. ICA 100-12 requires REA Obrig compliance on
            this leg; user can type the route or add waypoints on the map. */}
        {alternate ? (
          <View className="mt-3">
            <View className="mb-1.5 flex-row items-center justify-between">
              <Text className="text-sm font-medium text-foreground">{`${t('vfr.alternate')} ${t('vfr.routeText').toLowerCase()}`}</Text>
              {alternateRouteText ? <CopyButton text={alternateRouteText} /> : null}
            </View>
            <Input
              value={alternateRouteText}
              onChangeText={setAlternateRouteText}
              placeholder="DCT 2338S04640W DCT"
            />
            {alternateReaRegions.length > 0 ? (
              <Text className="mt-1 text-[10px] text-amber-600">
                {`${alternateReaRegions.length} REA detectado(s) no segmento destino→alternado — siga corredor`}
              </Text>
            ) : null}
            <View className="mt-2 flex-row items-center gap-2">
              <Text className="text-xs font-medium text-foreground">{`${t('vfr.alternate')} ${t('vfr.altitudeFt').toLowerCase()}`}</Text>
              <TextInput
                value={alternatePlannedAltitudeFt != null ? String(alternatePlannedAltitudeFt) : ''}
                placeholder="—"
                onChangeText={(v) => {
                  const cleaned = v.replace(/[^0-9]/g, '');
                  if (cleaned === '') { setAlternatePlannedAltitudeFt(null); return; }
                  const n = parseInt(cleaned, 10);
                  if (!isNaN(n) && n > 0) setAlternatePlannedAltitudeFt(n);
                }}
                keyboardType="numeric"
                className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-foreground"
                style={{ minWidth: 80 }}
              />
              <Text className="text-[10px] text-muted-foreground">ft</Text>
              {followedAlternateCorridorName ? (
                <Text className="ml-2 text-[10px] text-primary">
                  {`✓ ${followedAlternateCorridorName}`}
                </Text>
              ) : null}
            </View>
          </View>
        ) : null}
        {/* Destination TPA — lower bound for final descent target */}
        {destination && destTpaFt != null ? (
          <View className="mt-3">
            <View className="mb-1 flex-row items-center gap-1.5">
              <Text className="text-xs font-medium text-foreground">{t('vfr.tpa')}</Text>
              <InfoTooltip text={t('info.tpa')} />
            </View>
            <View className="flex-row items-center gap-2">
              <TextInput
                value={destTpaCustomFt != null ? String(destTpaCustomFt) : ''}
                placeholder={destTpaDefaultFt != null ? String(destTpaDefaultFt) : ''}
                onChangeText={(v) => {
                  const cleaned = v.replace(/[^0-9]/g, '');
                  if (cleaned === '') { setDestTpaCustomFt(null); return; }
                  const n = parseInt(cleaned, 10);
                  if (!isNaN(n)) setDestTpaCustomFt(n);
                }}
                keyboardType="numeric"
                className="rounded-sm border border-border bg-surface px-2 py-1 text-xs text-foreground"
                style={{ minWidth: 80 }}
              />
              <Text className="text-[10px] text-muted-foreground">ft</Text>
              <Text className="text-[10px] text-muted-foreground">
                {destTpaSource === 'default'
                  ? t('vfr.tpaDefaultHint', { category: performanceCategory ?? '' })
                  : t('vfr.tpaCustomHint')}
              </Text>
              {destTpaSource === 'custom' ? (
                <Pressable onPress={() => setDestTpaCustomFt(null)} className="ml-auto rounded-sm px-2 py-0.5 active:bg-muted">
                  <Text className="text-[10px] text-primary">{t('vfr.tpaResetDefault')}</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {/* Cruise Level — single altitude for the whole route. Different altitudes
            per segment are not legitimate in VFR (cloud conditions are the same).
            For longer flights with terrain/corridor changes, use explicit
            altitude transitions (Camada 2 — coming soon). */}
        <View className="mt-3">
          <View className="mb-1 flex-row items-center gap-2">
            <Text className="text-xs font-medium text-foreground">{t('vfr.cruiseLevel')}</Text>
            {autoAltitudeProfile && altChangesAuto ? (
              <View className="rounded-sm bg-primary/10 px-1.5 py-0.5">
                <Text className="text-[9px] font-medium text-primary">{t('vfr.altAutoSuggested')}</Text>
              </View>
            ) : autoAltitudeProfile && !altChangesAuto ? (
              <Pressable onPress={() => setAltChangesAuto(true)} className="rounded-sm bg-primary/10 px-1.5 py-0.5">
                <Text className="text-[9px] font-medium text-primary">{t('vfr.altRestoreAuto')}</Text>
              </Pressable>
            ) : null}
          </View>
          {cruiseSuggestion && cruiseOptions.length > 0 ? (
            <>
              <Text className="mb-1.5 text-[10px] text-muted-foreground">
                {t('vfr.avgMagCourse')}: {cruiseSuggestion.averageMC}°
                {hasVfr && ruleInfo ? ` · ${t(`vfr.rule.${ruleInfo.name}`)}` : ''}
                {hasIfr ? ` · ${t('vfr.ifrRule')}` : ''}
                {followedCorridorName ? ` · ${t('vfr.corridorSegment', { name: followedCorridorName })}` : ''}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-1.5">
                  {cruiseOptions.map((alt, altIdx) => {
                    const fl = toFL(alt);
                    const isSelected = cruiseLevel === fl;
                    const isSuggested = altIdx === 0;
                    const blocked = cruiseAltClearance?.find((c) => c.altitude === alt)?.blocked ?? false;
                    return (
                      <Pressable
                        key={alt}
                        onPress={() => {
                          const nextLevel = isSelected ? '' : fl;
                          setCruiseLevel(nextLevel);
                          setAltChangesAuto(false);
                          // Propagate to all segments so the leg table reflects the single altitude
                          const next: Record<string, string> = {};
                          for (const seg of routeSegments) next[seg.id] = nextLevel;
                          setSegmentLevels(next);
                        }}
                        className={`rounded-sm border px-2.5 py-1.5 ${
                          isSelected
                            ? 'border-primary bg-primary/10'
                            : blocked
                              ? 'border-destructive/40 bg-destructive/5'
                              : isSuggested
                                ? 'border-primary/40 bg-primary/5'
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
                        <Text className={`text-[9px] ${blocked ? 'text-destructive/50' : isSuggested && !isSelected ? 'text-primary/70' : 'text-muted-foreground'}`}>
                          {isSuggested ? `★ ${alt.toLocaleString()} ft` : `${alt.toLocaleString()} ft`}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </ScrollView>
              {cruiseAltClearance?.some((c) => c.blocked) ? (
                <Text className="mt-1 text-[10px] text-destructive/70">
                  {'⛅'} {t('vfr.cloudClearanceWarning')}
                </Text>
              ) : null}
            </>
          ) : (
            (() => {
              // Pick the prefix that matches the current value (or the TA-based
              // default when empty). Below transition altitude the ICAO format
              // is "A035"; above, "FL080".
              const altFt = parseCruiseLevelFt(cruiseLevel);
              const ta = getDefaultTransitionAltitude(origin?.icao);
              const useFL = altFt != null ? altFt >= ta : true;
              const prefix = useFL ? 'FL' : 'A';
              const digits = cruiseLevel.replace(/^(FL|A)/i, '');
              return (
                <View className="flex-row items-center rounded-md border border-input bg-background">
                  <Text className="pl-3 text-sm font-medium text-muted-foreground">{prefix}</Text>
                  <TextInput
                    value={digits}
                    onChangeText={(v) => {
                      const cleanDigits = v.replace(/\D/g, '');
                      if (!cleanDigits) { setCruiseLevel(''); return; }
                      const ft = parseInt(cleanDigits, 10) * 100;
                      if (Number.isFinite(ft) && ft > 0) {
                        setCruiseLevel(formatAltitudeIcao(ft, origin?.icao));
                      }
                    }}
                    placeholder="045"
                    keyboardType="numeric"
                    maxLength={3}
                    className="flex-1 px-2 py-2.5 text-sm text-foreground"
                    placeholderTextColor="hsl(220, 8.9%, 46.1%)"
                  />
                </View>
              );
            })()
          )}
          {cruiseLevelWarnings.length > 0 ? (
            <View className="mt-1.5 gap-1">
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

        {hasIfr ? (
          <View className="mt-3">
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
      </Section>

      {/* ====== REMARKS (Item 18) ====== */}
      <Section title={t('vfr.remarksTitle')}>
        {autoRemarks ? (
          <View className="mb-2 rounded-sm border border-border bg-surface-muted px-3 py-2">
            <View className="flex-row items-center justify-between">
              <Text className="text-[10px] font-medium text-muted-foreground">{t('vfr.remarksAuto')}</Text>
              <CopyButton text={autoRemarks} />
            </View>
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
            <View className="flex-row items-center justify-between">
              <Text className="text-[10px] font-medium text-primary">{t('vfr.remarksPreview')}</Text>
              <CopyButton text={fullRemarks} />
            </View>
            <Text className="mt-0.5 font-mono text-xs text-foreground" selectable>{fullRemarks}</Text>
          </View>
        ) : null}
      </Section>

      {/* ====== FUEL ====== */}
      <Section title={t('vfr.fuel')} info={t('info.fuel')}>
        {/* Day / Night — auto-detected from civil twilight, manual override allowed */}
        <View className="mb-3">
          <Text className="mb-1 text-sm font-medium text-foreground">
            {t('vfr.flightCondition')}
            <Text className="text-[10px] text-muted-foreground">  (auto)</Text>
          </Text>
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
              label={`${t('vfr.consumptionPerHour')} (${fuelFlowSuffix(fu)})`}
              value={consumptionPerHour}
              onChangeText={setConsumptionPerHour}
              keyboardType="numeric"
              placeholder="0"
            />
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
                <Row label={t('vfr.tripFuel')} value={formatFuel(tripFuelKg, fu)} />
                <Row label={t('vfr.tripTime')} value={`${Math.floor(tripMinutes / 60)}h${String(tripMinutes % 60).padStart(2, '0')}min`} />
              </>
            ) : null}
            {altFuelKg > 0 ? (
              <Row label={t('vfr.altFuel')} value={`${formatFuel(altFuelKg, fu)} (${altDistNm.toFixed(0)} NM)`} />
            ) : null}
            {contingencyFuelKg > 0 ? (
              <Row label={`${t('vfr.contingency')} (${contingencyPct}%)`} value={formatFuel(contingencyFuelKg, fu)} />
            ) : null}
            <Row label={`${t('vfr.reserveFuel')} (${reserveMinutes} min)`} value={formatFuel(reserveFuelKg, fu)} />
            {minFuelKg > 0 ? (
              <>
                <View className="my-1 border-t border-border/50" />
                <Row label={t('vfr.minFuel')} value={formatFuel(minFuelKg, fu)} bold />
              </>
            ) : null}
          </View>
        ) : null}

        {/* Fuel on board — auto-suggested, user can override */}
        <View className="mb-3">
          <Input
            label={selectedAircraft?.fuelCapacityL != null
              ? `${t('vfr.fuelOnBoard')} (${fu} · ${t('aircraft.maxLabel')} ${formatFuel(selectedAircraft.fuelCapacityL * AVGAS_KG_PER_L, fu)})`
              : `${t('vfr.fuelOnBoard')} (${fu})`}
            value={fuelCurrentTotal}
            onChangeText={(v) => { setFuelManuallyEdited(true); setFuelCurrentTotal(v); }}
            keyboardType="numeric"
            placeholder="0"
          />
          {maxFuelKg != null && maxFuelKg > 0 && fuelOnBoardKg > maxFuelKg ? (
            <Text className="mt-0.5 text-[10px] font-semibold text-destructive">
              {t('vfr.overCapacity', { excess: formatFuel(fuelOnBoardKg - maxFuelKg, fu) })}
            </Text>
          ) : null}
          {minFuelKg > 0 && fuelOnBoardKg > 0 && fuelOnBoardKg < minFuelKg ? (
            <Text className="mt-0.5 text-[10px] font-semibold text-destructive">
              {t('vfr.fuelInsufficient', { deficit: formatFuel(minFuelKg - fuelOnBoardKg, fu) })}
            </Text>
          ) : null}
          {minFuelKg > 0 && fuelOnBoardKg >= minFuelKg && !(maxFuelKg != null && maxFuelKg > 0 && fuelOnBoardKg > maxFuelKg) ? (
            <Text className="mt-0.5 text-[10px] font-medium text-green-600">
              {t('vfr.fuelSufficient')}
            </Text>
          ) : null}
        </View>

        {/* Endurance summary */}
        {fuelOnBoardKg > 0 && consumptionKgH > 0 ? (
          <View className="rounded-sm border border-border bg-surface-muted px-3 py-2">
            <Row label={t('vfr.perWing')} value={formatFuel(perWingKg, fu)} />
            <Row
              label={t('vfr.endurance')}
              value={`${enduranceHours}h${String(enduranceRemainder).padStart(2, '0')}min (${enduranceMin} min)`}
            />
          </View>
        ) : null}
      </Section>

      {/* ====== FLIGHT VIABILITY ====== */}
      {hasVfr ? (
        <Section
          title={t('vfr.flightViability')}
          trailing={<CopyButton text={viabilitySummaryText} label={t('vfr.copySummary')} />}
        >
          {/* Flight Summary */}
          <View className="mb-3 rounded-md border border-border bg-surface-muted px-3 py-2.5">
            {/* Callsign + Registration */}
            {(callsign || registration) ? (
              <View className="mb-1.5 flex-row flex-wrap gap-x-4 gap-y-1">
                <View className="flex-row items-center gap-1">
                  <Text className="text-[10px] font-bold text-muted-foreground">C/S</Text>
                  <Text className="font-mono text-xs font-semibold text-foreground">{callsign || registration}</Text>
                </View>
                {registration ? (
                  <View className="flex-row items-center gap-1">
                    <Text className="text-[10px] font-bold text-muted-foreground">REG</Text>
                    <Text className="font-mono text-xs font-semibold text-foreground">{registration}</Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Aerodromes */}
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Text className="w-8 text-[10px] font-bold text-muted-foreground">DEP</Text>
                <Text className="font-mono text-xs font-semibold text-foreground">
                  {origin ? `${origin.icao}${originRunway ? `/RW${originRunway}` : ''}` : '—'}
                </Text>
              </View>
              <View className="flex-row items-center gap-2">
                <Text className="w-8 text-[10px] font-bold text-muted-foreground">ARR</Text>
                <Text className="font-mono text-xs font-semibold text-foreground">
                  {destination ? `${destination.icao}${destRunway ? `/RW${destRunway}` : ''}` : '—'}
                </Text>
              </View>
              {alternate ? (
                <View className="flex-row items-center gap-2">
                  <Text className="w-8 text-[10px] font-bold text-muted-foreground">ALT</Text>
                  <Text className="font-mono text-xs font-semibold text-foreground">
                    {alternate.icao}{altRunway ? `/RW${altRunway}` : ''}
                  </Text>
                </View>
              ) : null}
            </View>

            {/* Separator */}
            <View className="my-2 border-t border-border/50" />

            {/* Performance */}
            <View className="flex-row flex-wrap gap-x-4 gap-y-1">
              <View className="flex-row items-center gap-1">
                <Text className="text-[10px] font-bold text-muted-foreground">CRZ</Text>
                <Text className="font-mono text-xs text-foreground">{cruiseLevel || '—'}</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className="text-[10px] font-bold text-muted-foreground">TAS</Text>
                <Text className="font-mono text-xs text-foreground">{cruiseKts != null && cruiseKts > 0 ? `${cruiseKts} kt` : '—'}</Text>
              </View>
              {windAdjustedGS != null ? (
                <View className="flex-row items-center gap-1">
                  <Text className="text-[10px] font-bold text-sky-600">GS</Text>
                  <Text className="font-mono text-xs font-semibold text-sky-700">{windAdjustedGS} kt</Text>
                </View>
              ) : null}
              <View className="flex-row items-center gap-1">
                <Text className="text-[10px] font-bold text-muted-foreground">DIST</Text>
                <Text className="font-mono text-xs text-foreground">{totalDistanceNm > 0 ? `${Math.round(totalDistanceNm)} nm` : '—'}</Text>
              </View>
            </View>

            {/* Separator */}
            <View className="my-2 border-t border-border/50" />

            {/* Times — show wind-adjusted values when available */}
            <View className="flex-row flex-wrap gap-x-4 gap-y-1">
              <View className="flex-row items-center gap-1">
                <Text className="text-[10px] font-bold text-muted-foreground">ETD</Text>
                <Text className="font-mono text-xs text-foreground">{formatZulu(plannedDepartureTime)}</Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className={`text-[10px] font-bold ${windAdjustedTripMin != null ? 'text-sky-600' : 'text-muted-foreground'}`}>ETE</Text>
                <Text className={`font-mono text-xs ${windAdjustedTripMin != null ? 'font-semibold text-sky-700' : 'text-foreground'}`}>
                  {(() => {
                    const mins = windAdjustedTripMin ?? tripMinutes;
                    return mins > 0 ? `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}` : '—';
                  })()}
                </Text>
              </View>
              <View className="flex-row items-center gap-1">
                <Text className={`text-[10px] font-bold ${windAdjustedArrivalSec != null ? 'text-sky-600' : 'text-muted-foreground'}`}>ETA</Text>
                <Text className={`font-mono text-xs ${windAdjustedArrivalSec != null ? 'font-semibold text-sky-700' : 'text-foreground'}`}>
                  {(() => {
                    const sec = windAdjustedArrivalSec ?? arrivalEpochSec;
                    return sec ? formatZulu(new Date(sec * 1000)) : '—';
                  })()}
                </Text>
              </View>
            </View>
          </View>

          <View className={`rounded-md border px-3 py-2.5 ${
            planViability.status === 'viable' ? 'border-green-400 bg-green-50' :
            planViability.status === 'viable-with-warnings' ? 'border-amber-400 bg-amber-50' :
            planViability.status === 'incomplete' ? 'border-orange-400 bg-orange-50' :
            planViability.status === 'not-viable' ? 'border-red-400 bg-red-50' :
            'border-zinc-400 bg-zinc-50'
          }`}>
            <Text className={`text-sm font-bold ${
              planViability.status === 'viable' ? 'text-green-800' :
              planViability.status === 'viable-with-warnings' ? 'text-amber-800' :
              planViability.status === 'incomplete' ? 'text-orange-800' :
              planViability.status === 'not-viable' ? 'text-red-800' :
              'text-zinc-700'
            }`}>
              {planViability.status === 'viable' ? t('vfr.viable') :
               planViability.status === 'viable-with-warnings' ? t('vfr.viableWithWarnings') :
               planViability.status === 'incomplete' ? `${t('vfr.incomplete')} — ${planViability.items.filter((i) => i.severity === 'actionable').length} ${t('vfr.pendingItems')}` :
               planViability.status === 'not-viable' ? `${t('vfr.notViable')} — ${planViability.items.filter((i) => i.severity === 'blocking').length} ${t('vfr.blockingConditions')}` :
               t('vfr.unverifiable')}
            </Text>
          </View>

          {/* Winds aloft / performance adjustments */}
          {routeSafety?.performanceAdjustments ? (
            <View className="mt-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2.5">
              <Text className="text-[11px] font-bold text-sky-900 mb-1.5">{t('vfr.windsAloftTitle')}</Text>
              <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                <View className="flex-row items-center gap-1">
                  <Text className="text-[10px] font-bold text-sky-700">
                    {routeSafety.performanceAdjustments.averageHeadwindKts >= 0 ? 'HW' : 'TW'}
                  </Text>
                  <Text className="font-mono text-xs text-sky-900">
                    {Math.abs(routeSafety.performanceAdjustments.averageHeadwindKts)} kt
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <Text className="text-[10px] font-bold text-sky-700">
                    {routeSafety.performanceAdjustments.estimatedTimeIncreaseMinutes >= 0 ? '+T' : '-T'}
                  </Text>
                  <Text className="font-mono text-xs text-sky-900">
                    {Math.abs(routeSafety.performanceAdjustments.estimatedTimeIncreaseMinutes)} min
                  </Text>
                </View>
                {routeSafety.performanceAdjustments.additionalFuelRequiredKg !== 0 ? (
                  <View className="flex-row items-center gap-1">
                    <Text className="text-[10px] font-bold text-sky-700">
                      {routeSafety.performanceAdjustments.additionalFuelRequiredKg >= 0 ? '+FUEL' : '-FUEL'}
                    </Text>
                    <Text className="font-mono text-xs text-sky-900">
                      {Math.abs(routeSafety.performanceAdjustments.additionalFuelRequiredKg)} kg
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : routeSafetyLoading ? (
            <View className="mt-2 flex-row items-center gap-2 rounded-md border border-sky-200 bg-sky-50/50 px-3 py-2">
              <ActivityIndicator size="small" color="#0284c7" />
              <Text className="text-[11px] text-sky-700">{t('vfr.loadingWindsAloft')}</Text>
            </View>
          ) : null}

          {planViability.items.length > 0 ? (
            <View className="mt-2 gap-1.5">
              {planViability.items.map((item) => (
                <View
                  key={item.id}
                  className={`rounded-md border px-3 py-2 ${
                    item.severity === 'blocking' ? 'border-red-300 bg-red-50' :
                    item.severity === 'actionable' ? 'border-orange-300 bg-orange-50' :
                    item.severity === 'warning' ? 'border-amber-300 bg-amber-50' :
                    'border-zinc-300 bg-zinc-50'
                  }`}
                >
                  <Text className={`text-[11px] leading-4 ${
                    item.severity === 'blocking' ? 'text-red-800' :
                    item.severity === 'actionable' ? 'text-orange-800' :
                    item.severity === 'warning' ? 'text-amber-800' :
                    'text-zinc-700'
                  }`}>
                    {item.message}
                  </Text>
                  {item.action ? (
                    <Text className="mt-0.5 text-[10px] italic text-muted-foreground">{item.action}</Text>
                  ) : null}
                  {item.source ? (
                    <Text className="mt-0.5 text-[9px] font-medium text-muted-foreground/70">{item.source}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* Full-plan copy — header, aerodromes, cruise, route(s) and RMK in one
              paste for filing on SimBrief/IVAO/VATSIM/Discord. */}
          <View className="mt-3 flex-row justify-end">
            <CopyButton text={fullPlanText} label={t('vfr.copyFullPlan')} />
          </View>
        </Section>
      ) : null}

      {/* ====== CHECKLISTS ====== */}
      {selectedAircraft?.icaoType && getChecklistsForAircraft(selectedAircraft.icaoType).length > 0 ? (
        <Section title={t('vfr.checklists')}>
          <ChecklistPanel icaoType={selectedAircraft.icaoType} />
        </Section>
      ) : null}

      {/* spacer so content doesn't hide behind FABs */}
      <View style={{ height: 80 }} />
    </>
  );

  return (
    <>
      <VfrPlanLayout
        mapElement={mapElement}
        sidebarContent={sidebarContent}
      />

      {/* ====== Floating Action Buttons ====== */}
      {Platform.OS === 'web' ? (
        <>
          {/* Bottom-right: actions */}
          <View style={{ position: 'absolute', bottom: 28, right: 12, zIndex: 9000, gap: 8, alignItems: 'center' }}>
            {onDelete ? (
              <FabButton onPress={onDelete} svg={ICON_TRASH()} title={t('common.delete')} bg="#dc2626" size={30} />
            ) : null}
            <View style={{ height: 4 }} />
            <FabButton
              onPress={() => { setRouteTextDraft(routeText); setShowRouteTextModal(true); }}
              svg={ICON_ROUTE()}
              title={t('vfr.editRouteText')}
              bg="#6366f1"
              size={34}
            />
            <FabButton
              onPress={handleExportPdf}
              disabled={!origin || !destination}
              svg={ICON_PDF()}
              title={t('vfr.exportPdf')}
              bg="#2254cc"
              size={34}
            />
            <FabButton
              onPress={() => setShowSimExportModal(true)}
              disabled={!origin || !destination}
              svg={ICON_PLN()}
              title={t('vfr.exportSim')}
              bg="#0e7490"
              size={34}
            />
            <FabButton
              onPress={() => { void handleAiValidate(); }}
              disabled={validating || (!aiReady && !validationResult)}
              svg={ICON_AI()}
              title={validating ? t('vfr.aiValidating') : !aiReady && !validationResult ? `${t('vfr.aiValidate')} — ${t('vfr.aiMissing')}: ${aiMissingItems.join(', ')}` : t('vfr.aiValidate')}
              bg="#d97706"
              size={34}
            />
            <FabButton
              onPress={handleSave}
              disabled={saving || !origin || !destination}
              svg={ICON_SAVE()}
              title={saving ? t('common.saving') : t('common.save')}
              bg="#16a34a"
              size={40}
            />
          </View>
        </>
      ) : null}
      {showSimExportModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowSimExportModal(false)}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', padding: 24 }}
            onPress={() => setShowSimExportModal(false)}
          >
            <Pressable
              style={{ width: '100%', maxWidth: 360, gap: 10 }}
              className="rounded-lg border border-border bg-card p-4 shadow-xl"
              onPress={() => {}}
            >
              <Text className="text-base font-bold text-foreground">{t('vfr.exportSim')}</Text>
              <Pressable
                onPress={() => { setShowSimExportModal(false); void handleExportFlightFile('msfs', exportFlightPlanPln); }}
                className="flex-row items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-3 active:opacity-70"
              >
                <View style={{ width: 28, height: 28 }}><SvgIcon svg={ICON_PLN('#0e7490')} size={22} /></View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">MSFS</Text>
                  <Text className="text-[11px] text-muted-foreground">.pln · planner.flightsimulator.com</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => { setShowSimExportModal(false); void handleExportFlightFile('charts', exportFlightPlanCharts); }}
                className="flex-row items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-3 active:opacity-70"
              >
                <View style={{ width: 28, height: 28 }}><SvgIcon svg={ICON_PLN('#7c3aed')} size={22} /></View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">Navigraph Charts</Text>
                  <Text className="text-[11px] text-muted-foreground">.pln · com pista</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => { setShowSimExportModal(false); void handleExportFlightFile('lnm', exportFlightPlanLnm); }}
                className="flex-row items-center gap-3 rounded-md border border-border bg-surface-muted px-3 py-3 active:opacity-70"
              >
                <View style={{ width: 28, height: 28 }}><SvgIcon svg={ICON_LNM('#0f766e')} size={22} /></View>
                <View className="flex-1">
                  <Text className="text-sm font-semibold text-foreground">Little Navmap</Text>
                  <Text className="text-[11px] text-muted-foreground">.lnmpln · com pista</Text>
                </View>
              </Pressable>
              <Pressable onPress={() => setShowSimExportModal(false)} className="mt-1 items-center py-2">
                <Text className="text-sm font-medium text-muted-foreground">{t('common.cancel')}</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
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

              {validationResult ? (
                <Pressable
                  className="flex-row items-center gap-3 py-2"
                  onPress={() => setExportIncludeAiAnalysis((v) => !v)}
                  disabled={exporting}
                >
                  <View className={`h-5 w-5 items-center justify-center rounded border ${exportIncludeAiAnalysis ? 'border-primary bg-primary' : 'border-border'}`}>
                    {exportIncludeAiAnalysis ? <Text className="text-xs font-bold text-primary-foreground">✓</Text> : null}
                  </View>
                  <Text className="text-sm text-foreground">{t('vfr.exportIncludeAiAnalysis')}</Text>
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
      {showValidationModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => { if (!validating) setShowValidationModal(false); }}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => { if (!validating) setShowValidationModal(false); }}
          >
            <Pressable
              style={{ width: '90%', maxWidth: 480, maxHeight: '80%' }}
              className="rounded-lg border border-border bg-card p-5 shadow-xl"
              onPress={() => {}}
            >
              <Text className="mb-4 text-base font-bold text-foreground">{t('vfr.aiValidationTitle')}</Text>

              {validating ? (
                <View className="items-center gap-3 py-8">
                  <ActivityIndicator size="large" color="#d97706" />
                  <Text className="text-sm text-muted-foreground">{t('vfr.aiValidating')}</Text>
                </View>
              ) : validationError ? (
                <View className="gap-3">
                  <Text className="text-sm text-destructive">{validationError}</Text>
                  <View className="flex-row gap-3">
                    <Pressable
                      className="flex-1 rounded-button border border-border px-4 py-2.5"
                      onPress={() => setShowValidationModal(false)}
                    >
                      <Text className="text-center text-sm font-medium text-foreground">{t('vfr.aiValidationClose')}</Text>
                    </Pressable>
                    <Pressable
                      className="flex-1 rounded-button bg-amber-500 px-4 py-2.5"
                      onPress={() => { void handleAiValidate(); }}
                    >
                      <Text className="text-center text-sm font-medium text-white">{t('vfr.aiValidationRetry')}</Text>
                    </Pressable>
                  </View>
                </View>
              ) : validationResult ? (
                <ScrollView style={{ maxHeight: 400 }}>
                  <View className={`mb-4 rounded-md px-4 py-3 ${
                    validationResult.overallStatus === 'pass' ? 'bg-green-500/10' :
                    validationResult.overallStatus === 'warnings' ? 'bg-amber-500/10' :
                    'bg-red-500/10'
                  }`}>
                    <Text className={`text-sm font-semibold ${
                      validationResult.overallStatus === 'pass' ? 'text-green-600' :
                      validationResult.overallStatus === 'warnings' ? 'text-amber-600' :
                      'text-red-600'
                    }`}>
                      {validationResult.overallStatus === 'pass' ? '✓ ' + t('vfr.aiValidationPass') :
                       validationResult.overallStatus === 'warnings' ? '⚠ ' + t('vfr.aiValidationWarnings') :
                       '✕ ' + t('vfr.aiValidationIssues')}
                    </Text>
                  </View>

                  {validationResult.items.map((item, idx) => (
                    <View key={idx} className="mb-3 rounded-md border border-border px-3 py-2.5">
                      <View className="flex-row items-center gap-2 mb-1">
                        <View className={`h-2.5 w-2.5 rounded-full ${
                          item.status === 'pass' ? 'bg-green-500' :
                          item.status === 'warn' ? 'bg-amber-500' :
                          'bg-red-500'
                        }`} />
                        <Text className="text-[10px] font-medium uppercase text-muted-foreground">{item.category}</Text>
                        <Text className="flex-1 text-sm font-semibold text-foreground">{item.title}</Text>
                      </View>
                      <SimpleMarkdown text={item.description} />
                    </View>
                  ))}

                  <View className="mt-2 rounded-md bg-surface-muted px-3 py-2.5">
                    <SimpleMarkdown text={validationResult.summary} italic />
                  </View>

                  {validationResult.meta ? (
                    <View className="mt-3 flex-row items-center justify-between border-t border-border pt-2.5">
                      <View className="flex-row items-center gap-1.5">
                        <View className={`h-1.5 w-1.5 rounded-full ${validationResult.meta.byok ? 'bg-primary' : 'bg-amber-500'}`} />
                        <Text className="text-[10px] text-muted-foreground">
                          {validationResult.meta.byok ? t('vfr.aiMetaByok') : t('vfr.aiMetaFree')}
                        </Text>
                        <Text className="text-[10px] font-medium text-foreground">
                          {validationResult.meta.model}
                        </Text>
                      </View>
                      {!validationResult.meta.byok && validationResult.meta.remaining != null ? (
                        <Text className="text-[10px] text-muted-foreground">
                          {t('vfr.aiMetaRemaining', { count: validationResult.meta.remaining })}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}
                </ScrollView>
              ) : null}

              {validationResult && !validating ? (
                <View className="mt-4 flex-row gap-3">
                  <Pressable
                    className="flex-1 rounded-button border border-border px-4 py-2.5"
                    onPress={() => setShowValidationModal(false)}
                  >
                    <Text className="text-center text-sm font-medium text-foreground">{t('vfr.aiValidationClose')}</Text>
                  </Pressable>
                  <Pressable
                    className="flex-1 rounded-button bg-amber-500 px-4 py-2.5"
                    onPress={() => { void requestAiValidation(); }}
                  >
                    <Text className="text-center text-sm font-medium text-white">{t('vfr.aiValidationRetry')}</Text>
                  </Pressable>
                </View>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Route text modal */}
      {showRouteTextModal ? (
        <Modal transparent animationType="fade" onRequestClose={() => setShowRouteTextModal(false)}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => setShowRouteTextModal(false)}
          >
            <Pressable
              style={{ width: '90%', maxWidth: 500 }}
              className="rounded-lg border border-border bg-card p-5 shadow-xl"
              onPress={() => {}}
            >
              <Text className="mb-1 text-base font-bold text-foreground">{t('vfr.editRouteText')}</Text>
              <Text className="mb-3 text-[11px] text-muted-foreground">{t('vfr.editRouteTextHint')}</Text>

              {Platform.OS === 'web' ? (
                <textarea
                  value={routeTextDraft}
                  onChange={(e: unknown) => setRouteTextDraft((e as { target: { value: string } }).target.value)}
                  rows={4}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 6,
                    border: '1px solid #d4d4d8',
                    fontSize: 13,
                    fontFamily: 'monospace',
                    backgroundColor: 'transparent',
                    color: 'inherit',
                    resize: 'vertical',
                    boxSizing: 'border-box',
                  }}
                  placeholder="DCT WPT01 DCT WPT02 DCT"
                />
              ) : (
                <TextInput
                  value={routeTextDraft}
                  onChangeText={setRouteTextDraft}
                  multiline
                  numberOfLines={4}
                  placeholder="DCT WPT01 DCT WPT02 DCT"
                  className="rounded-md border border-border bg-surface-muted px-3 py-2 font-mono text-sm text-foreground"
                  style={{ minHeight: 80, textAlignVertical: 'top' }}
                />
              )}

              <View className="mt-4 flex-row gap-2">
                <Pressable
                  onPress={() => setShowRouteTextModal(false)}
                  className="flex-1 items-center rounded-md border border-border px-3 py-2.5"
                >
                  <Text className="text-sm font-medium text-foreground">{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    const parsed = parseVfrRouteText(routeTextDraft);
                    const existingByName = new Map(routeWaypoints.map((wp) => [wp.name.toUpperCase(), wp]));
                    const resolved = parsed
                      .map((wp) => {
                        if (wp.lat !== 0 || wp.lng !== 0) return wp;
                        const existing = existingByName.get(wp.name.toUpperCase());
                        return existing ? { ...existing, name: wp.name } : null;
                      })
                      .filter((wp): wp is RouteWaypoint => wp != null);
                    setRouteWaypoints(resolved);
                    setFollowedCorridorName(null);
                    setCorridorAltRange(null);
                    setCorridorCompAlt(null);
                    setShowRouteTextModal(false);
                  }}
                  className="flex-1 items-center rounded-md bg-primary px-3 py-2.5"
                >
                  <Text className="text-sm font-medium text-primary-foreground">{t('common.save')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}

      {/* Insert waypoint modal */}
      {pendingWaypoint ? (
        <Modal transparent animationType="fade" onRequestClose={() => setPendingWaypoint(null)}>
          <Pressable
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' }}
            onPress={() => setPendingWaypoint(null)}
          >
            <Pressable
              style={{ width: '90%', maxWidth: 340 }}
              className="rounded-lg border border-border bg-card p-5 shadow-xl"
              onPress={() => {}}
            >
              <Text className="mb-1 text-base font-bold text-foreground">{t('vfr.insertWaypoint')}</Text>
              <Text className="mb-2 font-mono text-[11px] text-muted-foreground">
                {pendingWaypoint.lat.toFixed(4)}, {pendingWaypoint.lng.toFixed(4)}
              </Text>

              {/* Editable waypoint name */}
              <Input
                label={t('vfr.waypointName')}
                value={pendingWaypoint.name}
                onChangeText={(val) => setPendingWaypoint({ ...pendingWaypoint, name: val })}
                placeholder="WPT01"
                className="mb-3"
              />

              {/* Before / After */}
              <Text className="mb-1 text-xs font-semibold text-muted-foreground">{t('vfr.insertBefore')} / {t('vfr.insertAfter')}</Text>
              <View className="mb-3 flex-row gap-2">
                {(['before', 'after'] as const).map((pos) => (
                  <Pressable
                    key={pos}
                    onPress={() => setInsertPosition(pos)}
                    className={`flex-1 items-center rounded-md border px-3 py-2 ${
                      insertPosition === pos ? 'border-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    <Text className={`text-sm font-medium ${insertPosition === pos ? 'text-primary' : 'text-foreground'}`}>
                      {pos === 'before' ? t('vfr.insertBefore') : t('vfr.insertAfter')}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Reference waypoint */}
              <Text className="mb-1 text-xs font-semibold text-muted-foreground">{t('vfr.insertRelativeTo')}</Text>
              {(() => {
                // Single unified anchor list — picking an anchor + position
                // automatically determines which segment the waypoint joins
                // (see resolveInsert in confirmInsertWaypoint). "Destination"
                // is the divider: insert "after destination" lands in the
                // alternate leg when an alternate aerodrome is set.
                const anchors: { value: string; label: string }[] = [
                  { value: 'origin', label: origin?.icao ?? 'Origin' },
                  ...routeWaypoints.map((wp, i) => ({ value: `main-${i}`, label: wp.name })),
                  { value: 'destination', label: destination?.icao ?? 'Destination' },
                ];
                if (alternate) {
                  anchors.push(
                    ...alternateRouteWaypoints.map((wp, i) => ({ value: `alt-${i}`, label: wp.name })),
                    { value: 'alternate', label: `${alternate.icao} (alt)` },
                  );
                }
                return Platform.OS === 'web' ? (
                  <select
                    value={insertRefIndex}
                    onChange={(e: unknown) => setInsertRefIndex((e as { target: { value: string } }).target.value)}
                    style={{
                      width: '100%',
                      padding: 8,
                      borderRadius: 6,
                      border: '1px solid #d4d4d8',
                      fontSize: 14,
                      backgroundColor: 'transparent',
                      color: 'inherit',
                      marginBottom: 16,
                    }}
                  >
                    {anchors.map((a, i) => (
                      <option key={`${a.value}-${i}`} value={a.value}>{a.label}</option>
                    ))}
                  </select>
                ) : (
                  <View className="mb-4 rounded-md border border-border">
                    {anchors.map((a, i) => (
                      <Pressable
                        key={`${a.value}-${i}`}
                        onPress={() => setInsertRefIndex(a.value)}
                        className={`${i < anchors.length - 1 ? 'border-b border-border' : ''} px-3 py-2 ${insertRefIndex === a.value ? 'bg-primary/10' : ''}`}
                      >
                        <Text className={`text-sm ${insertRefIndex === a.value ? 'font-medium text-primary' : 'text-foreground'}`}>
                          {a.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })()}

              {/* Actions */}
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => setPendingWaypoint(null)}
                  className="flex-1 items-center rounded-md border border-border px-3 py-2.5"
                >
                  <Text className="text-sm font-medium text-foreground">{t('common.cancel')}</Text>
                </Pressable>
                <Pressable
                  onPress={confirmInsertWaypoint}
                  className="flex-1 items-center rounded-md bg-primary px-3 py-2.5"
                >
                  <Text className="text-sm font-medium text-primary-foreground">{t('vfr.insertConfirm')}</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
      <AircraftProfileModal
        visible={showProfileModal}
        editingProfile={editingProfile}
        catalog={aircraftCatalog}
        shared={sharedProfiles}
        preselectedBaseId={preselectedBaseId}
        onClose={() => setShowProfileModal(false)}
        onSaved={handleProfileSaved}
        onDeleted={handleProfileDeleted}
      />
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
  taf,
  tafLoading,
  tafTargetEpoch,
  tafTargetLabel,
  showTaf,
  runway,
  onRunwayChange,
  flightRules,
  runways,
  activeOverlays,
  onShowOverlay,
  onHideOverlay,
  t,
}: {
  aerodrome: Aerodrome;
  metar: ParsedMetar | null;
  metarLoading: boolean;
  taf: ParsedTaf | null;
  tafLoading: boolean;
  tafTargetEpoch?: number;
  tafTargetLabel?: string;
  showTaf: boolean;
  runway: string;
  onRunwayChange: (v: string) => void;
  flightRules?: 'VFR' | 'IFR' | 'VFR_IFR' | 'IFR_VFR';
  runways?: AerodromeWithRunways['runways'];
  activeOverlays: AerodromeOverlay[];
  onShowOverlay: (o: ChartOverlay) => void;
  onHideOverlay: (chartUrl: string) => void;
  t: (key: string) => string;
}) {
  const windInfo = useMemo((): RunwayWindInfo | null => {
    if (!runway || !metar || !runways) return null;
    const windDir = metar.windDirection;
    const windSpd = metar.windSpeed;
    if (typeof windDir !== 'number' || typeof windSpd !== 'number' || windSpd === 0) return null;
    const rwyHeading = runways.flatMap((r) => [
      { ident: r.leIdent, heading: r.leHeadingDeg },
      { ident: r.heIdent, heading: r.heHeadingDeg },
    ]).find((th) => th.ident === runway);
    if (!rwyHeading?.heading) return null;
    const diffRad = ((windDir - rwyHeading.heading) * Math.PI) / 180;
    return {
      ident: runway,
      headwindKts: Math.round(windSpd * Math.cos(diffRad)),
      crosswindKts: Math.round(Math.abs(windSpd * Math.sin(diffRad))),
    };
  }, [runway, metar, runways]);

  return (
    <View className="mb-4 ml-1">
      {aerodrome.elevation !== null ? (
        <Text className="text-xs text-muted-foreground">
          {t('vfr.elevation')}: {aerodrome.elevation} ft
        </Text>
      ) : null}
      <View className="mt-1 gap-1">
        <Text className="text-xs text-muted-foreground">{t('vfr.runwayInUse')}:</Text>
        <View className="flex-row flex-wrap gap-1.5">
          {runways?.flatMap((r) =>
            [r.leIdent, r.heIdent].filter((id): id is string => !!id && !r.closed),
          ).map((ident) => (
            <Pressable
              key={ident}
              onPress={() => onRunwayChange(runway === ident ? '' : ident)}
              className={`rounded-md border px-2.5 py-1 ${runway === ident ? 'border-primary bg-primary/10' : 'border-border'}`}
            >
              <Text className={`text-xs font-medium ${runway === ident ? 'text-primary' : 'text-foreground'}`}>
                {ident}
              </Text>
            </Pressable>
          )) ?? (
            <Text className="text-xs text-muted-foreground">—</Text>
          )}
        </View>
      </View>
      {windInfo ? (
        <View className="mt-0.5 ml-0.5 flex-row items-center gap-2">
          <Text className="text-xs text-muted-foreground">
            {windInfo.headwindKts >= 0 ? t('vfr.headwind') : t('vfr.tailwind')}: {Math.abs(windInfo.headwindKts)} kt
          </Text>
          <Text className={`text-xs ${windInfo.crosswindKts > 15 ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            {t('vfr.crosswind')}: {windInfo.crosswindKts} kt
          </Text>
        </View>
      ) : null}
      <MetarDisplay metar={metar} loading={metarLoading && !metar} />
      {showTaf ? (
        <TafDisplay taf={taf} loading={tafLoading && !taf} targetEpoch={tafTargetEpoch} targetLabel={tafTargetLabel} />
      ) : null}

      <Text className="mt-2 text-xs font-medium text-muted-foreground">{t('vfr.charts')}</Text>
      <ChartsPanel
        icao={aerodrome.icao}
        flightRules={flightRules}
        activeOverlayChartUrls={activeOverlays.filter((o) => o.icao === aerodrome.icao).map((o) => o.sourceUrl)}
        onShowOverlay={onShowOverlay}
        onHideOverlay={onHideOverlay}
      />
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

interface RunwayWindInfo {
  ident: string;
  headwindKts: number;
  crosswindKts: number;
}

function analyzeRunwayWind(
  windDir: number,
  windSpeed: number,
  runways: { leIdent: string | null; leHeadingDeg: number | null; heIdent: string | null; heHeadingDeg: number | null; closed: boolean }[],
): RunwayWindInfo | null {
  const open = runways.filter((r) => !r.closed);
  if (open.length === 0) return null;

  let best: RunwayWindInfo | null = null;

  for (const rwy of open) {
    for (const th of [
      { ident: rwy.leIdent, heading: rwy.leHeadingDeg },
      { ident: rwy.heIdent, heading: rwy.heHeadingDeg },
    ]) {
      if (!th.ident || th.heading === null) continue;
      const diffRad = ((windDir - th.heading) * Math.PI) / 180;
      const headwind = windSpeed * Math.cos(diffRad);
      const crosswind = Math.abs(windSpeed * Math.sin(diffRad));
      if (!best || headwind > best.headwindKts) {
        best = { ident: th.ident, headwindKts: Math.round(headwind), crosswindKts: Math.round(crosswind) };
      }
    }
  }

  return best;
}

function suggestRunway(
  windDir: number,
  runways: { leIdent: string | null; leHeadingDeg: number | null; heIdent: string | null; heHeadingDeg: number | null; closed: boolean }[],
): string | null {
  const info = analyzeRunwayWind(windDir, 1, runways);
  return info?.ident ?? null;
}
