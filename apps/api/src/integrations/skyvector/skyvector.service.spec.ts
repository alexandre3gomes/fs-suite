import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import type { AirportsService } from '../../airports/airports.service';

import { SkyVectorService } from './skyvector.service';

// parseFpl is pure (no DB), so a null AirportsService is fine for these.
const svc = new SkyVectorService(null as unknown as AirportsService);

const FPL = `<?xml version="1.0" encoding="utf-8"?>
<flight-plan xmlns="http://www8.garmin.com/xmlschemas/FlightPlan/v1">
  <waypoint-table>
    <waypoint><identifier>KSFO</identifier><type>AIRPORT</type><lat>37.618806</lat><lon>-122.375417</lon></waypoint>
    <waypoint><identifier>PXN</identifier><type>VOR</type><lat>36.715458</lat><lon>-120.778683</lon></waypoint>
    <waypoint><identifier>CL35</identifier><type>AIRPORT</type><lat>33.284503</lat><lon>-116.669658</lon></waypoint>
  </waypoint-table>
  <route>
    <route-name>KSFO CL35</route-name>
    <route-point><waypoint-identifier>KSFO</waypoint-identifier><waypoint-type>AIRPORT</waypoint-type></route-point>
    <route-point><waypoint-identifier>PXN</waypoint-identifier><waypoint-type>VOR</waypoint-type></route-point>
    <route-point><waypoint-identifier>CL35</waypoint-identifier><waypoint-type>AIRPORT</waypoint-type></route-point>
  </route>
</flight-plan>`;

describe('SkyVectorService.parseFpl', () => {
  it('parses a Garmin/SkyVector .fpl into ordered points with coordinates', () => {
    const { routeName, points } = svc.parseFpl(FPL);
    expect(routeName).toBe('KSFO CL35');
    expect(points.map((p) => p.ident)).toEqual(['KSFO', 'PXN', 'CL35']);
    expect(points[0]).toMatchObject({ ident: 'KSFO', lat: 37.618806, lon: -122.375417 });
    expect(points[2]?.ident).toBe('CL35'); // FAA local code preserved
  });

  it('rejects non-FPL content', () => {
    expect(() => svc.parseFpl('<html><body>nope</body></html>')).toThrow(BadRequestException);
  });

  it('rejects a plan with fewer than two resolvable points', () => {
    const tiny = `<flight-plan><waypoint-table><waypoint><identifier>KSFO</identifier><lat>37.6</lat><lon>-122.4</lon></waypoint></waypoint-table><route><route-point><waypoint-identifier>KSFO</waypoint-identifier></route-point></route></flight-plan>`;
    expect(() => svc.parseFpl(tiny)).toThrow(BadRequestException);
  });

  it('buildUrl keeps + separators and uppercases', () => {
    expect(svc.buildUrl('ksfo', 'klgb', '3535N11739W').url).toBe(
      'https://skyvector.com/?fpl=KSFO+3535N11739W+KLGB',
    );
  });
});
