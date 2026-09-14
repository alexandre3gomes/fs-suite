import { describe, expect, it } from 'vitest';

import { PtVfrService } from './pt-vfr.service';

describe('PtVfrService (curated NAV Portugal eVFR dataset)', () => {
  const svc = new PtVfrService();

  it('serves the published VFR tunnels with sane geometry', () => {
    const { routes, effectiveDate, source } = svc.getRoutes();
    expect(source).toContain('NAV Portugal');
    expect(effectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(routes.length).toBeGreaterThanOrEqual(10);

    for (const route of routes) {
      expect(route.points.length).toBeGreaterThanOrEqual(2);
      expect(route.legs).toHaveLength(route.points.length - 1);
      // All coordinates inside mainland Portugal's bounding box
      for (const p of route.points) {
        expect(p.lat).toBeGreaterThan(36.5);
        expect(p.lat).toBeLessThan(42.5);
        expect(p.lon).toBeGreaterThan(-10);
        expect(p.lon).toBeLessThan(-6);
      }
      // Every leg carries at least one altitude limit
      for (const leg of route.legs) {
        expect(leg.upperFt ?? leg.lowerFt).not.toBeNull();
      }
    }
  });

  it('covers the three published TMAs', () => {
    const areas = new Set(svc.getRoutes().routes.map((r) => r.area));
    expect(areas).toContain('Lisboa');
    expect(areas).toContain('Porto');
    expect(areas).toContain('Faro');
  });

  it('serves ENR 4.4 visual reporting points with route membership', () => {
    const { points } = svc.getPoints();
    expect(points.length).toBeGreaterThanOrEqual(30);
    for (const p of points) {
      expect(p.name.length).toBeGreaterThan(0);
      // Mainland + archipelagos bounding box
      expect(p.lat).toBeGreaterThan(32);
      expect(p.lat).toBeLessThan(42.5);
      expect(p.lon).toBeGreaterThan(-32);
      expect(p.lon).toBeLessThan(-6);
    }
    // Route names with embedded commas must not be split apart
    const lisbonCrossing = points.flatMap((p) => p.routes).find((r) => r.includes('cruzamento de LPPT'));
    expect(lisbonCrossing).toMatch(/entrada, saída e cruzamento/);
  });
});
