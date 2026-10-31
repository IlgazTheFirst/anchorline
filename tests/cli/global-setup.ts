import { execFileSync } from 'node:child_process';

/** Builds the bundled CLI once, so tests exercise exactly what ships. */
export default function setup() {
  execFileSync(process.execPath, ['scripts/build-cli.mjs'], { stdio: 'inherit' });
}
