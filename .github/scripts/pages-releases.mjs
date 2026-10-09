/* global process, console, fetch */
// Writes <out>/releases.json for the website: for each download, the newest published (non-draft)
// release that carries it, with its version, size and checksum file.
// Usage: node .github/scripts/pages-releases.mjs <out-dir>
// Env: GITHUB_REPOSITORY (owner/name, default emashiq/infinitynote), GITHUB_TOKEN (optional; avoids
// the anonymous API rate limit).
import fs from 'node:fs';
import path from 'node:path';

const repo = process.env.GITHUB_REPOSITORY || 'emashiq/infinitynote';
const outDir = process.argv[2] || 'website';

// The stable asset names from .github/workflows/release.yml. Keep in sync with MATCHERS in website/app.js.
const MATCHERS = {
  windowsSetup: /^Infinity-Notes-Setup-x64\.exe$/,
  deb: /^infinity-notes_amd64\.deb$/,
  appImage: /^Infinity-Notes-x86_64\.AppImage$/,
};

const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=50`, { headers });
if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`);
const releases = (await res.json()).filter((r) => !r.draft);

const assets = {};
for (const release of releases) {
  const sums = release.assets.find((a) => a.name === 'SHA256SUMS.txt');
  for (const asset of release.assets) {
    for (const [key, pattern] of Object.entries(MATCHERS)) {
      if (assets[key] || !pattern.test(asset.name)) continue;
      assets[key] = {
        name: asset.name,
        url: asset.browser_download_url,
        size: asset.size,
        tag: release.tag_name,
        prerelease: release.prerelease,
        published: release.published_at,
        page: release.html_url,
        checksums: sums ? sums.browser_download_url : null,
      };
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'releases.json'),
  JSON.stringify({ repo, generated: new Date().toISOString(), assets }, null, 2) + '\n',
);
for (const key of Object.keys(MATCHERS)) {
  console.log(`${key.padEnd(13)} ${assets[key] ? `${assets[key].tag}  ${assets[key].name}` : '(none)'}`);
}
