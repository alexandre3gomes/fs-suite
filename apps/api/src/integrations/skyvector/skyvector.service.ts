import { Injectable } from '@nestjs/common';

@Injectable()
export class SkyVectorService {
  buildUrl(originIcao: string, destinationIcao: string, route?: string): { url: string } {
    // SkyVector URL pattern: https://skyvector.com/?fpl=ORIGIN+WAYPOINT1+WAYPOINT2+DESTINATION
    const parts = [originIcao.toUpperCase()];

    if (route) {
      // Split route string by whitespace and filter empty parts
      const waypoints = route
        .split(/\s+/)
        .map((w) => w.trim().toUpperCase())
        .filter((w) => w.length > 0);
      parts.push(...waypoints);
    }

    parts.push(destinationIcao.toUpperCase());

    const fpl = parts.join('+');
    return { url: `https://skyvector.com/?fpl=${fpl}` };
  }
}
