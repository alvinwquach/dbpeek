import { rm, mkdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = resolve(ROOT, 'dist');
const SITE_DIST = resolve(ROOT, 'site', 'dist');
const DOCS_DIST = resolve(ROOT, 'docs', 'dist');

async function main() {
  if (!existsSync(SITE_DIST)) {
    throw new Error(`site/dist not found at ${SITE_DIST} — run "pnpm build:site" first`);
  }
  if (!existsSync(DOCS_DIST)) {
    throw new Error(`docs/dist not found at ${DOCS_DIST} — run "pnpm build:docs" first`);
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  console.log('→ Copying site/dist → dist/');
  await cp(SITE_DIST, DIST, { recursive: true });

  console.log('→ Copying docs/dist → dist/docs/');
  await cp(DOCS_DIST, resolve(DIST, 'docs'), { recursive: true });

  console.log('✓ Merged web builds at dist/');
}

main().catch((err) => {
  console.error('✗ Merge failed:', err);
  process.exit(1);
});
