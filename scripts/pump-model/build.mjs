import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const pcp = process.argv.includes('--ams-pcp');
const entry = pcp ? path.join(here, '../ams-pcp-model/export.js') : path.join(here, 'export.js');
const bundled = await build({ entryPoints: [entry], bundle: true, format: 'esm', write: false, target: 'es2022' });
const pageHtml = '<!doctype html><html><head><style>@font-face{font-family:Geologica;src:url(/font.woff2)}body{font-family:Geologica}</style></head><body>Building pump model<script type="module" src="/build.js"></script></body></html>';
const server = http.createServer((request, response) => {
  const route = new URL(request.url, 'http://localhost').pathname;
  if (route === '/') { response.setHeader('Content-Type', 'text/html'); response.end(pageHtml); }
  else if (route === '/build.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundled.outputFiles[0].contents); }
  else if (route === '/font.woff2') { response.setHeader('Content-Type', 'font/woff2'); response.end(fs.readFileSync(path.join(root, 'apps/web/public/fonts/Geologica-Medium.woff2'))); }
  else if (/^\/textures\/(cast|brushed|base)-(color|roughness|normal)\.png$/.test(route)) { response.setHeader('Content-Type', 'image/png'); response.end(fs.readFileSync(path.join(here, route.slice(1)))); }
  else { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error(error));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('body[data-ready="true"]');
  const data = await page.evaluate(() => window.exportPumpModel());
  const target = path.join(root, `apps/web/public/models/${pcp ? 'ams-pcp-21031004' : 'pump-assembly'}.glb`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, Buffer.from(data, 'base64'));
  console.log(JSON.stringify({ model: target, bytes: fs.statSync(target).size }));
  console.log('Textured pump GLB built');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
