import { mkdir, writeFile } from 'node:fs/promises';
const output = new URL('../apps/web/public/vendor/', import.meta.url);
await mkdir(output, {recursive:true});
const assets = {
  'aframe.min.js':'https://aframe.io/releases/1.6.0/aframe.min.js',
  'aframe-ar.js':'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/aframe/build/aframe-ar.js',
  'camera_para.dat':'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/data/data/camera_para.dat',
  'patt.hiro':'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/data/data/patt.hiro',
  'hiro.png':'https://raw.githubusercontent.com/AR-js-org/AR.js/3.4.7/data/images/hiro.png',
};
for (const [name,url] of Object.entries(assets)) {
  const response=await fetch(url); if(!response.ok)throw new Error(`${name}: HTTP ${response.status}`);
  await writeFile(new URL(name,output),Buffer.from(await response.arrayBuffer())); console.log(`Saved ${name}`);
}
