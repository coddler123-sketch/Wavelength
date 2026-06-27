const fs = require('fs');
const path = require('path');
const dns = require('dns');
const util = require('util');
const { app } = require('electron');

const resolveSrv = util.promisify(dns.resolveSrv);

const CACHE_FILE = path.join(app.getPath('userData'), 'stations-cache.json');
const CACHE_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

const STATIONS_FILE = path.join(__dirname, '..', 'assets', 'stations.json');
const APP_VERSION = app.getVersion();
const APP_USER_AGENT = `WavelengthRadioPlayer/${APP_VERSION} (Windows Electron App)`;
const DEFAULT_STATIONS = JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8')).map(normalizeStationLanguage);

function debugStations(message) {
  if (process.env.WAVELENGTH_DEBUG_STATIONS === '1') {
    process.stdout.write(`${message}\n`);
  }
}

const FALLBACK_MIRRORS = [
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
  'https://fr1.api.radio-browser.info'
];


function getCached() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (data && Number.isFinite(data.timestamp) && Array.isArray(data.stations)) {
        return data;
      }
    }
  } catch (err) {
    console.error("Failed to read stations cache:", err.message);
  }
  return null;
}

function setCache(stations) {
  try {
    const data = {
      timestamp: Date.now(),
      stations
    };
    fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error("Failed to write stations cache:", err.message);
  }
}

async function getMirrors() {
  try {
    const srvRecords = await resolveSrv('_api._tcp.radio-browser.info');
    if (srvRecords && srvRecords.length > 0) {
      const urls = srvRecords.map(record => `https://${record.name}`);
      return urls.sort(() => Math.random() - 0.5);
    }
  } catch (err) {
    console.error("DNS SRV resolution failed, using fallback mirrors:", err.message);
  }
  return [...FALLBACK_MIRRORS].sort(() => Math.random() - 0.5);
}

