// Runs every scripts/test-*.ts: each is bundled with rolldown (already a Vite dependency, so no
// extra test framework) into a temp folder and executed with node. Extra arguments are passed on,
// e.g. `npm test -- --update-golden`.
import { readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { build } from 'rolldown';

const scripts = readdirSync('scripts').filter((f) => /^test-.*\.ts$/.test(f)).sort();
const out = mkdtempSync(join(tmpdir(), 'koban-tests-'));
let failed = 0;
try {
  for (const file of scripts) {
    const outFile = join(out, file.replace(/\.ts$/, '.mjs'));
    await build({
      input: join('scripts', file),
      platform: 'node',
      logLevel: 'silent',
      output: { file: outFile, format: 'esm' },
    });
    process.stdout.write(`\n▶ ${file}\n`);
    const res = spawnSync(process.execPath, [outFile, ...process.argv.slice(2)], { stdio: 'inherit' });
    if (res.status !== 0) failed++;
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}
if (failed) {
  console.error(`\n${failed} of ${scripts.length} test scripts failed`);
  process.exit(1);
}
console.log(`\nAll ${scripts.length} test scripts passed`);
