const fs = require('fs');
const path = require('path');

const STATIONS_FILE = path.join(__dirname, '..', 'assets', 'stations.json');
const REQUIRED_FIELDS = ['id', 'name', 'streamUrl', 'genre', 'country', 'language'];
const OPTIONAL_URL_FIELDS = ['iconUrl', 'website'];
const RAW_LANGUAGE_LABELS = new Set(['german', 'english', 'french', 'spanish', 'italian', 'dutch']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateUrl(value, field, stationName, errors) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      errors.push(`${stationName}: ${field} must use http(s)`);
    }
  } catch (err) {
    void err;
    errors.push(`${stationName}: ${field} is not a valid URL`);
  }
}

function validateStations(stations) {
  const errors = [];
  const ids = new Set();
  const normalizedNames = new Set();
  const streamUrls = new Set();

  if (!Array.isArray(stations)) {
    return ['assets/stations.json must contain an array'];
  }

  if (stations.length < 10) {
    errors.push(`assets/stations.json should contain at least 10 stations, found ${stations.length}`);
  }

  stations.forEach((station, index) => {
    const label = isPlainObject(station) && station.name ? station.name : `station[${index}]`;
    if (!isPlainObject(station)) {
      errors.push(`station[${index}] must be an object`);
      return;
    }

    for (const field of REQUIRED_FIELDS) {
      if (typeof station[field] !== 'string' || station[field].trim() === '') {
        errors.push(`${label}: missing required string field "${field}"`);
      }
    }

    if (typeof station.id === 'string') {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(station.id)) {
        errors.push(`${label}: id must be lowercase kebab-case`);
      }
      if (ids.has(station.id)) {
        errors.push(`${label}: duplicate id "${station.id}"`);
      }
      ids.add(station.id);
    }

    if (typeof station.name === 'string') {
      const normalizedName = station.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (normalizedNames.has(normalizedName)) {
        errors.push(`${label}: duplicate normalized name "${station.name}"`);
      }
      normalizedNames.add(normalizedName);
    }

    if (typeof station.streamUrl === 'string') {
      validateUrl(station.streamUrl, 'streamUrl', label, errors);
      if (!station.streamUrl.startsWith('https://')) {
        errors.push(`${label}: streamUrl must use https://`);
      }
      const normalizedStream = station.streamUrl.toLowerCase();
      if (streamUrls.has(normalizedStream)) {
        errors.push(`${label}: duplicate streamUrl "${station.streamUrl}"`);
      }
      streamUrls.add(normalizedStream);
    }

    for (const field of OPTIONAL_URL_FIELDS) {
      if (station[field] !== undefined && typeof station[field] !== 'string') {
        errors.push(`${label}: optional field "${field}" must be a string when present`);
      } else {
        validateUrl(station[field], field, label, errors);
      }
    }

    if (typeof station.country === 'string' && station.country !== station.country.toUpperCase()) {
      errors.push(`${label}: country should be uppercase`);
    }

    if (typeof station.language === 'string' && RAW_LANGUAGE_LABELS.has(station.language.trim().toLowerCase())) {
      errors.push(`${label}: language should use localized label instead of "${station.language}"`);
    }
  });

  return errors;
}

function readStations(file = STATIONS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

if (require.main === module) {
  const errors = validateStations(readStations());
  if (errors.length > 0) {
    console.error(`stations validation failed (${errors.length}):`);
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log('stations validation ok');
}

module.exports = { validateStations, readStations };
