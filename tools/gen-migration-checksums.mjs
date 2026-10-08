#!/usr/bin/env node
// Regenerates src/main/db/migrations/checksums.json from the LF-normalized migration files.
// Only run this before a phase is accepted; accepted migrations are frozen by their checksum.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('src/main/db/migrations');
const out = {};
for (const file of fs.readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()) {
  const version = Number(file.slice(0, 3));
  const text = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  out[version] = crypto.createHash('sha256').update(text).digest('hex');
}
fs.writeFileSync(path.join(dir, 'checksums.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out));
