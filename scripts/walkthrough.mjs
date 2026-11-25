/**
 * Drives the built app in a real browser: imports a capture from disk, filters
 * by device, expands a packet, and runs the live filter. Records a video and
 * a few screenshots so the run can be reviewed.
 *
 *   node scripts/walkthrough.mjs [baseUrl] [capturePath]
 */

import { mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.argv[2] ?? 'http://localhost:4173/';
const capturePath = resolve(process.argv[3] ?? 'tmp/btsnoop_hci.log');
const videoDir = resolve('tmp/video');
const shotDir = resolve('tmp/shots');
const size = { width: 1680, height: 1000 };

rmSync(videoDir, { recursive: true, force: true });
mkdirSync(videoDir, { recursive: true });
mkdirSync(shotDir, { recursive: true });

/** A visible pointer that follows the mouse without intercepting clicks. */
const cursorScript = `
  window.addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'left:0', 'top:0',
      'width:22px', 'height:22px', 'margin:-11px 0 0 -11px', 'border-radius:50%',
      'border:2px solid rgba(94,233,208,.95)', 'background:rgba(94,233,208,.22)',
      'box-shadow:0 0 18px rgba(94,233,208,.8)', 'pointer-events:none',
      'transition:transform 60ms linear', 'transform:translate(-100px,-100px)',
    ].join(';');
    document.body.appendChild(dot);
    addEventListener('mousemove', (event) => {
      dot.style.transform = 'translate(' + event.clientX + 'px,' + event.clientY + 'px)';
    }, true);
    addEventListener('mousedown', () => { dot.style.background = 'rgba(155,140,255,.5)'; }, true);
    addEventListener('mouseup', () => { dot.style.background = 'rgba(94,233,208,.22)'; }, true);
  });
`;

function assert(condition, message) {
  if (!condition) throw new Error(`Walkthrough check failed: ${message}`);
}

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: size,
  recordVideo: { dir: videoDir, size },
  deviceScaleFactor: 1,
});
await context.addInitScript(cursorScript);
const page = await context.newPage();
page.on('pageerror', (error) => {
  throw error;
});

/** Moves the pointer onto an element before acting on it, so the video shows it. */
async function pointAt(locator) {
  const box = await locator.boundingBox();
  assert(box, 'element has no box to point at');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 18 });
  await wait(220);
}

async function pointAndClick(locator) {
  await pointAt(locator);
  await locator.click();
  await wait(360);
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { level: 1 }).waitFor();
  await wait(900);

  // 1. Import a real btsnoop file from disk.
  await pointAt(page.locator('.dropzone'));
  await page.locator('input[type="file"]').setInputFiles(capturePath);
  await page.locator('.packet-row').first().waitFor();
  await wait(700);

  const stats = (await page.locator('.capture-stats').innerText()).replace(/\s+/g, ' ');
  assert(/HCI records/i.test(stats), `header is missing record stats: ${stats}`);
  const deviceCards = page.locator('.device-card');
  assert((await deviceCards.count()) === 2, 'expected both captured devices in the sidebar');
  assert(
    (await page.locator('.packets-title').innerText()).includes('FVP60'),
    'expected the busiest device to be selected on import',
  );
  await page.screenshot({ path: `${shotDir}/01_imported.png` });

  // 2. The table is long, so scroll it.
  await page.locator('.packet-scroll').hover();
  await page.mouse.wheel(0, 900);
  await wait(500);
  await page.mouse.wheel(0, -900);
  await wait(400);

  // 3. Switch devices, then come back.
  const buds = deviceCards.filter({ hasText: 'Aurora Buds' });
  await pointAndClick(buds);
  const budsTitle = await page.locator('.packets-title').innerText();
  assert(budsTitle.includes('58:FC:DB:92:14:60'), `unexpected device title: ${budsTitle}`);
  const budsRows = await page.locator('.packet-row').count();
  assert(budsRows > 0 && budsRows < 60, `expected only the earbuds packets, saw ${budsRows}`);
  await wait(500);

  await pointAndClick(deviceCards.filter({ hasText: 'FVP60' }));
  await wait(400);

  // 4. Find the packet whose payload spells FVP60 and read its three panels.
  const filterBox = page.getByRole('searchbox');
  await pointAt(filterBox);
  await filterBox.click();
  await filterBox.type('ascii:FVP60', { delay: 70 });
  await wait(700);

  const status = await page.locator('.filter-status').innerText();
  assert(/\b1\b/.test(status), `expected a single ASCII match, saw: ${status}`);
  const modelRow = page.locator('.packet-row').first();
  await pointAndClick(modelRow);
  await page.locator('.packet-detail').waitFor();
  await wait(500);

  const panels = await page.locator('.payload-panels .panel').count();
  assert(panels === 3, `expected hex, ASCII and numbers panels, saw ${panels}`);
  const asciiPanel = await page
    .locator('.panel[aria-label="ASCII"] .byte-cells')
    .allInnerTexts();
  assert(
    asciiPanel.join('').replace(/\s+/g, '').includes('FVP60'),
    `ASCII panel does not show the model string: ${asciiPanel}`,
  );
  await page.screenshot({ path: `${shotDir}/02_expanded_packet.png` });

  // 5. A hex filter highlights the matching bytes in the expanded packet.
  await pointAt(filterBox);
  await filterBox.fill('');
  await filterBox.type('hex:07ea', { delay: 70 });
  await wait(700);

  const hexMatches = await page.locator('.packet-row').count();
  assert(hexMatches > 0, 'expected the clock-sync packets to match hex:07ea');
  await pointAndClick(page.locator('.packet-row').first());
  await page.locator('.packet-detail').waitFor();
  await wait(400);

  const highlighted = await page.locator('.byte.hit').count();
  assert(highlighted >= 2, `expected the matched bytes to be highlighted, saw ${highlighted}`);
  const numbersText = await page.locator('.numbers-table').innerText();
  assert(numbersText.includes('2026'), 'numbers panel should decode 0x07ea as big-endian 2026');
  await page.screenshot({ path: `${shotDir}/03_hex_filter_highlight.png` });
  await wait(600);

  // 6. Filter by characteristic handle.
  await pointAt(filterBox);
  await filterBox.fill('');
  await filterBox.type('handle:0x000e', { delay: 70 });
  await wait(800);

  const handleRows = page.locator('.packet-row .col-handle');
  const handles = new Set(await handleRows.allInnerTexts());
  assert(handles.size === 1 && handles.has('0x000e'), `handle filter leaked rows: ${[...handles]}`);
  await page.screenshot({ path: `${shotDir}/04_handle_filter.png` });
  await wait(700);

  console.log('Walkthrough passed.');
} finally {
  await context.close();
  await browser.close();
}
