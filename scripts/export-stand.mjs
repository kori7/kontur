import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
const root = new URL('../',import.meta.url);
await mkdir(new URL('tmp/',root),{recursive:true});
await mkdir(new URL('apps/web/public/demo/',root),{recursive:true});
await build({entryPoints:[fileURLToPath(new URL('apps/web/src/components/PumpDiagram.tsx',root))],outfile:fileURLToPath(new URL('tmp/pump-component.mjs',root)),bundle:true,format:'esm',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime']});
const {PumpSvg} = await import(new URL('tmp/pump-component.mjs',root).href);
for(const [id,props] of Object.entries({normal:{},'guard-missing':{guardMissing:true},leak:{leak:true}})){
  const svg=renderToStaticMarkup(React.createElement(PumpSvg,props));
  await writeFile(new URL(`apps/web/public/demo/${id}.svg`,root),svg);
}
await writeFile(new URL('apps/web/public/demo/manifest.json',root),JSON.stringify({source:'Original code-generated schematic, not a real equipment photograph',license:'Project original asset',images:[{id:'normal',expected:'guard present; no liquid shown'},{id:'guard-missing',expected:'coupling guard omitted; shaft visible'},{id:'leak',expected:'liquid drawn at seal; guard present'}]},null,2));
console.log('Exported 3 explicitly synthetic pump diagrams');
