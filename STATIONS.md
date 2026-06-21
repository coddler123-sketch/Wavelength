# Station Maintenance

Curated defaults live in `assets/stations.json`. They are bundled with the app, loaded first, and then merged with Radio Browser results and the local disk cache.

## Update Workflow

1. Edit `assets/stations.json`.
2. Keep each station object in this shape:

```json
{
  "id": "lowercase-kebab-id",
  "name": "Station Name",
  "streamUrl": "https://example.com/live.mp3",
  "iconUrl": "https://example.com/logo.svg",
  "genre": "Pop",
  "country": "DE",
  "website": "https://example.com",
  "language": "German"
}
```

3. Run:

```bash
npm run stations:check
npm test
```

4. Start the app and manually play any changed station.

## Rules

- `id` must be stable, lowercase kebab-case, and unique.
- `streamUrl` must use `https://`.
- Avoid duplicate station names and duplicate stream URLs.
- Prefer official stream URLs and official station websites.
- Keep curated genre labels user-facing and German where practical, for example `Nachrichten`, `Wissen / Pop`, or `Elektronik`.
- `iconUrl` and `website` may be empty strings, but when present they must be valid `http(s)` URLs.
- Radio Browser stations use their `favicon` first; if it is missing, Wavelength falls back to `<homepage>/favicon.ico`.
- Keep curated stations focused; broad discovery belongs to Radio Browser fallback.
