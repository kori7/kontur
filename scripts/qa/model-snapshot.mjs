import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
// Static frames of the 3D models for places that show the pump without a WebGL viewer (the stand dialog).
// Renders the app's own viewer at its initial view, without node numbers, on a transparent background,
// then trims the empty margins. Needs the app running: ./scripts/dev/start.sh,
// then node scripts/qa/model-snapshot.mjs [base URL].
const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const frames = [{ equipment: 'pcp-21031004-1', file: 'apps/web/public/models/ams-pcp-21031004.png' }];
const root = new URL('../../', import.meta.url);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
for (const frame of frames) {
  await page.goto(`${base}/?equipment=${frame.equipment}`);
  await page.locator('.pump-model[data-ready="true"]').waitFor({ timeout: 30000 });
  await page.addStyleTag({ content: '.model-annotations{display:none!important}*:not(canvas){background:transparent!important;box-shadow:none!important;border-color:transparent!important}' });
  await page.waitForTimeout(800);
  const shot = await page.locator('.model-scene').screenshot({ omitBackground: true });
  const trimmed = await page.evaluate(async (data) => {
    const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode();
    const source = document.createElement('canvas'); source.width = image.width; source.height = image.height;
    const context = source.getContext('2d'); context.drawImage(image, 0, 0);
    const alpha = context.getImageData(0, 0, image.width, image.height).data;
    let left = image.width, top = image.height, right = 0, bottom = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      if (alpha[(y * image.width + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    const pad = 24; left = Math.max(left - pad, 0); top = Math.max(top - pad, 0);
    right = Math.min(right + pad, image.width - 1); bottom = Math.min(bottom + pad, image.height - 1);
    const out = document.createElement('canvas'); out.width = right - left + 1; out.height = bottom - top + 1;
    out.getContext('2d').drawImage(source, left, top, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png').split(',')[1];
  }, shot.toString('base64'));
  await writeFile(new URL(frame.file, root), Buffer.from(trimmed, 'base64'));
  console.log(`Saved ${frame.file}`);
}
await browser.close();
