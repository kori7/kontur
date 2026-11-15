import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
// Stills of the demo pump's 3D model for the printable stand: normal, leaking seal and no coupling
// guard, from one camera so they can replace each other on the sheet. The signs come from an
// engineer's observation on the normal scenario, so the model shows the sign and nothing else
// (the demo scenarios also carry heat or vibration, which the viewer paints on other parts).
//
// The stand keeps the old drawing's frame (900×420), so every still is cropped to the same box and
// padded to that aspect. Each sign's box is where its still differs from the normal one; each part's
// AR anchor is the point its pin in the viewer leads to. Both go to scripts/train/stand-3d.json in
// that 900×420 frame, for render-stand.mjs (training) and ar.html (labels on the marker).
// Needs the app running with sign-in off: KONTUR_AUTH=off ./scripts/dev/start.sh
//     node scripts/qa/stand-stills.mjs [base URL]
const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const root = new URL('../../', import.meta.url);
const VARIANTS = [
  { name: 'normal' },
  // floor: the share of the busiest row or column a row or column must change to count as the sign.
  // A leak is a thin drip over a puddle; a removed guard also shifts shadows and reflections nearby.
  { name: 'leak', observation: 'liquid_leak', kind: 'seal_leak_excessive', floor: 0.06 },
  { name: 'guard-missing', observation: 'guard_missing', kind: 'guard_missing', floor: 0.25 },
];
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
const shots = {};
let anchors = null;
for (const variant of VARIANTS) {
  // A fresh page each time: the normal scenario with no earlier observations.
  await page.goto(`${base}/?equipment=pump-101`);
  await page.locator('.pump-model[data-ready="true"]').waitFor({ timeout: 30000 });
  if (variant.observation) {
    await page.getByRole('button', { name: 'Начать осмотр', exact: true }).click();
    await page.getByText('Добавить наблюдение инженера', { exact: true }).click();
    await page.getByLabel('Визуальный признак').selectOption(variant.observation);
    await page.getByLabel('Наличие признака').selectOption('true');
    await page.getByRole('button', { name: 'Учесть в диагностике', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
  }
  await page.waitForTimeout(1200);
  if (!anchors) {
    // Each pin's guide ends at the part it names: that point, relative to the scene, in device pixels.
    anchors = await page.evaluate(() => {
      const scene = document.querySelector('.model-scene').getBoundingClientRect();
      return Object.fromEntries([...document.querySelectorAll('.model-guides g[data-guide]')].map((group) => {
        const point = group.querySelector('circle').getBoundingClientRect();
        return [group.dataset.guide, [(point.x + point.width / 2 - scene.x) * 2, (point.y + point.height / 2 - scene.y) * 2]];
      }));
    });
  }
  const style = await page.addStyleTag({ content: '.model-annotations{display:none!important}*:not(canvas){background:transparent!important;box-shadow:none!important;border-color:transparent!important}' });
  await page.waitForTimeout(400);
  shots[variant.name] = (await page.locator('.model-scene').screenshot({ omitBackground: true })).toString('base64');
  await style.evaluate((element) => element.remove());
}

const result = await page.evaluate(async ({ shots, anchors, variants }) => {
  const load = async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); return image; };
  const images = Object.fromEntries(await Promise.all(Object.entries(shots).map(async ([name, data]) => [name, await load(data)])));
  const { width, height } = images.normal;
  const pixels = (image) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, width, height).data;
  };
  const data = Object.fromEntries(Object.entries(images).map(([name, image]) => [name, pixels(image)]));
  // One crop for all three: everything any still draws, plus a margin, padded to the 900×420 frame.
  let left = width, top = height, right = 0, bottom = 0;
  for (const values of Object.values(data)) {
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (values[(y * width + x) * 4 + 3] > 8) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
  }
  const margin = 24;
  left -= margin; top -= margin; right += margin; bottom += margin;
  let boxWidth = right - left, boxHeight = bottom - top;
  const aspect = 900 / 420;
  if (boxWidth / boxHeight < aspect) { const grow = boxHeight * aspect - boxWidth; left -= grow / 2; boxWidth += grow; }
  else { const grow = boxWidth / aspect - boxHeight; top -= grow / 2; boxHeight += grow; }
  const toFrame = ([x, y]) => [(x - left) / boxWidth * 900, (y - top) / boxHeight * 420];
  const stills = {};
  for (const [name, image] of Object.entries(images)) {
    const canvas = document.createElement('canvas'); canvas.width = 1800; canvas.height = 840;
    canvas.getContext('2d').drawImage(image, left, top, boxWidth, boxHeight, 0, 0, 1800, 840);
    stills[name] = canvas.toDataURL('image/png').split(',')[1];
  }
  // A sign is where its still differs clearly from the normal one. Removing a part also moves shadows
  // and leaves stray edge pixels, so the box spans only rows and columns with a real share of change.
  const boxes = {};
  const span = (counts, share) => {
    const floor = Math.max(...counts) * share;
    const kept = counts.map((count, index) => (count > floor ? index : -1)).filter((index) => index >= 0);
    return [kept[0], kept[kept.length - 1]];
  };
  for (const variant of variants.filter((item) => item.kind)) {
    const changed = data[variant.name];
    const columns = new Array(width).fill(0), rows = new Array(height).fill(0);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const delta = Math.abs(changed[i] - data.normal[i]) + Math.abs(changed[i + 1] - data.normal[i + 1])
        + Math.abs(changed[i + 2] - data.normal[i + 2]) + Math.abs(changed[i + 3] - data.normal[i + 3]);
      if (delta > 300) { columns[x] += 1; rows[y] += 1; }
    }
    const [x1, x2] = span(columns, variant.floor), [y1, y2] = span(rows, variant.floor);
    const pad = 6;
    boxes[variant.name] = { kind: variant.kind,
      box: [...toFrame([x1 - pad, y1 - pad]), ...toFrame([x2 + pad, y2 + pad])].map((value) => Math.round(value)) };
  }
  // A pin hidden behind other parts in this view has no usable point; the seal sits between the
  // bearing housing and the casing, so it takes their midpoint.
  const framed = Object.fromEntries(Object.entries(anchors).map(([id, point]) => [id, toFrame(point).map(Math.round)])
    .filter(([, [x, y]]) => x >= 0 && x <= 900 && y >= 0 && y <= 420));
  if (!framed.seal && framed.bearing && framed.pump) {
    framed.seal = framed.bearing.map((value, index) => Math.round((value + framed.pump[index]) / 2));
  }
  return { stills, boxes, anchors: framed };
}, { shots, anchors, variants: VARIANTS });

for (const [name, data] of Object.entries(result.stills)) {
  await writeFile(new URL(`apps/web/public/models/pump-assembly-${name}.png`, root), Buffer.from(data, 'base64'));
}
await writeFile(new URL('scripts/train/stand-3d.json', root), JSON.stringify({
  note: 'Кадры 3D-модели демо-насоса на стенде: рамки признаков и точки узлов в системе 900×420 (рамка картинки на стенде). Создаёт scripts/qa/stand-stills.mjs.',
  frame: [900, 420], boxes: result.boxes, anchors: result.anchors,
}, null, 2) + '\n');
console.log(JSON.stringify({ boxes: result.boxes, anchors: result.anchors }));
await browser.close();
