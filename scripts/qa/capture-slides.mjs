// Screenshots of the working app for the presentation (docs/presentation/screens/).
// Needs a server with the detector and without sign-in, e.g. on port 8091:
//   KONTUR_DETECTOR=rfdetr KONTUR_AUTH=off APP_DB_PATH=tmp/slides/inspection.db \
//   .venv/bin/python -m uvicorn app.main:create_app --factory --app-dir services/api --port 8091
// The camera is a canvas that shows a render of the A4 stand with a seal leak, so the live
// screenshot shows what the trained detector really answers on that frame.
import {chromium} from '@playwright/test';
import {mkdir, readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const base = process.env.KONTUR_URL ?? 'http://127.0.0.1:8091';
const output = new URL('../../docs/presentation/screens/', import.meta.url);
const stand = new URL('../../.models/rfdetr/stand/leak.png', import.meta.url);
await mkdir(output, {recursive: true});
const shot = (name) => fileURLToPath(new URL(name, output));

const browser = await chromium.launch({headless: true});
const errors = [];
async function open(viewport, path, scale = 2) {
  const page = await browser.newPage({viewport, deviceScaleFactor: scale, isMobile: viewport.width < 768, hasTouch: viewport.width < 768});
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(800);
  return page;
}
try {
  const phone = {width: 390, height: 844};

  let page = await open(phone, '/?screen=objects');
  await page.screenshot({path: shot('phone-objects.png')});
  await page.close();

  page = await open(phone, '/?screen=overview&equipment=wilo-il65-160');
  await page.screenshot({path: shot('phone-overview.png')});
  await page.close();

  page = await open(phone, '/?screen=history&equipment=wilo-il65-160');
  // The records, not the service plan and filters above them: start the frame at the newest record.
  await page.locator('.history-item').first().evaluate((node) => {
    window.scrollBy(0, node.getBoundingClientRect().top - 90);
  });
  await page.waitForTimeout(400);
  await page.screenshot({path: shot('phone-journal.png')});
  await page.close();

  page = await open({width: 820, height: 1180}, '/?screen=overview&equipment=wilo-il65-160');
  await page.screenshot({path: shot('tablet-overview.png')});
  await page.close();

  page = await open({width: 1440, height: 900}, '/?screen=overview&equipment=wilo-il65-160', 1.5);
  await page.screenshot({path: shot('desktop-overview.png')});
  await page.close();

  // Live inspection: replace the camera with the stand render before the app asks for it.
  const frame = process.env.KONTUR_FRAME ? new URL(process.env.KONTUR_FRAME, `file://${process.cwd()}/`) : stand;
  const type = frame.pathname.endsWith('.png') ? 'png' : 'jpeg';
  const image = `data:image/${type};base64,${(await readFile(frame)).toString('base64')}`;
  page = await browser.newPage({viewport: phone, deviceScaleFactor: 2, isMobile: true, hasTouch: true});
  page.on('pageerror', (error) => errors.push(error.message));
  // Part of the A4 sheet the "phone" frames: x,y,width,height in the render's pixels.
  // KONTUR_FRAME swaps the render for another picture, e.g. a held-out photo of the printed stand;
  // without KONTUR_CROP that picture is used whole.
  const crop = process.env.KONTUR_CROP?.split(',').map(Number) ?? (process.env.KONTUR_FRAME ? null : [120, 160, 1200, 900]);
  await page.addInitScript(([src, area]) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const [sx, sy, sw, sh] = area ?? [0, 0, img.naturalWidth, img.naturalHeight];
      const scale = 1280 / Math.max(sw, sh);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(sw * scale);
      canvas.height = Math.round(sh * scale);
      const context = canvas.getContext('2d');
      const draw = () => { context.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height); requestAnimationFrame(draw); };
      draw();
      return canvas.captureStream(15);
    };
  }, [image, crop]);
  await page.goto(`${base}/?screen=overview&equipment=pump-101`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', {name: 'Начать осмотр'}).first().click();
  await page.getByRole('button', {name: 'Включить камеру'}).click();
  await page.locator('.live-box.confirmed').first().waitFor({timeout: 60000});
  await page.waitForTimeout(1500);
  await page.screenshot({path: shot('phone-live.png')});
  await page.close();

  console.log(JSON.stringify({ok: true, errors}));
} finally {
  await browser.close();
}
