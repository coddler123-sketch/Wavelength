const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Require stations from src/stations.js
// Mock electron since app.getPath is called on require of stations.js
const electronMock = {
  app: {
    getPath: () => __dirname
  }
};
require.cache[require.resolve('electron')] = { exports: electronMock };

const { DEFAULT_STATIONS } = require('../src/stations.js');

const seedFile = path.join(__dirname, 'stations-seed.json');

try {
  console.log('Writing temporary seed file...');
  fs.writeFileSync(seedFile, JSON.stringify(DEFAULT_STATIONS, null, 2), 'utf8');

  console.log('Uploading stations to Firebase...');
  execSync('firebase.cmd database:set /stations scripts/stations-seed.json -f', { stdio: 'inherit' });
  console.log('Successfully seeded Firebase database!');
} catch (error) {
  console.error('Error seeding database:', error.message);
  process.exit(1);
} finally {
  if (fs.existsSync(seedFile)) {
    fs.unlinkSync(seedFile);
  }
}
