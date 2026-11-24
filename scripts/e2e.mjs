// Loads the unpacked extension into Chromium and checks a real PR.
// Usage: GH_TOKEN=... node scripts/e2e.mjs [pr-url] [screenshot-dir]
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const extDir = path.resolve(import.meta.dirname, '..');
const prUrl = process.argv[2] || 'https://github.com/logos-co/logos-chat-module/pull/76';
const shotDir = process.argv[3];
// Chrome derives unpacked extension IDs from the directory path.
const extId = [...createHash('sha256').update(extDir).digest('hex').slice(0, 32)]
  .map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');

const ctx = await chromium.launchPersistentContext(mkdtempSync(path.join(tmpdir(), 'ghdf-')), {
  channel: 'chromium',
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  viewport: { width: 1400, height: 900 },
});

// VIEWED=path1,path2 answers the "viewed files" query as if exactly those files were marked as
// viewed (VIEWED=* for all of them), so the pill can be checked without touching real review state.
if (process.env.VIEWED !== undefined) {
  const viewed = process.env.VIEWED.split(',').map((s) => s.trim());
  await ctx.route('https://api.github.com/graphql', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    for (const f of body.data?.repository?.pullRequest?.files?.nodes ?? []) {
      f.viewerViewedState = viewed.includes('*') || viewed.includes(f.path) ? 'VIEWED' : 'UNVIEWED';
    }
    await route.fulfill({ response: res, json: body });
  });
}

const opts = await ctx.newPage();
await opts.goto(`chrome-extension://${extId}/src/options.html`);
await opts.fill('#token', process.env.GH_TOKEN || '');
await opts.click('#save');
await opts.click('#check');
await opts.waitForFunction(() => !/Checking|^$/.test(document.getElementById('token-status').textContent));
console.log('options:', await opts.textContent('#status'), '|', await opts.textContent('#token-status'));

let failed = false;
for (const suffix of ['', '/files']) {
  const page = await ctx.newPage();
  await page.goto(prUrl + suffix, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForSelector('.ghdf-badge', { timeout: 30000 });
    const badges = await page.$$eval('.ghdf-badge', (els) => els.map((e) => ({ text: e.textContent, title: e.title })));
    console.log(`${suffix || '/'}:`, JSON.stringify(badges, null, 1));
    if (shotDir) {
      const b = page.locator('.ghdf-badge').first();
      await b.scrollIntoViewIfNeeded();
      await b.locator('xpath=../..').screenshot({ path: path.join(shotDir, `badge${suffix.replace('/', '-') || '-conversation'}.png`) });
    }
  } catch (e) {
    failed = true;
    console.log(`${suffix || '/'}: no badge (${e.message.split('\n')[0]})`);
  }
}
await ctx.close();
process.exit(failed ? 1 : 0);
