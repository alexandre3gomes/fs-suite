export interface WeightStation {
  id: string;
  labelKey: string;
  defaultKg: number;
  maxKg: number;
  arm: number;
}

export interface AircraftSpec {
  icaoType: string;
  manufacturer: string;
  model: string;
  emptyWeightKg: number;
  mtowKg: number;
  fuelCapacityL: number;
  fuelBurnLph: number;
  cruiseSpeedKts: number;
  stations: WeightStation[];
}

const AIRCRAFT_CATALOG: AircraftSpec[] = [
  // ---- Cessna ----
  {
    icaoType: 'C152',
    manufacturer: 'Cessna',
    model: '152',
    emptyWeightKg: 508,
    mtowKg: 757,
    fuelCapacityL: 98,
    fuelBurnLph: 23,
    cruiseSpeedKts: 107,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.89 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.89 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 54, arm: 1.63 },
    ],
  },
  {
    icaoType: 'C172',
    manufacturer: 'Cessna',
    model: '172S Skyhawk SP',
    emptyWeightKg: 767,
    mtowKg: 1111,
    fuelCapacityL: 212,
    fuelBurnLph: 34,
    cruiseSpeedKts: 124,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.94 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 1.17 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 54, arm: 1.63 },
    ],
  },
  {
    icaoType: 'C182',
    manufacturer: 'Cessna',
    model: '182T Skylane',
    emptyWeightKg: 880,
    mtowKg: 1406,
    fuelCapacityL: 288,
    fuelBurnLph: 49,
    cruiseSpeedKts: 145,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.94 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 1.17 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 1.63 },
    ],
  },
  {
    icaoType: 'C206',
    manufacturer: 'Cessna',
    model: '206H Stationair',
    emptyWeightKg: 975,
    mtowKg: 1633,
    fuelCapacityL: 341,
    fuelBurnLph: 55,
    cruiseSpeedKts: 142,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.94 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.94 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 1.17 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 1.63 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 136, arm: 2.06 },
    ],
  },
  {
    icaoType: 'C208',
    manufacturer: 'Cessna',
    model: '208B Grand Caravan',
    emptyWeightKg: 2145,
    mtowKg: 3969,
    fuelCapacityL: 1249,
    fuelBurnLph: 205,
    cruiseSpeedKts: 186,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 4.50 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 4.50 },
      { id: 'pax', labelKey: 'aircraft.passengers', defaultKg: 0, maxKg: 1000, arm: 5.80 },
      { id: 'cargo', labelKey: 'aircraft.cargo', defaultKg: 0, maxKg: 340, arm: 7.60 },
    ],
  },
  // ---- Piper ----
  {
    icaoType: 'P28A',
    manufacturer: 'Piper',
    model: 'PA-28-161 Warrior II',
    emptyWeightKg: 612,
    mtowKg: 1055,
    fuelCapacityL: 189,
    fuelBurnLph: 34,
    cruiseSpeedKts: 117,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.05 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.05 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 2.85 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 3.46 },
    ],
  },
  {
    icaoType: 'P28R',
    manufacturer: 'Piper',
    model: 'PA-28R-201 Arrow',
    emptyWeightKg: 694,
    mtowKg: 1247,
    fuelCapacityL: 284,
    fuelBurnLph: 42,
    cruiseSpeedKts: 138,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.05 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.05 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 2.85 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 3.46 },
    ],
  },
  {
    icaoType: 'PA32',
    manufacturer: 'Piper',
    model: 'PA-32R-301 Saratoga',
    emptyWeightKg: 975,
    mtowKg: 1633,
    fuelCapacityL: 371,
    fuelBurnLph: 57,
    cruiseSpeedKts: 155,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.05 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.05 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 2.85 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.46 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 3.96 },
    ],
  },
  {
    icaoType: 'PA34',
    manufacturer: 'Piper',
    model: 'PA-34-220T Seneca V',
    emptyWeightKg: 1340,
    mtowKg: 2155,
    fuelCapacityL: 400,
    fuelBurnLph: 80,
    cruiseSpeedKts: 190,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.14 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.14 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 3.05 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.73 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 4.24 },
    ],
  },
  // ---- Beechcraft ----
  {
    icaoType: 'BE36',
    manufacturer: 'Beechcraft',
    model: 'A36 Bonanza',
    emptyWeightKg: 1030,
    mtowKg: 1656,
    fuelCapacityL: 318,
    fuelBurnLph: 53,
    cruiseSpeedKts: 165,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.05 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.05 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 2.85 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 136, arm: 3.46 },
    ],
  },
  {
    icaoType: 'BE58',
    manufacturer: 'Beechcraft',
    model: '58 Baron',
    emptyWeightKg: 1588,
    mtowKg: 2449,
    fuelCapacityL: 536,
    fuelBurnLph: 100,
    cruiseSpeedKts: 192,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.10 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.10 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 3.07 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.60 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 181, arm: 4.20 },
    ],
  },
  {
    icaoType: 'BE9L',
    manufacturer: 'Beechcraft',
    model: 'C90 King Air',
    emptyWeightKg: 3050,
    mtowKg: 4581,
    fuelCapacityL: 1514,
    fuelBurnLph: 280,
    cruiseSpeedKts: 226,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 4.30 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 4.30 },
      { id: 'pax', labelKey: 'aircraft.passengers', defaultKg: 0, maxKg: 600, arm: 5.70 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 227, arm: 7.10 },
    ],
  },
  // ---- Diamond ----
  {
    icaoType: 'DA40',
    manufacturer: 'Diamond',
    model: 'DA40 Diamond Star',
    emptyWeightKg: 825,
    mtowKg: 1150,
    fuelCapacityL: 148,
    fuelBurnLph: 31,
    cruiseSpeedKts: 130,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.37 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.37 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 150, arm: 3.14 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 30, arm: 3.70 },
    ],
  },
  {
    icaoType: 'DA42',
    manufacturer: 'Diamond',
    model: 'DA42 Twin Star',
    emptyWeightKg: 1280,
    mtowKg: 1785,
    fuelCapacityL: 292,
    fuelBurnLph: 42,
    cruiseSpeedKts: 169,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.37 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.37 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.14 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 45, arm: 3.70 },
    ],
  },
  {
    icaoType: 'DA62',
    manufacturer: 'Diamond',
    model: 'DA62',
    emptyWeightKg: 1440,
    mtowKg: 2300,
    fuelCapacityL: 326,
    fuelBurnLph: 52,
    cruiseSpeedKts: 183,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.50 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.50 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 3.30 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 4.10 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 50, arm: 4.50 },
    ],
  },
  // ---- Cirrus ----
  {
    icaoType: 'SR20',
    manufacturer: 'Cirrus',
    model: 'SR20',
    emptyWeightKg: 975,
    mtowKg: 1361,
    fuelCapacityL: 227,
    fuelBurnLph: 38,
    cruiseSpeedKts: 145,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.41 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.41 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.20 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 23, arm: 3.80 },
    ],
  },
  {
    icaoType: 'SR22',
    manufacturer: 'Cirrus',
    model: 'SR22',
    emptyWeightKg: 1009,
    mtowKg: 1542,
    fuelCapacityL: 336,
    fuelBurnLph: 50,
    cruiseSpeedKts: 176,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.41 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.41 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.20 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 59, arm: 3.80 },
    ],
  },
  // ---- Mooney ----
  {
    icaoType: 'M20P',
    manufacturer: 'Mooney',
    model: 'M20J 201',
    emptyWeightKg: 726,
    mtowKg: 1243,
    fuelCapacityL: 242,
    fuelBurnLph: 38,
    cruiseSpeedKts: 155,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.05 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.05 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 2.90 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 54, arm: 3.46 },
    ],
  },
  // ---- Robin ----
  {
    icaoType: 'DR40',
    manufacturer: 'Robin',
    model: 'DR400/180 Régent',
    emptyWeightKg: 590,
    mtowKg: 1100,
    fuelCapacityL: 110,
    fuelBurnLph: 32,
    cruiseSpeedKts: 130,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.41 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.41 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 170, arm: 1.15 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 40, arm: 1.83 },
    ],
  },
  // ---- Van's ----
  {
    icaoType: 'RV7',
    manufacturer: "Van's",
    model: 'RV-7',
    emptyWeightKg: 476,
    mtowKg: 816,
    fuelCapacityL: 151,
    fuelBurnLph: 27,
    cruiseSpeedKts: 175,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.03 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.03 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 23, arm: 2.95 },
    ],
  },
  {
    icaoType: 'RV10',
    manufacturer: "Van's",
    model: 'RV-10',
    emptyWeightKg: 680,
    mtowKg: 1089,
    fuelCapacityL: 227,
    fuelBurnLph: 38,
    cruiseSpeedKts: 175,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.03 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.03 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 3.05 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 45, arm: 3.73 },
    ],
  },
  // ---- Daher (TBM) ----
  {
    icaoType: 'TBM9',
    manufacturer: 'Daher',
    model: 'TBM 930',
    emptyWeightKg: 2073,
    mtowKg: 3354,
    fuelCapacityL: 1048,
    fuelBurnLph: 160,
    cruiseSpeedKts: 330,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.70 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.70 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 3.60 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 4.10 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 150, arm: 4.80 },
    ],
  },
  {
    icaoType: 'TBM8',
    manufacturer: 'Daher',
    model: 'TBM 850',
    emptyWeightKg: 1984,
    mtowKg: 3354,
    fuelCapacityL: 1048,
    fuelBurnLph: 157,
    cruiseSpeedKts: 320,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.70 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.70 },
      { id: 'midPax', labelKey: 'aircraft.midPax', defaultKg: 0, maxKg: 180, arm: 3.60 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 4.10 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 150, arm: 4.80 },
    ],
  },
  // ---- Pilatus ----
  {
    icaoType: 'PC12',
    manufacturer: 'Pilatus',
    model: 'PC-12 NGX',
    emptyWeightKg: 2810,
    mtowKg: 4740,
    fuelCapacityL: 1318,
    fuelBurnLph: 240,
    cruiseSpeedKts: 280,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 3.80 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 3.80 },
      { id: 'pax', labelKey: 'aircraft.passengers', defaultKg: 0, maxKg: 680, arm: 5.40 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 200, arm: 7.30 },
    ],
  },
  // ---- Tecnam ----
  {
    icaoType: 'P2006',
    manufacturer: 'Tecnam',
    model: 'P2006T',
    emptyWeightKg: 819,
    mtowKg: 1230,
    fuelCapacityL: 200,
    fuelBurnLph: 36,
    cruiseSpeedKts: 135,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.15 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.15 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 160, arm: 3.05 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 20, arm: 3.50 },
    ],
  },
  {
    icaoType: 'P2008',
    manufacturer: 'Tecnam',
    model: 'P2008JC',
    emptyWeightKg: 383,
    mtowKg: 600,
    fuelCapacityL: 120,
    fuelBurnLph: 18,
    cruiseSpeedKts: 105,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.38 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.38 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 15, arm: 1.30 },
    ],
  },
  // ---- Extra ----
  {
    icaoType: 'E300',
    manufacturer: 'Extra',
    model: 'EA-300',
    emptyWeightKg: 660,
    mtowKg: 950,
    fuelCapacityL: 160,
    fuelBurnLph: 45,
    cruiseSpeedKts: 170,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 0.27 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 0.60 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 20, arm: 1.10 },
    ],
  },
  // ---- Neiva (Brazilian) ----
  {
    icaoType: 'IPAN',
    manufacturer: 'Neiva',
    model: 'NE-821 Ipanema',
    emptyWeightKg: 1070,
    mtowKg: 1800,
    fuelCapacityL: 220,
    fuelBurnLph: 50,
    cruiseSpeedKts: 100,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.20 },
      { id: 'hopper', labelKey: 'aircraft.cargo', defaultKg: 0, maxKg: 600, arm: 1.45 },
    ],
  },
  // ---- Embraer ----
  {
    icaoType: 'TUCA',
    manufacturer: 'Embraer',
    model: 'EMB-712 Tupi',
    emptyWeightKg: 612,
    mtowKg: 1055,
    fuelCapacityL: 189,
    fuelBurnLph: 34,
    cruiseSpeedKts: 117,
    stations: [
      { id: 'pilot', labelKey: 'aircraft.pilot', defaultKg: 80, maxKg: 120, arm: 2.05 },
      { id: 'copilot', labelKey: 'aircraft.copilot', defaultKg: 0, maxKg: 120, arm: 2.05 },
      { id: 'rearPax', labelKey: 'aircraft.rearPax', defaultKg: 0, maxKg: 180, arm: 2.85 },
      { id: 'baggage', labelKey: 'aircraft.baggage', defaultKg: 0, maxKg: 91, arm: 3.46 },
    ],
  },
];

export function searchAircraft(query: string): AircraftSpec[] {
  const q = query.toLowerCase().trim();
  if (!q) return AIRCRAFT_CATALOG.slice(0, 8);
  return AIRCRAFT_CATALOG.filter(
    (a) =>
      a.icaoType.toLowerCase().includes(q) ||
      a.manufacturer.toLowerCase().includes(q) ||
      a.model.toLowerCase().includes(q) ||
      `${a.manufacturer} ${a.model}`.toLowerCase().includes(q),
  );
}

export function findAircraftByIcao(icaoType: string): AircraftSpec | undefined {
  return AIRCRAFT_CATALOG.find((a) => a.icaoType === icaoType);
}

export { AIRCRAFT_CATALOG };
