const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CUSTOM_FILE = path.join(app.getPath('userData'), 'custom-stations.json');

function load() {
  try {
    if (fs.existsSync(CUSTOM_FILE)) {
      const data = JSON.parse(fs.readFileSync(CUSTOM_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (_) {}
  return [];
}

function save(stations) {
  try {
    fs.mkdirSync(path.dirname(CUSTOM_FILE), { recursive: true });
    fs.writeFileSync(CUSTOM_FILE, JSON.stringify(stations, null, 2), 'utf8');
  } catch (err) {
    console.error('[custom-stations] Failed to save:', err.message);
  }
}

function add(data) {
  const stations = load();
  const station = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    name: String(data.name || '').trim(),
    streamUrl: String(data.streamUrl || '').trim(),
    genre: String(data.genre || '').trim() || 'Eigene',
    iconUrl: String(data.iconUrl || '').trim(),
    language: 'Deutsch',
    country: 'DE',
    isCustom: true,
  };
  stations.push(station);
  save(stations);
  return stations;
}

function update(id, data) {
  const stations = load();
  const idx = stations.findIndex((s) => s.id === id);
  if (idx === -1) return stations;
  stations[idx] = {
    ...stations[idx],
    name: String(data.name || '').trim() || stations[idx].name,
    streamUrl: String(data.streamUrl || '').trim() || stations[idx].streamUrl,
    genre: String(data.genre != null ? data.genre : stations[idx].genre).trim() || 'Eigene',
    iconUrl: String(data.iconUrl != null ? data.iconUrl : stations[idx].iconUrl).trim(),
  };
  save(stations);
  return stations;
}

function remove(id) {
  const stations = load().filter((s) => s.id !== id);
  save(stations);
  return stations;
}

module.exports = { load, add, update, remove };