function homepageFavicon(homepage) {
  if (!homepage || typeof homepage !== 'string') return '';
  try {
    const url = new URL(homepage);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}/favicon.ico`;
  } catch (err) {
    void err;
    return '';
  }
}

function normalizeGenreTag(tag) {
  return String(tag || '').trim().replace(/^#+/, '').toLowerCase();
}

function localizeGenreLabel(tag) {
  const normalized = normalizeGenreTag(tag);
  const labels = {
    '60s': '60er',
    '1960s': '60er',
    '70s': '70er',
    '1970s': '70er',
    '80s': '80er',
    '1980s': '80er',
    '90s': '90er',
    '1990s': '90er',
    '00er': '2000er',
    '00s': '2000er',
    '2000er': '2000er',
    '2000s': '2000er',
    ard: 'Nachrichten',
    'public radio': 'Nachrichten',
    'cultural news': 'Kultur / Nachrichten',
    music: 'Mix',
    news: 'Nachrichten',
    nachrichten: 'Nachrichten',
    culture: 'Kultur',
    kultur: 'Kultur',
    knowledge: 'Wissen',
    wissen: 'Wissen',
    science: 'Wissen',
    information: 'Nachrichten',
    electronic: 'Elektronik',
    electro: 'Elektronik',
    edm: 'Elektronik',
    trance: 'Trance',
    ambient: 'Ambient',
    chill: 'Chillout',
    chillout: 'Chillout',
    'chillout+lounge': 'Chillout / Lounge',
    'chillout / lounge': 'Chillout / Lounge',
    lounge: 'Lounge',
    lofi: 'Lofi',
    relax: 'Relax',
    'easy listening': 'Leichte Musik',
    'leichte musik': 'Leichte Musik',
    country: 'Country',
    global: 'Weltmusik',
    multicultural: 'Weltmusik',
    'world music': 'Weltmusik',
    hiphop: 'Hip-Hop',
    'hip-hop': 'Hip-Hop',
    rap: 'Hip-Hop',
    acid: 'Acid Jazz',
    'acid jazz': 'Acid Jazz',
    variety: 'Mix',
    pop: 'Pop',
    rock: 'Rock',
    'rock klassiker': 'Rock Klassiker',
    talk: 'Talk',
    charts: 'Charts',
    oldies: 'Oldies',
    instrumental: 'Instrumental',
    classic: 'Klassik',
    'classic rock': 'Rock Klassiker',
    classics: 'Klassik',
    classical: 'Klassik',
    local: 'Lokal',
    young: 'Jugend',
    urban: 'Hip-Hop',
  };
  if (labels[normalized]) return labels[normalized];
  if (normalized.includes(' / ')) {
    return normalized
      .split(/\s*\/\s*/)
      .map(part => localizeGenreLabel(part))
      .filter(Boolean)
      .filter((part, index, all) => all.indexOf(part) === index)
      .join(' / ');
  }
  return labels[normalized] || (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : '');
}

function genreTagPriority(tag) {
  const t = normalizeGenreTag(tag);
  if (!t || ['radio', 'music', 'ard', 'live', 'non-stop', 'berlin', 'bayerischer rundfunk'].includes(t)) return 0;
  if (t.includes('culture') || t.includes('kultur') || t.includes('knowledge') || t.includes('science') || t.includes('wissen')) return 100;
  if (t.includes('news') || t.includes('information') || t.includes('talk') || t.includes('public radio')) return 100;
  if (t.includes('hiphop') || t.includes('hip hop') || t.includes('hip-hop') || t.includes('rap') || t.includes('r&b') || t.includes('urban')) return 95;
  if (t.includes('electro') || t.includes('edm') || t.includes('techno') || t.includes('trance') || t.includes('house') || t.includes('dance') || t.includes('club')) return 90;
  if (t.includes('ambient') || t.includes('chill') || t.includes('lounge') || t.includes('lofi') || t.includes('relax') || t.includes('easy listening')) return 85;
  if (t.includes('schlager') || t.includes('country') || t.includes('world') || t.includes('global') || t.includes('multicultural')) return 80;
  if (t.includes('jazz') || t.includes('classic') || t.includes('klassik') || t === 'acid') return 75;
  if (/\b(50s|60s|70s|80s|90s|00s|10s|1950s|1960s|1970s|1980s|1990s|2000s|2010s|50er|60er|70er|80er|90er|2000er|2010er)\b/.test(t) || t.includes('oldies') || t.includes('retro')) return 70;
  if (t.includes('rock') || t.includes('metal') || t.includes('alternative') || t.includes('indie')) return 78;
  if (t.includes('pop') || t.includes('charts') || t.includes('hits') || t.includes('top40') || t.includes('top 40') || t.includes('variety')) return 65;
  if (t.includes('instrumental')) return 55;
  return 10;
}

function pickGenreTag(tags) {
  return [...tags].sort((a, b) => genreTagPriority(b) - genreTagPriority(a))[0] || '';
}

function inferGenreFromName(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('schlager')) return 'Schlager';
  if (n.includes('berliner rundfunk')) return 'Pop';
  if (n.includes('swr1') || n.includes('wdr4')) return 'Oldies';
  if (n.includes('hiphop') || n.includes('hip hop') || n.includes('rap')) return 'Hip-Hop';
  if (n.includes('trance') || n.includes('techno') || n.includes('club')) return 'Elektronik';
  if (n.includes('country')) return 'Country';
  if (n.includes('jazz')) return 'Jazz';
  return '';
}

function localizeLanguageLabel(language, country = '', name = '', website = '', streamUrl = '') {
  const raw = String(language || '').trim();
  const countryCode = String(country || '').trim().toUpperCase();
  const values = raw.split(',')
    .map(l => l.trim().toLowerCase())
    .filter(Boolean);

  if (countryCode === 'DE' && (values.length === 0 || values.includes('german') || values.includes('deutsch') || values.includes('de'))) {
    return 'Deutsch';
  }

  const stationText = `${name} ${website} ${streamUrl}`.toLowerCase();
  if (countryCode === 'DE' && values.length === 1 && values[0] === 'english') {
    return 'Deutsch';
  }
  if (stationText.includes('90s90s') || stationText.includes('rautemusik') || stationText.includes('rm.fm')) {
    return 'Deutsch';
  }

  const labels = {
    german: 'Deutsch',
    deutsch: 'Deutsch',
    de: 'Deutsch',
    english: 'Englisch',
    englisch: 'Englisch',
    en: 'Englisch',
    french: 'Französisch',
    francais: 'Französisch',
    français: 'Französisch',
    fr: 'Französisch',
    spanish: 'Spanisch',
    espanol: 'Spanisch',
    español: 'Spanisch',
    es: 'Spanisch',
    italian: 'Italienisch',
    it: 'Italienisch',
    dutch: 'Niederländisch',
    nl: 'Niederländisch',
    instrumental: 'Instrumental',
  };

  const first = values[0] || raw.toLowerCase();
  return labels[first] || (raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Deutsch');
}

function normalizeStationLanguage(station) {
  return {
    ...station,
    language: localizeLanguageLabel(station.language, station.country, station.name, station.website, station.streamUrl)
  };
}

function normalizeStationGenre(station) {
  const normalizedGenre = localizeGenreLabel(station.genre);
  const inferredGenre = inferGenreFromName(station.name);
  const weakGenres = new Set(['', 'Radio', 'Music', 'Ard', 'Berlin', 'Local']);
  return {
    ...station,
    genre: inferredGenre && weakGenres.has(normalizedGenre)
      ? inferredGenre
      : (normalizedGenre || inferredGenre || 'Radio')
  };
}

function mapStation(dto) {
  let genre = inferGenreFromName(dto.name) || 'Radio';
  if (dto.tags && typeof dto.tags === 'string') {
    const parsedTags = dto.tags.split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length < 20);
    if (parsedTags.length > 0) {
      genre = localizeGenreLabel(pickGenreTag(parsedTags)) || genre;
    }
  }

  return normalizeStationGenre({
    id: dto.stationuuid,
    name: (dto.name || '').trim(),
    streamUrl: dto.url_resolved || dto.url,
    iconUrl: dto.favicon || homepageFavicon(dto.homepage),
    genre: genre,
    country: (dto.countrycode || 'DE').toUpperCase(),
    website: dto.homepage || '',
    language: localizeLanguageLabel(dto.language, dto.countrycode || 'DE', dto.name, dto.homepage, dto.url_resolved || dto.url)
  });
}

async function fetchFromRadioBrowser() {
  const mirrors = await getMirrors();
  for (const mirror of mirrors) {
    try {
      const url = `${mirror}/json/stations/search?countrycode=DE&hidebroken=true&order=votes&reverse=true&limit=100`;
      debugStations(`[stations] Fetching stations from mirror: ${mirror}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': APP_USER_AGENT
        },
        signal: AbortSignal.timeout(5000)
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      if (!Array.isArray(data)) {
        throw new Error("Invalid response format");
      }
      
      debugStations(`[stations] Successfully loaded ${data.length} stations from Radio Browser.`);
      return data;
    } catch (err) {
      debugStations(`[stations] Failed to fetch from mirror ${mirror}: ${err.message}`);
    }
  }
  throw new Error("All mirrors failed");
}

