export const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];

export function shouldScheduleReconnect(reconnectTimer, playing) {
  return !reconnectTimer && !!playing;
}

export function reconnectDelayForAttempt(attempt) {
  const index = Math.max(0, Math.min(Number(attempt) || 0, RECONNECT_DELAYS.length - 1));
  return RECONNECT_DELAYS[index];
}

export function nextReconnectAttempt(attempt) {
  return (Number(attempt) || 0) + 1;
}
