import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from '../scripts/build.mjs';
import { createPreviewServer } from '../scripts/serve.mjs';

test('static build includes only the runtime allowlist, with source and data intact', async () => {
  const output = await mkdtemp(join(tmpdir(), 'decision-replay-build-'));
  try {
    await build(output);
    assert.deepEqual((await readdir(output)).sort(), ['.nojekyll', 'data', 'favicon.svg', 'index.html', 'src', 'styles.css']);
    assert.deepEqual((await readdir(join(output, 'src'))).sort(), ['app.js', 'engine.js']);
    assert.equal(await readFile(join(output, 'src/engine.js'), 'utf8'), await readFile(new URL('../src/engine.js', import.meta.url), 'utf8'));
    assert.equal(JSON.parse(await readFile(join(output, 'data/reference.json'), 'utf8')).calibrations.length, 2);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('preview serves runtime files but refuses source-control, scripts and traversal requests', async () => {
  const server = createPreviewServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /Decision Replay/);
    assert.match((await fetch(`${origin}/src/app.js`)).headers.get('content-type'), /javascript/);
    for (const path of ['/README.md', '/.git/config', '/scripts/serve.mjs', '/%2e%2e/CLAUDE.md', '/data/%2e%2e/%2e%2e/CLAUDE.md', '/%zz']) {
      assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
    }
    assert.equal((await fetch(origin, { method: 'POST' })).status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
