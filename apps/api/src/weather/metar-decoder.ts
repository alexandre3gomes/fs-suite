import type { ParsedMetar } from '@fs-suite/types';

const CLOUD_COVER: Record<string, string> = {
  FEW: 'poucas nuvens',
  SCT: 'nuvens esparsas',
  BKN: 'nublado',
  OVC: 'encoberto',
};

const WEATHER_PHENOMENA: Record<string, string> = {
  RA: 'chuva',
  DZ: 'chuvisco',
  SN: 'neve',
  SG: 'neve granular',
  IC: 'cristais de gelo',
  PL: 'pelotas de gelo',
  GR: 'granizo',
  GS: 'granizo pequeno',
  BR: 'neblina',
  FG: 'nevoeiro',
  FU: 'fumaça',
  VA: 'cinza vulcânica',
  DU: 'poeira',
  SA: 'areia',
  HZ: 'névoa seca',
  PO: 'redemoinho de poeira',
  SQ: 'tempestade de linha',
  FC: 'funil de nuvem',
  SS: 'tempestade de areia',
  DS: 'tempestade de poeira',
  UP: 'precipitação desconhecida',
};

const WEATHER_DESCRIPTORS: Record<string, string> = {
  TS: 'trovoada',
  SH: 'pancadas de',
  FZ: 'congelante',
  BL: 'soprada',
  DR: 'baixa à deriva',
  MI: 'superficial',
  BC: 'bancos de',
  PR: 'parcial',
};

const INTENSITY: Record<string, string> = {
  '-': 'leve',
  '+': 'forte',
};

const FLIGHT_CATEGORY_LABEL: Record<string, string> = {
  VFR: 'VFR',
  MVFR: 'VFR marginal',
  IFR: 'IFR',
  LIFR: 'IFR baixo',
};

function decodeWind(metar: ParsedMetar): string {
  if (metar.windSpeed === 0 && (metar.windDirection === 0 || metar.windDirection === null)) {
    return 'Vento calmo';
  }

  let text: string;
  if (metar.windDirection === 'VRB') {
    text = `Vento variável a ${metar.windSpeed} nós`;
  } else if (metar.windDirection != null) {
    text = `Vento de ${String(metar.windDirection).padStart(3, '0')}° a ${metar.windSpeed} nós`;
  } else {
    return '';
  }

  if (metar.windGust) {
    text += `, rajadas ${metar.windGust} nós`;
  }

  if (metar.variableWindDir) {
    text += ` (variando de ${metar.variableWindDir.from}° a ${metar.variableWindDir.to}°)`;
  }

  return text;
}

function decodeVisibility(vis: string | null): string {
  if (vis == null) return '';

  const meters = parseInt(vis, 10);
  if (!isNaN(meters) && meters >= 100) {
    if (meters >= 9999) return 'Visibilidade maior que 10km';
    if (meters >= 1000) return `Visibilidade ${(meters / 1000).toFixed(1).replace('.0', '')}km`;
    return `Visibilidade ${meters}m`;
  }

  const sm = parseFloat(vis);
  if (!isNaN(sm)) {
    if (sm >= 6) return 'Visibilidade maior que 10km';
    const km = sm * 1.609;
    return `Visibilidade ${km.toFixed(1).replace('.0', '')}km`;
  }

  return `Visibilidade ${vis}`;
}

function decodeClouds(metar: ParsedMetar): string {
  if (metar.clouds.length === 0) return 'Céu claro';

  return metar.clouds
    .map((c) => {
      const cover = CLOUD_COVER[c.cover] ?? c.cover;
      return `${cover} a ${c.base.toLocaleString('pt-BR')}ft`;
    })
    .join(', ');
}

function decodePresentWeather(tokens: string[]): string {
  return tokens
    .map((token) => {
      let intensity = '';
      let rest = token;

      if (rest.startsWith('-') || rest.startsWith('+')) {
        intensity = INTENSITY[rest[0]!] ?? '';
        rest = rest.slice(1);
      }

      const parts: string[] = [];

      // Try descriptor first (2 chars)
      for (const [code, label] of Object.entries(WEATHER_DESCRIPTORS)) {
        if (rest.startsWith(code)) {
          parts.push(label);
          rest = rest.slice(code.length);
          break;
        }
      }

      // Remaining phenomena (each 2 chars)
      while (rest.length >= 2) {
        const code = rest.slice(0, 2);
        const label = WEATHER_PHENOMENA[code];
        if (label) {
          parts.push(label);
        }
        rest = rest.slice(2);
      }

      const description = parts.join(' ');
      return intensity ? `${description} ${intensity}` : description;
    })
    .join(', ');
}

export function decodeMetarToPtBr(metar: ParsedMetar): string {
  const parts: string[] = [];

  const wind = decodeWind(metar);
  if (wind) parts.push(wind);

  const vis = decodeVisibility(metar.visibility);
  if (vis) parts.push(vis);

  if (metar.presentWeather && metar.presentWeather.length > 0) {
    const wx = decodePresentWeather(metar.presentWeather);
    if (wx) parts.push(wx.charAt(0).toUpperCase() + wx.slice(1));
  }

  parts.push(decodeClouds(metar));

  if (metar.temperature != null) {
    let temp = `Temperatura ${metar.temperature}°C`;
    if (metar.dewpoint != null) {
      temp += `, ponto de orvalho ${metar.dewpoint}°C`;
    }
    parts.push(temp);
  }

  if (metar.altimeter != null) {
    parts.push(`QNH ${metar.altimeter}hPa`);
  }

  if (metar.flightCategory) {
    const label = FLIGHT_CATEGORY_LABEL[metar.flightCategory] ?? metar.flightCategory;
    parts.push(`Condição ${label}`);
  }

  if (metar.remarks?.windshear) {
    parts.push(`Windshear reportado: ${metar.remarks.windshear}`);
  }

  return parts.join('. ') + '.';
}
