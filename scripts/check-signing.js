const fs = require('fs');

const required = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD'];
const missing = required.filter(name => !process.env[name]);

if (missing.length > 0) {
  console.error(`missing signing environment variables: ${missing.join(', ')}`);
  console.error('see SIGNING.md for the Windows code signing workflow');
  process.exit(1);
}

const certPath = process.env.WIN_CSC_LINK;
if (!/^https?:\/\//i.test(certPath) && !fs.existsSync(certPath)) {
  console.error(`WIN_CSC_LINK does not point to an existing file: ${certPath}`);
  process.exit(1);
}

console.log('signing environment ok');
