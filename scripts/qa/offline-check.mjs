import { chromium } from '@playwright/test';
// Offline check: the customer's network has no internet (organizer answers §3), so no screen may reach
// outside the plant server. Opens every screen, the camera dialog, the stand, the AR page and the
// presentation with every non-local request blocked, and lists what tried to leave. Then checks the
// installed-app side: the service worker is active and, with the network cut entirely (the plant server
// out of reach too), the app still opens from its cache. Exit code 1 if anything fails.
// Needs the app running with sign-in off: KONTUR_AUTH=off ./scripts/dev/start.sh
//     node scripts/qa/offline-check.mjs [base URL]
const base = process.argv[2] ?? 'http://127.0.0.1:8000';
const local = new URL(base).host;
const browser = await chromium.launch({ args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['camera'] });
const outside = new Map();
await context.route('**/*', (route) => {
  const url = new URL(route.request().url());
  if (['data:', 'blob:'].includes(url.protocol) || url.host === local) return route.continue();
  outside.set(url.origin + url.pathname, (outside.get(url.origin + url.pathname) ?? 0) + 1);
  return route.abort('internetdisconnected');
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

const visit = async (path, steps = async () => {}) => {
  await page.goto(`${base}${path}`);
  await page.waitForLoadState('networkidle');
  await steps();
  await page.waitForTimeout(800);
  console.log(`открыто: ${path}`);
};
await visit('/?screen=objects');
await visit('/?equipment=pump-101&screen=overview', async () => {
  await page.locator('.pump-model[data-ready="true"]').waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Начать осмотр', exact: true }).click();
  await page.getByRole('button', { name: 'Включить камеру' }).click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
});
await visit('/?equipment=pcp-21031004-1&screen=overview', async () => {
  await page.locator('.pump-model[data-ready="true"]').waitFor({ timeout: 30000 });
  await page.locator('#passport > summary').click();
  await page.locator('#checks > summary').click();
});
await visit('/?equipment=wilo-il65-160&screen=overview');
await visit('/?screen=history');
await visit('/?screen=series');
await visit('/?screen=library');
await visit('/stand.html');
await visit('/ar.html', async () => { await page.waitForTimeout(2500); });
await visit('/presentation.html');

// The installed app: a fresh context without the request filter, so the service worker sees real responses.
const installed = await browser.newContext({ viewport: { width: 390, height: 844 } });
const app = await installed.newPage();
await app.goto(`${base}/?screen=objects`);
const worker = await app.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
await app.waitForTimeout(1500);
await app.reload();
await app.waitForLoadState('networkidle');
await installed.setOffline(true);
await app.reload();
const shell = await app.title();
await app.waitForTimeout(1500);
const offlineText = (await app.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 160);
await browser.close();
console.log(`Сервис-воркер: ${worker ?? 'не зарегистрирован'}; без сети открылось: ${shell || '—'}`);
console.log(`Без сети на экране: ${offlineText}`);
if (!['activating', 'activated'].includes(worker) || !shell.includes('КОНТУР') || offlineText.includes('Failed to fetch')) {
  console.log('Приложение без сети не открылось из кэша');
  process.exit(1);
}

if (errors.length) console.log(`Ошибки на страницах (${errors.length}):\n  ${[...new Set(errors)].join('\n  ')}`);
if (outside.size) {
  console.log(`Запросы наружу: ${outside.size}`);
  for (const [url, count] of outside) console.log(`  ${count} × ${url}`);
  process.exit(1);
}
console.log('Ни одного запроса за пределы сервера КОНТУР.');
