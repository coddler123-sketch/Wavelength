// Weekly station health check: verifies every curated stream URL responds.
// Usage: node scripts/check-streams.js
const fs = require('fs');
const path = require('path');

const TIMEOUT_MS = 15_000;

async function checkStream(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'Icy-MetaData': '0', 'User-Agent': 'Wavelength-HealthCheck' },
    });
    if (!res.ok) return `HTTP ${res.status}`;
    // Read a first chunk to confirm actual audio data flows.
    const reader = res.body.getReader();
    const { value } = await reader.read();
    reader.cancel().catch(() => {});
    if (!value || value.length === 0) return 'empty body';
    return null;
  } catch (err) {
    return err.name === 'AbortError' ? 'timeout' : err.message;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const file = path.join(__dirname, '..', 'assets', 'stations.json');
  const stations = JSON.parse(fs.readFileSync(file, 'utf8'));
  const failures = [];
  for (const s of stations) {
    const error = await checkStream(s.streamUrl);
    if (error) {
      failures.push({ name: s.name, url: s.streamUrl, error });
      console.error(`FAIL  ${s.name}: ${error} (${s.streamUrl})`);
    } else {
      console.log(`ok    ${s.name}`);
    }
  }
  console.log(`\n${stations.length - failures.length}/${stations.length} streams reachable`);
  if (failures.length > 0) process.exit(1);
}

main();
