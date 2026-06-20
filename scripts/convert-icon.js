const fs = require('fs');
const path = require('path');

const srcPng = process.argv[2];
if (!srcPng) {
  console.error("Please provide the path to the source PNG file.");
  process.exit(1);
}

const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

const destPng = path.join(assetsDir, 'icon.png');
const destIco = path.join(assetsDir, 'icon.ico');

// Copy PNG
fs.copyFileSync(srcPng, destPng);
console.log(`Copied PNG to ${destPng}`);

// Convert PNG to ICO
const pngBuffer = fs.readFileSync(destPng);
const pngSize = pngBuffer.length;

const icoHeader = Buffer.alloc(22);
// Header
icoHeader.writeUInt16LE(0, 0);      // Reserved
icoHeader.writeUInt16LE(1, 2);      // Type (1 for icon)
icoHeader.writeUInt16LE(1, 4);      // Image count (1)

// Directory Entry
icoHeader.writeUInt8(0, 6);         // Width (0 means 256)
icoHeader.writeUInt8(0, 7);         // Height (0 means 256)
icoHeader.writeUInt8(0, 8);         // Color count (0)
icoHeader.writeUInt8(0, 9);         // Reserved
icoHeader.writeUInt16LE(1, 10);     // Planes
icoHeader.writeUInt16LE(32, 12);    // Bits per pixel
icoHeader.writeUInt32LE(pngSize, 14); // Size of PNG data
icoHeader.writeUInt32LE(22, 18);     // Offset of PNG data

const icoBuffer = Buffer.concat([icoHeader, pngBuffer]);
fs.writeFileSync(destIco, icoBuffer);
console.log(`Created ICO file at ${destIco}`);
