/**
 * tsc does not emit the .sql migration files, and DatabaseConnection resolves
 * them relative to the compiled output. Copying them here keeps dist/ complete
 * for every consumer that packages it (Client and the CLI tarball).
 */
const fs = require('fs');
const path = require('path');

const APP_DIR = path.resolve(__dirname, '..');
const SRC = path.join(APP_DIR, 'src', 'infrastructure', 'database', 'migrations');
const DEST = path.join(APP_DIR, 'dist', 'infrastructure', 'database', 'migrations');

if (!fs.existsSync(SRC)) {
  console.error(`[copy-migrations] Missing source directory: ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(DEST, { recursive: true });

const files = fs.readdirSync(SRC).filter((file) => file.endsWith('.sql'));
for (const file of files) {
  fs.copyFileSync(path.join(SRC, file), path.join(DEST, file));
}

console.log(`[copy-migrations] ${files.length} migration(s) copied to dist`);
