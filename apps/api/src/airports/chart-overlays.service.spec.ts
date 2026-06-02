import { describe, expect, it } from 'vitest';

import { boundsContain, gptsBounds, heuristicBounds, lptsEqual } from './chart-overlays.service';

// Real GeoPDF frames from the SBJD VAC PDF (DECEA, AIRAC 2605). The PDF has two
// georeferenced pages with IDENTICAL LPTS and span (same chart frame):
//   page 0 = the VAC graphic — GPTS offset ~16 NM south, ARP falls OUTSIDE.
//   page 1 = the reverse/text page — GPTS correct, contains the ARP.
// Fix: render the graphic (page 0) but borrow page 1's valid georef.
const SBJD_PAGE0 = {
  gpts: [-23.5583, -46.998, -23.5591, -46.8458, -23.3476, -46.8446, -23.3468, -46.9966],
  lpts: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
};
const SBJD_PAGE1 = {
  gpts: [-23.28611, -46.99578, -23.28688, -46.84383, -23.07534, -46.84267, -23.07457, -46.99442],
  lpts: [0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9],
};
const SBJD_ARP = { lat: -23.180861, lon: -46.943921 };

describe('chart overlay georeferencing', () => {
  it('gptsBounds derives the axis-aligned box from GPTS', () => {
    const b = gptsBounds(SBJD_PAGE0);
    expect(b.south).toBeCloseTo(-23.5591, 3);
    expect(b.north).toBeCloseTo(-23.3468, 3);
    expect(b.west).toBeCloseTo(-46.998, 3);
    expect(b.east).toBeCloseTo(-46.8446, 3);
  });

  it('the graphic page (0) georef does NOT cover the ARP; the sibling page (1) does', () => {
    expect(boundsContain(gptsBounds(SBJD_PAGE0), SBJD_ARP.lat, SBJD_ARP.lon)).toBe(false);
    expect(boundsContain(gptsBounds(SBJD_PAGE1), SBJD_ARP.lat, SBJD_ARP.lon)).toBe(true);
  });

  it('the two pages share LPTS (same frame) — so the sibling georef is transferable', () => {
    expect(lptsEqual(SBJD_PAGE0.lpts, SBJD_PAGE1.lpts)).toBe(true);
  });

  it('decision: page 0 georef rejected → sibling page 1 georef chosen', () => {
    const exact = boundsContain(gptsBounds(SBJD_PAGE0), SBJD_ARP.lat, SBJD_ARP.lon);
    const siblingUsable =
      !exact &&
      boundsContain(gptsBounds(SBJD_PAGE1), SBJD_ARP.lat, SBJD_ARP.lon) &&
      lptsEqual(SBJD_PAGE1.lpts, SBJD_PAGE0.lpts);
    expect(exact).toBe(false);
    expect(siblingUsable).toBe(true);
    // The chosen bounds (page 1) place the ARP sensibly inside the frame.
    const b = gptsBounds(SBJD_PAGE1);
    const fracNS = (SBJD_ARP.lat - b.south) / (b.north - b.south);
    const fracWE = (SBJD_ARP.lon - b.west) / (b.east - b.west);
    expect(fracNS).toBeGreaterThan(0.3);
    expect(fracNS).toBeLessThan(0.7);
    expect(fracWE).toBeGreaterThan(0.2);
    expect(fracWE).toBeLessThan(0.8);
  });

  it('lptsEqual rejects mismatched viewport geometry', () => {
    expect(lptsEqual([0.1, 0.1, 0.9, 0.1, 0.9, 0.9, 0.1, 0.9], [0.05, 0.05, 0.95, 0.05, 0.95, 0.95, 0.05, 0.95])).toBe(false);
    expect(lptsEqual([0, 0, 1, 1], [0, 0, 1])).toBe(false);
  });

  it('heuristic fallback: ARP-centred box contains the ARP with a 3 NM floor', () => {
    const b = heuristicBounds(SBJD_ARP.lat, SBJD_ARP.lon, 4593);
    expect((b.south + b.north) / 2).toBeCloseTo(SBJD_ARP.lat, 6);
    expect((b.west + b.east) / 2).toBeCloseTo(SBJD_ARP.lon, 6);
    expect(boundsContain(b, SBJD_ARP.lat, SBJD_ARP.lon)).toBe(true);
    expect((heuristicBounds(SBJD_ARP.lat, SBJD_ARP.lon, 500).north - heuristicBounds(SBJD_ARP.lat, SBJD_ARP.lon, 500).south) * 60).toBeCloseTo(3, 1);
  });

  it('heuristic tolerates missing runway length', () => {
    expect(boundsContain(heuristicBounds(SBJD_ARP.lat, SBJD_ARP.lon, null), SBJD_ARP.lat, SBJD_ARP.lon)).toBe(true);
  });
});
