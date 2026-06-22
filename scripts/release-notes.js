const fs = require('fs');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const version = pkg.version;

const changelog = fs.readFileSync(path.join(__dirname, '..', 'CHANGELOG.md'), 'utf8');
const lines = changelog.split(/\r?\n/);

const startIndex = lines.findIndex(line => line.trim() === `## ${version}`);
if (startIndex === -1) {
  console.error(`No CHANGELOG.md entry for v${version}`);
  process.exit(1);
}

const endIndex = lines.slice(startIndex + 1).findIndex(line => /^## /.test(line));
const notes = lines
  .slice(startIndex + 1, endIndex === -1 ? lines.length : startIndex + 1 + endIndex)
  .join('\n')
  .trim();

if (process.argv[2] === '--gh-release') {
  const { execSync } = require('child_process');
  const tag = `v${version}`;
  const installer = path.join('dist', `Wavelength Setup ${version}.exe`);
  const portable = path.join('dist', `Wavelength-${version}-portable.exe`);
  const assets = [installer, portable].filter(p => fs.existsSync(p));
  if (assets.length === 0) {
    console.error(`No build artifacts found in dist/. Run "npm run build" first.`);
    process.exit(1);
  }
  const cmd = ['gh', 'release', 'create', tag, '--title', `Wavelength ${tag}`, '--notes', notes, ...assets];
  execSync(cmd.map(a => `"${a.replace(/"/g, '\\"')}"`).join(' '), { stdio: 'inherit' });
  console.log(`Created GitHub release ${tag}`);
} else {
  process.stdout.write(notes + '\n');
}
