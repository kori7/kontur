import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
// Base images of the printable stand for detector training: the same A4 sheet with the normal, leaking
// and guardless 3D model (stand.html?variant=…). Defect boxes come from scripts/train/stand-3d.json,
// made by scripts/qa/stand-stills.mjs in the picture's 900×420 frame, which fills .board .pump, so
// they map linearly onto the screenshot.
// Needs the app running (./scripts/dev/start.sh); augment-stand.py turns these into a training set.
//     node scripts/train/render-stand.mjs [base URL]
const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const out = new URL('../../.models/rfdetr/stand/', import.meta.url);
const stills = JSON.parse(await readFile(new URL('stand-3d.json', import.meta.url), 'utf-8'));
const SIGNS = {
  normal: [],
  leak: [stills.boxes.leak],
  'guard-missing': [stills.boxes['guard-missing']],
};
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1300, height: 950 }, deviceScaleFactor: 2 });
const manifest = [];
for (const [variant, signs] of Object.entries(SIGNS)) {
  await page.goto(`${base}/stand.html${variant === 'normal' ? '' : `?variant=${variant}`}`);
  await page.evaluate(() => document.querySelector('.board .pump').decode());
  await page.evaluate(() => document.fonts.ready);
  const sheet = page.locator('.sheet');
  const frame = await sheet.boundingBox();
  const drawing = await page.locator('.board .pump').boundingBox();
  const scale = 2;
  const boxes = signs.map(({ kind, box }) => ({
    kind,
    box: [
      (drawing.x - frame.x + (box[0] / 900) * drawing.width) * scale,
      (drawing.y - frame.y + (box[1] / 420) * drawing.height) * scale,
      (drawing.x - frame.x + (box[2] / 900) * drawing.width) * scale,
      (drawing.y - frame.y + (box[3] / 420) * drawing.height) * scale,
    ],
  }));
  const file = `${variant}.png`;
  await sheet.screenshot({ path: new URL(file, out).pathname });
  const drawingBox = [(drawing.x - frame.x) * scale, (drawing.y - frame.y) * scale,
    (drawing.x - frame.x + drawing.width) * scale, (drawing.y - frame.y + drawing.height) * scale];
  manifest.push({ variant, file, width: Math.round(frame.width * scale), height: Math.round(frame.height * scale),
    drawing: drawingBox, boxes });
  console.log(`${file}: ${boxes.length} рамок`);
}
await writeFile(new URL('stand.json', out), JSON.stringify(manifest, null, 2));
await browser.close();
