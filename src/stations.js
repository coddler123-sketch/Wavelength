const fs = require('fs');
const path = require('path');
const dns = require('dns');
const util = require('util');
const { app } = require('electron');

const resolveSrv = util.promisify(dns.resolveSrv);

const CACHE_FILE = path.join(app.getPath('userData'), 'stations-cache.json');
const CACHE_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

const STATIONS_FILE = path.join(__dirname, '..', 'assets', 'stations.json');
const DEFAULT_STATIONS = JSON.parse(fs.readFileSync(STATIONS_FILE, 'utf8'));

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

function mapStation(dto) {
  let genre = 'Radio';
  if (dto.tags && typeof dto.tags === 'string') {
    const parsedTags = dto.tags.split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0 && t.length < 20);
    if (parsedTags.length > 0) {
      const first = parsedTags[0];
      genre = first.charAt(0).toUpperCase() + first.slice(1);
    }
  }

  let language = 'German';
  if (dto.language && typeof dto.language === 'string') {
    const langs = dto.language.split(',')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    if (langs.length > 0) {
      const first = langs[0];
      language = first.charAt(0).toUpperCase() + first.slice(1);
    }
  }

  return {
    id: dto.stationuuid,
    name: (dto.name || '').trim(),
    streamUrl: dto.url_resolved || dto.url,
    iconUrl: dto.favicon || '',
    genre: genre,
    country: (dto.countrycode || 'DE').toUpperCase(),
    website: dto.homepage || '',
    language: language
  };
}

async function fetchFromRadioBrowser() {
  const mirrors = await getMirrors();
  for (const mirror of mirrors) {
    try {
      const url = `${mirror}/json/stations/search?countrycode=DE&hidebroken=true&order=votes&reverse=true&limit=100`;
      console.log(`[stations] Fetching stations from mirror: ${mirror}`);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'WavelengthRadioPlayer/1.0.0 (Windows Electron App)'
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
      
      console.log(`[stations] Successfully loaded ${data.length} stations from Radio Browser.`);
      return data;
    } catch (err) {
      console.warn(`[stations] Failed to fetch from mirror ${mirror}: ${err.message}`);
    }
  }
  throw new Error("All mirrors failed");
}

const HIGH_RES_ICONS = {
  'deutschlandfunk kultur': 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Deutschlandfunk_Kultur_Logo_2017.svg',
  'deutschlandfunk nova': 'https://upload.wikimedia.org/wikipedia/commons/b/bd/Deutschlandfunk_Nova_Logo_2017.svg',
  'deutschlandfunk': 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Deutschlandfunk_Logo_2017.svg',
  'ndr info': 'https://upload.wikimedia.org/wikipedia/commons/e/ec/NDR_Info_logo_2021.svg',
  'wdr 5': 'https://upload.wikimedia.org/wikipedia/commons/b/b3/WDR_5_logo.svg',
  'inforadio': 'https://upload.wikimedia.org/wikipedia/commons/4/46/Rbb24_Inforadio_logo_2021.svg',
  'bayern 1': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d4/Bayern_1_Logo.svg/200px-Bayern_1_Logo.svg.png',
  'bayern 3': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1a/Bayern_3_Logo.svg/200px-Bayern_3_Logo.svg.png',
  'swr3': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/SWR3_logo_2020.svg/200px-SWR3_logo_2020.svg.png',
  '1live': 'https://upload.wikimedia.org/wikipedia/commons/f/fb/WDR_1LIVE_Logo_2016.svg',
  'n-joy': 'https://upload.wikimedia.org/wikipedia/commons/3/35/Njoy-logo.svg',
  'wdr 2': 'https://upload.wikimedia.org/wikipedia/commons/2/23/WDR_2_logo.svg',
  'ndr 2': 'https://upload.wikimedia.org/wikipedia/commons/9/9e/NDR_2_Logo.svg',
  'hr3': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Hr3_Logo_2015.svg/200px-Hr3_Logo_2015.svg.png',
  'jump': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/07/MDR_Jump_logo_2011.svg/200px-MDR_Jump_logo_2011.svg.png',
  'radioeins': 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Radioeins_logo_2021.svg/200px-Radioeins_logo_2021.svg.png',
  'fritz': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5f/Fritz_Logo_2021.svg/200px-Fritz_Logo_2021.svg.png',
  'antenne bayern': 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Antenne_Bayern_logo_2020.svg/200px-Antenne_Bayern_logo_2020.svg.png',
  'radio nrw': 'https://upload.wikimedia.org/wikipedia/de/thumb/8/87/Radio_NRW_logo.svg/200px-Radio_NRW_logo.svg.png',
  'radio hamburg': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c9/RadioHH_Logo2021.svg/300px-RadioHH_Logo2021.svg.png',
  '104.6 rtl': 'https://upload.wikimedia.org/wikipedia/de/thumb/a/a2/104.6_RTL_Logo.svg/200px-104.6_RTL_Logo.svg.png',
  'energy': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/14/NRJ_Logo.svg/200px-NRJ_Logo.svg.png',
  'bigfm': 'https://upload.wikimedia.org/wikipedia/de/thumb/b/b8/BigFM_Logo.svg/200px-BigFM_Logo.svg.png',
  'klassik radio': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8b/Klassik_Radio_logo.svg/200px-Klassik_Radio_logo.svg.png',
  'rock antenne': 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Rock_Antenne_logo.svg/200px-Rock_Antenne_logo.svg.png',
  'bob': 'https://upload.wikimedia.org/wikipedia/de/thumb/8/87/Radio_BOB%21_logo.svg/200px-Radio_BOB%21_logo.svg.png',
  'sunshine': 'https://upload.wikimedia.org/wikipedia/commons/0/00/Sunshine_live_Logo_2022.svg',
  'schlager radio': 'https://upload.wikimedia.org/wikipedia/de/thumb/8/8a/Schlager_Radio_logo.svg/200px-Schlager_Radio_logo.svg.png',
  'schlagerwelt': 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/52/MDR_Schlagerwelt_logo.svg/200px-MDR_Schlagerwelt_logo.svg.png',
  'cosmo': 'https://upload.wikimedia.org/wikipedia/commons/thumb/6/68/Cosmo_WDR_logo_2016.svg/200px-Cosmo_WDR_logo_2016.svg.png',
  'lofi girl': 'https://lofigirl.com/wp-content/uploads/2023/02/lofi-girl-logo.png',
  '80s80s': 'https://upload.wikimedia.org/wikipedia/commons/a/ad/80s80s_Logo_2015.svg',
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

function mergeStations(curated, apiStations) {
  const merged = [...curated];
  const curatedNames = new Set(curated.map(s => s.name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  const curatedStreams = new Set(curated.map(s => s.streamUrl.toLowerCase()));

  for (const s of apiStations) {
    const normName = s.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const normStream = s.streamUrl.toLowerCase();
    
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
  return merged.map(enrichStationIcon);
}

module.exports = {
  loadStations,
  DEFAULT_STATIONS,
  mapStation,
  mergeStations,
};
