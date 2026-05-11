import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type WeightUnit = 'kg' | 'lbs';
export type VolumeUnit = 'L' | 'gal';
export type SpeedUnit = 'kt' | 'km/h' | 'mph';

interface UnitsState {
  weight: WeightUnit;
  volume: VolumeUnit;
  speed: SpeedUnit;
  setWeight: (u: WeightUnit) => void;
  setVolume: (u: VolumeUnit) => void;
  setSpeed: (u: SpeedUnit) => void;
}

const STORAGE_KEY = '@fs-suite/units';

function persist(state: Pick<UnitsState, 'weight' | 'volume' | 'speed'>): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export const useUnitsStore = create<UnitsState>((set, get) => ({
  weight: 'kg',
  volume: 'L',
  speed: 'kt',

  setWeight: (weight) => {
    set({ weight });
    const { volume, speed } = get();
    persist({ weight, volume, speed });
  },
  setVolume: (volume) => {
    set({ volume });
    const { weight, speed } = get();
    persist({ weight, volume, speed });
  },
  setSpeed: (speed) => {
    set({ speed });
    const { weight, volume } = get();
    persist({ weight, volume, speed });
  },
}));

export async function restoreUnits(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<Pick<UnitsState, 'weight' | 'volume' | 'speed'>>;
    useUnitsStore.setState({
      ...(parsed.weight && { weight: parsed.weight }),
      ...(parsed.volume && { volume: parsed.volume }),
      ...(parsed.speed && { speed: parsed.speed }),
    });
  } catch { /* ignore */ }
}

const KG_TO_LBS = 2.20462;
const L_TO_GAL = 0.264172;
const KT_TO_KMH = 1.852;
const KT_TO_MPH = 1.15078;
const AVGAS_KG_PER_L = 0.72;

export function formatWeight(kg: number, unit: WeightUnit, decimals = 0): string {
  const val = unit === 'lbs' ? kg * KG_TO_LBS : kg;
  return `${val.toFixed(decimals)} ${unit}`;
}

export function formatVolume(liters: number, unit: VolumeUnit, decimals = 0): string {
  const val = unit === 'gal' ? liters * L_TO_GAL : liters;
  return `${val.toFixed(decimals)} ${unit}`;
}

export function formatFuelWeight(kg: number, unit: VolumeUnit, decimals = 1): string {
  const liters = kg / AVGAS_KG_PER_L;
  return formatVolume(liters, unit, decimals);
}

export function formatSpeed(kts: number, unit: SpeedUnit, decimals = 0): string {
  let val = kts;
  if (unit === 'km/h') val = kts * KT_TO_KMH;
  else if (unit === 'mph') val = kts * KT_TO_MPH;
  return `${val.toFixed(decimals)} ${unit}`;
}

export function formatFuelFlow(kgH: number, unit: VolumeUnit, decimals = 1): string {
  const lH = kgH / AVGAS_KG_PER_L;
  const val = unit === 'gal' ? lH * L_TO_GAL : lH;
  const suffix = unit === 'gal' ? 'gal/h' : 'L/h';
  return `${val.toFixed(decimals)} ${suffix}`;
}
