import { describe, expect, it } from 'vitest';

import { choosePageForArp, gptsBounds } from './chart-overlays.service';

// Real GeoPDF /GPTS arrays from the SBJD VAC PDF (DECEA, AIRAC 2605).
// The PDF carries two georeferenced frames; the aerodrome-centred VAC is
// page index 1, NOT 0 — page 0 sits ~16 NM south of the field. Defaulting
// to page 0 plotted the overlay far from the aerodrome (user-reported bug).
const SBJD_PAGE0 = {
  pageIndex: 0,
  geo: { gpts: [-23.5583, -46.998, -23.5591, -46.8458, -23.3476, -46.8446, -23.3468, -46.9966], lpts: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] },
};
const SBJD_PAGE1 = {
  pageIndex: 1,
  geo: { gpts: [-23.28611, -46.99578, -23.28688, -46.84383, -23.07534, -46.84267, -23.07457, -46.99442], lpts: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9] },
};

// SBJD ARP (Comte. Rolim Adolfo Amaro – Jundiaí).
const SBJD_ARP = { lat: -23.180861, lon: -46.943921 };

describe('choosePageForArp', () => {
  it('selects the aerodrome page (1) for SBJD, not page 0', () => {
    expect(choosePageForArp([SBJD_PAGE0, SBJD_PAGE1], SBJD_ARP.lat, SBJD_ARP.lon)).toBe(1);
  });

  it('is order-independent (page 1 listed first still wins)', () => {
    expect(choosePageForArp([SBJD_PAGE1, SBJD_PAGE0], SBJD_ARP.lat, SBJD_ARP.lon)).toBe(1);
  });

  it('only page 1 bounds actually contain the ARP', () => {
    const b0 = gptsBounds(SBJD_PAGE0.geo);
    const b1 = gptsBounds(SBJD_PAGE1.geo);
    const contains = (b: typeof b0): boolean =>
      SBJD_ARP.lat >= b.south && SBJD_ARP.lat <= b.north && SBJD_ARP.lon >= b.west && SBJD_ARP.lon <= b.east;
    expect(contains(b0)).toBe(false);
    expect(contains(b1)).toBe(true);
  });

  it('falls back to nearest-center when no page contains the ARP', () => {
    // ARP far north of both frames → neither contains it; page 1 is closer.
    expect(choosePageForArp([SBJD_PAGE0, SBJD_PAGE1], -22.0, -46.92)).toBe(1);
  });

  it('prefers the smallest-area frame among pages that contain the ARP', () => {
    const wide = { pageIndex: 0, geo: { gpts: [-24, -48, -24, -45, -22, -45, -22, -48], lpts: [0, 0, 1, 0, 1, 1, 0, 1] } };
    const tight = { pageIndex: 1, geo: { gpts: [-23.25, -47.0, -23.25, -46.85, -23.1, -46.85, -23.1, -47.0], lpts: [0, 0, 1, 0, 1, 1, 0, 1] } };
    expect(choosePageForArp([wide, tight], SBJD_ARP.lat, SBJD_ARP.lon)).toBe(1);
  });

  it('returns -1 when there are no georeferenced pages', () => {
    expect(choosePageForArp([], SBJD_ARP.lat, SBJD_ARP.lon)).toBe(-1);
  });
});
