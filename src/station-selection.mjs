export function shouldSuppressMainAutoplay(startWhenStopped, wasPlaying) {
  return !startWhenStopped && !wasPlaying;
}

export function shouldRestartPlayback(wasPlaying) {
  return !!wasPlaying;
}