const HIGH_RES_ICONS = {
  'deutschlandfunk kultur': 'https://www.deutschlandfunkkultur.de/static/img/deutschlandfunk_kultur/icons/apple-touch-icon-128x128.png',
  'deutschlandfunk nova': 'https://www.deutschlandfunknova.de/apple-touch-icon.png',
  'deutschlandfunk': 'https://www.deutschlandfunk.de/static/img/deutschlandfunk/icons/apple-touch-icon-128x128.png',
  'ndr info': 'https://images.ndr.de/image/e03539c6-eebc-482a-911f-4b4d115c1c7d/AAABnoyc4w4/AAABnSSvrFg/16x9-big/logoinfotv100.webp?width=1920',
  'wdr 5': 'https://www1.wdr.de/resources/img/wdr/logo/epgmodule/wdr5_logo_claim.svg',
  'inforadio': 'https://www.inforadio.de/favicon.ico',
  'bayern 1': 'https://api.ardmediathek.de/image-service/images/urn:ard:image:b366004f6196d70c?w=512',
  'bayern 3': 'https://api.ardmediathek.de/image-service/images/urn:ard:image:52fd25fc45de7c6a?w=512',
  'swr3': 'https://www.swr3.de/assets/swr3/icons/apple-touch-icon.png',
  '1live diggi': 'https://www1.wdr.de/radio/1live-diggi/resources-v5.176.1/img/favicon/apple-touch-icon.png',
  '1live': 'https://www1.wdr.de/radio/1live/resources/img/favicon/apple-touch-icon.png',
  'n-joy': 'https://www.phonostar.de/images/auto_created/NJOY3184x184.png',
  'wdr 2': 'https://www1.wdr.de/resources-v5.176.1/img/favicon/apple-touch-icon.png',
  'ndr 2': 'https://www.phonostar.de/images/auto_created/NDR22184x184.png',
  'hr3': 'https://www.hr3.de/favicon.png',
  'jump': 'https://images.mdr.de/image/b9fe3a54-ad0c-4f20-8ac3-9dca0c95f705/AAABnXRUSRI/AAABnR8VW9w/original/logo-green-100.jpg',
  'radioeins': 'https://www.phonostar.de/images/auto_created/radioeins3184x184.png',
  'fritz': 'https://www.fritz.de/content/dam/rbb/rbb/logos/touch/fritz-128.png',
  'antenne bayern': 'https://www.antenne.de/logos/station-antenne-bayern/apple-touch-icon.png',
  'radio nrw': 'https://radionrw.de/apple-touch-icon.png',
  'radio hamburg': 'https://www.radiohamburg.de/assets/icons/apple-touch-icon.png',
  '104.6 rtl': 'https://www.104.6rtl.com/assets/icons/icon-152x152.png',
  'energy': 'https://www.energy.de/favicon.ico',
  'bigfm': 'https://cdn.bigfm.de/sites/all/themes/bigfm/favicon.ico',
  'klassik radio': 'https://www.klassikradio.de/apple-touch-icon.png',
  'rock antenne': 'https://www.rockantenne.de/logos/station-rock-antenne/apple-touch-icon.png',
  'bob': 'https://upload.radiobob.de/production/static/1781730030464/icons/icon_512.8WpccMNcjjc.png',
  'sunshine': 'https://upload.wikimedia.org/wikipedia/commons/0/00/Sunshine_live_Logo_2022.svg',
  'schlager radio': 'https://www.schlagerradio.de/wp-content/uploads/2021/03/schlagerradiologo_stickyy.png',
  'schlagerwelt': 'https://cdn.mdr.de/resources/global/img/mdrde/favicons/apple-icon-120x120.png',
  'cosmo': 'https://www1.wdr.de/radio/cosmo/resources/img/favicon/apple-touch-icon.png',
  'lofi girl': 'https://www.lofigirl.com/assets/images/favicon.png',
  '80s80s': 'https://images.80s80s.de/files/logo.png',
  '90s90s': 'https://upload.wikimedia.org/wikipedia/commons/1/16/90s90s_Logo_2017.svg'
};

