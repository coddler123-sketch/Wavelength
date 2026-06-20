// Build a multi-resolution Windows ICO from the Wavelength logo SVG.
// Generates sizes: 16, 24, 32, 48, 64, 128, 256 — required for proper
// rendering in Taskbar, Explorer (small/large/extra-large icons), and tray.

const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default;

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT_ICO = path.join(__dirname, '..', 'assets', 'icon.ico');
const OUT_PNG = path.join(__dirname, '..', 'assets', 'icon.png');

const SVG = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="256" y2="256" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#162028"/>
      <stop offset="58%" stop-color="#0b1117"/>
      <stop offset="100%" stop-color="#07090d"/>
    </linearGradient>
    <linearGradient id="wave" x1="36" y1="128" x2="220" y2="128" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ffbf69"/>
      <stop offset="46%" stop-color="#34d6d0"/>
      <stop offset="100%" stop-color="#4f7cff"/>
    </linearGradient>
    <radialGradient id="glow" cx="128" cy="128" r="110" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#34d6d0" stop-opacity="0.24"/>
      <stop offset="54%" stop-color="#ffbf69" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="256" height="256" rx="48" fill="url(#bg)"/>
  <rect width="256" height="256" rx="48" fill="url(#glow)"/>
  <path d="M36 128 C 36 128 54 56 78 56 C 102 56 114 200 138 200 C 162 200 174 80 198 80 C 222 80 228 128 228 128"
        stroke="url(#wave)" stroke-width="20" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
</svg>`);

async function buildPngs() {
  const buffers = [];
  for (const size of SIZES) {
    const buf = await sharp(SVG)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    buffers.push(buf);
    console.log(`  generated ${size}x${size} PNG (${buf.length} bytes)`);
  }
  // Save the largest as icon.png (used for Electron tray icon source)
  fs.writeFileSync(OUT_PNG, buffers[buffers.length - 1]);
  console.log(`wrote ${OUT_PNG}`);
  return buffers;
}

async function main() {
  console.log('Building Wavelength icon...');
  const pngs = await buildPngs();
  const ico = await pngToIco(pngs);
  fs.writeFileSync(OUT_ICO, ico);
  console.log(`wrote ${OUT_ICO} (${ico.length} bytes, ${SIZES.length} resolutions)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
