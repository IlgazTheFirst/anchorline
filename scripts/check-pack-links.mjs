// Checks that every source URL in the destination packs resolves.
// Usage: node scripts/check-pack-links.mjs   (needs network; not run in CI)
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../src/catalogue/packs/', import.meta.url);
const urls = new Set();
const walk = (value) => {
  if (Array.isArray(value)) value.forEach(walk);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (k === 'sourceUrls' && Array.isArray(v)) v.forEach((u) => urls.add(u));
      else walk(v);
    }
  }
};
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) walk(JSON.parse(readFileSync(new URL(file, dir), 'utf8')));

let failed = 0;
for (const url of [...urls].sort()) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'anchorline-linkcheck/0.1' } });
    if (!res.ok) {
      failed++;
      console.log(`${res.status} ${url}`);
    }
  } catch (err) {
    failed++;
    console.log(`ERR ${url} ${err.message}`);
  }
}
console.log(`${urls.size} source links checked, ${failed} failed.`);
process.exit(failed ? 1 : 0);
