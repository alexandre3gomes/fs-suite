export interface ChecklistEntry {
  id: string;
  label: string;
  pdfUrl: string;
}

export interface AircraftChecklists {
  icaoType: string;
  checklists: ChecklistEntry[];
}

const JSDELIVR = 'https://cdn.jsdelivr.net/gh';

const CATALOG: AircraftChecklists[] = [
  {
    icaoType: 'C152',
    checklists: [
      { id: 'c152-normal', label: 'Cessna 152 — Normal', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/Cessna%20152/Cessna_152.pdf` },
    ],
  },
  {
    icaoType: 'C172',
    checklists: [
      { id: 'c172-normal', label: 'Cessna 172SP', pdfUrl: `${JSDELIVR}/jsvana/checklists@master/c172sp.pdf` },
      { id: 'c172-g1000', label: 'Cessna 172SP G1000', pdfUrl: `${JSDELIVR}/jsvana/checklists@master/c172sp_g1000.pdf` },
      { id: 'c172-sim', label: 'Cessna 172 (Sim)', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/Cessna%20172/Cessna_172.pdf` },
    ],
  },
  {
    icaoType: 'C182',
    checklists: [
      { id: 'c182-g1000', label: 'Cessna 182T G1000', pdfUrl: `${JSDELIVR}/jsvana/checklists@master/c182t_g1000.pdf` },
    ],
  },
  {
    icaoType: 'P28A',
    checklists: [
      { id: 'pa28-arrow', label: 'Piper PA-28R Arrow', pdfUrl: `${JSDELIVR}/jsvana/checklists@master/pa28r_arrow.pdf` },
    ],
  },
  {
    icaoType: 'P28R',
    checklists: [
      { id: 'p28r-arrow', label: 'Piper PA-28R Arrow', pdfUrl: `${JSDELIVR}/jsvana/checklists@master/pa28r_arrow.pdf` },
    ],
  },
  {
    icaoType: 'BE36',
    checklists: [
      { id: 'be36-sim', label: 'Bonanza G36 (Sim)', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/Beechcraft%20Bonanza%20G36/Beechcraft_Bonanza_G36.pdf` },
    ],
  },
  {
    icaoType: 'BE58',
    checklists: [
      { id: 'be58-sim', label: 'Baron 58 (Sim)', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/Beechcraft%20Baron%2058/Beechcraft_Baron_58.pdf` },
    ],
  },
  {
    icaoType: 'SR22',
    checklists: [
      { id: 'sr22-normal', label: 'Cirrus SR22 — Normal', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/Cirrus%20SR22/Cirrus_SR22.pdf` },
    ],
  },
  {
    icaoType: 'TBM9',
    checklists: [
      { id: 'tbm930-normal', label: 'TBM 930 — Normal', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/TBM%20930/TBM_930.pdf` },
      { id: 'tbm930-emerg', label: 'TBM 930 — Emergency', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/TBM%20930/TBM_930_Emergency.pdf` },
    ],
  },
  {
    icaoType: 'TBM8',
    checklists: [
      { id: 'tbm930-normal-8', label: 'TBM 930 — Normal', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/TBM%20930/TBM_930.pdf` },
    ],
  },
  {
    icaoType: 'PC12',
    checklists: [
      { id: 'pc12-sim', label: 'PC-12 Legacy (Sim)', pdfUrl: `${JSDELIVR}/coopermor/FlightSimChecklists@master/Pilatus%20PC-12/Pilatus_PC-12.pdf` },
    ],
  },
];

export function getChecklistsForAircraft(icaoType: string): ChecklistEntry[] {
  return CATALOG.find((c) => c.icaoType === icaoType)?.checklists ?? [];
}
