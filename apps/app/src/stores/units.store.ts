import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type WeightUnit = 'kg' | 'lbs';
export type FuelUnit = 'kg' | 'lbs' | 'L' | 'gal';
export type SpeedUnit = 'kt' | 'km/h' | 'mph';

interface UnitsState {
  weight: WeightUnit;
  fuel: FuelUnit;
  speed: SpeedUnit;
  setWeight: (u: WeightUnit) => void;
  setFuel: (u: FuelUnit) => void;
  setSpeed: (u: SpeedUnit) => void;
}

const STORAGE_KEY = '@fs-suite/units';

function persist(state: Pick<UnitsState, 'weight' | 'fuel' | 'speed'>): void {
  AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
}

export const useUnitsStore = create<UnitsState>((set, get) => ({
  weight: 'kg',
  fuel: 'kg',
  speed: 'kt',

  setWeight: (weight) => {
    set({ weight });
    const { fuel, speed } = get();
    persist({ weight, fuel, speed });
  },
  setFuel: (fuel) => {
    set({ fuel });
    const { weight, speed } = get();
    persist({ weight, fuel, speed });
  },
  setSpeed: (speed) => {
    set({ speed });
    const { weight, fuel } = get();
    persist({ weight, fuel, speed });
  },
}));

export async function restoreUnits(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<{
      weight: WeightUnit;
      fuel: FuelUnit;
      // Legacy key: prior versions stored fuel as `volume` with L | gal only.
      volume: 'L' | 'gal';
      speed: SpeedUnit;
    }>;
    useUnitsStore.setState({
      ...(parsed.weight && { weight: parsed.weight }),
      ...(parsed.fuel && { fuel: parsed.fuel }),
      ...(!parsed.fuel && parsed.volume && { fuel: parsed.volume }),
      ...(parsed.speed && { speed: parsed.speed }),
    });
  } catch { /* ignore */ }
}

// ---- Conversion constants (canonical = kg / kts) ----
const KG_TO_LBS = 2.20462;
const L_TO_GAL = 0.264172;
const KT_TO_KMH = 1.852;
const KT_TO_MPH = 1.15078;
const AVGAS_KG_PER_L = 0.72;

/** Convert mass in kg to the display amount for the given fuel unit. */
export function kgToFuelAmount(kg: number, unit: FuelUnit): number {
  switch (unit) {
    case 'kg': return kg;
    case 'lbs': return kg * KG_TO_LBS;
    case 'L': return kg / AVGAS_KG_PER_L;
    case 'gal': return (kg / AVGAS_KG_PER_L) * L_TO_GAL;
  }
}

/** Convert a display amount in the given fuel unit back to canonical kg. */
export function fuelAmountToKg(amount: number, unit: FuelUnit): number {
  switch (unit) {
    case 'kg': return amount;
    case 'lbs': return amount / KG_TO_LBS;
    case 'L': return amount * AVGAS_KG_PER_L;
    case 'gal': return (amount / L_TO_GAL) * AVGAS_KG_PER_L;
  }
}

/** Suffix used for an hourly fuel-flow value in the given unit. */
export function fuelFlowSuffix(unit: FuelUnit): string {
  return `${unit}/h`;
}

export function formatWeight(kg: number, unit: WeightUnit, decimals = 0): string {
  const val = unit === 'lbs' ? kg * KG_TO_LBS : kg;
  return `${val.toFixed(decimals)} ${unit}`;
}

export function formatFuel(kg: number, unit: FuelUnit, decimals = unit === 'kg' || unit === 'lbs' ? 0 : 1): string {
  return `${kgToFuelAmount(kg, unit).toFixed(decimals)} ${unit}`;
}

export function formatFuelFlow(kgH: number, unit: FuelUnit, decimals = unit === 'kg' || unit === 'lbs' ? 0 : 1): string {
  return `${kgToFuelAmount(kgH, unit).toFixed(decimals)} ${fuelFlowSuffix(unit)}`;
}

export function formatSpeed(kts: number, unit: SpeedUnit, decimals = 0): string {
  let val = kts;
  if (unit === 'km/h') val = kts * KT_TO_KMH;
  else if (unit === 'mph') val = kts * KT_TO_MPH;
  return `${val.toFixed(decimals)} ${unit}`;
}
