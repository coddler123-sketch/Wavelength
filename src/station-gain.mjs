export const STATION_GAIN_MIN_DB = -9;
export const STATION_GAIN_MAX_DB = 9;
export const STATION_GAIN_STEP_DB = 1;

export function stationGainKey(id) {
  return `wl.stationGainDb_${id}`;
}

export function clampStationGainDb(db) {
  const value = Number(db);
  const finite = Number.isFinite(value) ? value : 0;
  return Math.max(STATION_GAIN_MIN_DB, Math.min(STATION_GAIN_MAX_DB, finite));
}

export function gainDbToLinear(db) {
  return Math.pow(10, clampStationGainDb(db) / 20);
}

export function stationGainLabel(db) {
  const clamped = clampStationGainDb(db);
  return clamped === 0 ? '0 dB' : `${clamped > 0 ? '+' : ''}${clamped} dB`;
}

export function nextStationGainDb(currentDb, deltaDb) {
  return clampStationGainDb(clampStationGainDb(currentDb) + Number(deltaDb || 0));
}