function enrichStationIcon(station) {
  const nameLower = station.name.toLowerCase();
  for (const [key, iconUrl] of Object.entries(HIGH_RES_ICONS)) {
    if (nameLower.includes(key)) {
      station.iconUrl = iconUrl;
      break;
    }
  }
  return station;
}

function normalizeStationName(name) {
  const value = String(name || '').toLowerCase();
  const region = value.match(/\(([^)]*)\)/);
  const regionSuffix = region ? region[1].replace(/[^a-z0-9]+/g, '') : '';
  return value
    .toLowerCase()
    .split('|')[0]
    .replace(/\([^)]*\)/g, '')
    .replace(/\b(mp3|aac|opus|https?|stream|kbit|kbps|128k|192k|96k|64k|48k|24k)\b/g, '')
    .replace(/[^a-z0-9]+/g, '') + regionSuffix;
}

function normalizeStreamUrl(streamUrl) {
  try {
    const url = new URL(streamUrl);
    return `${url.hostname}${url.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch (err) {
    void err;
    return String(streamUrl || '').toLowerCase().replace(/[?#].*$/, '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function mergeStations(curated, apiStations) {
  const merged = [...curated];
  const curatedNames = new Set(curated.map(s => normalizeStationName(s.name)));
  const curatedStreams = new Set(curated.map(s => normalizeStreamUrl(s.streamUrl)));

  for (const s of apiStations) {
    const normName = normalizeStationName(s.name);
    const normStream = normalizeStreamUrl(s.streamUrl);
    
    // Check if it matches any of the curated stations by name or stream URL
    if (curatedNames.has(normName) || curatedStreams.has(normStream)) {
      continue;
    }
    
    merged.push(s);
  }
  return merged;
}

async function loadStations() {
  const cache = getCached();
  const now = Date.now();
  let apiStations = [];
  let fetchedNew = false;

  // Try to fetch from Radio Browser API if cache is stale or missing
  if (!cache || (now - cache.timestamp >= CACHE_DURATION_MS)) {
    try {
      const rawStations = await fetchFromRadioBrowser();
      if (rawStations && rawStations.length > 0) {
        const mapped = rawStations.map(mapStation).filter(s => s.name && s.streamUrl);
        if (mapped.length > 0) {
          apiStations = mapped;
          setCache(mapped);
          fetchedNew = true;
        }
      }
    } catch (err) {
      console.error("Failed to fetch stations from Radio Browser:", err.message);
    }
  }

  // If we didn't fetch new ones, try to use cache
  if (!fetchedNew && cache) {
    apiStations = cache.stations;
  }

  // Merge default stations with API/cached stations
  const merged = mergeStations(DEFAULT_STATIONS, apiStations);
  return merged.map(normalizeStationLanguage).map(normalizeStationGenre).map(enrichStationIcon);
}

module.exports = {
  loadStations,
  DEFAULT_STATIONS,
  mapStation,
  mergeStations,
  homepageFavicon,
  localizeGenreLabel,
  localizeLanguageLabel,
};
