export function windTriangle(
  tas: number,
  trueCourse: number,
  windDirection: number | null,
  windSpeed: number | null,
): { groundSpeed: number; wca: number } {
  if (windDirection == null || windSpeed == null || windSpeed === 0 || tas <= 0) {
    return { groundSpeed: tas, wca: 0 };
  }

  const tcRad = (trueCourse * Math.PI) / 180;
  const wdRad = (windDirection * Math.PI) / 180;
  const xwind = windSpeed * Math.sin(wdRad - tcRad);

  if (Math.abs(xwind) >= tas) {
    return { groundSpeed: Math.max(1, tas - windSpeed), wca: 0 };
  }

  const wcaRad = Math.asin(xwind / tas);
  const headwind = windSpeed * Math.cos(wdRad - tcRad);
  const gs = tas * Math.cos(wcaRad) - headwind;

  return {
    groundSpeed: Math.max(1, Math.round(gs)),
    wca: Math.round((wcaRad * 180) / Math.PI),
  };
}

export function cruiseLevelToFeet(cruiseLevel: string): number | null {
  const flMatch = cruiseLevel.match(/^(?:FL|F)(\d{2,3})$/i);
  if (flMatch) return parseInt(flMatch[1]!, 10) * 100;

  const aMatch = cruiseLevel.match(/^A(\d{3})$/i);
  if (aMatch) return parseInt(aMatch[1]!, 10) * 100;

  const rawFt = parseInt(cruiseLevel, 10);
  return isNaN(rawFt) ? null : rawFt;
}
