import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
await mkdir(new URL('data/demo/images/',root),{recursive:true});
await mkdir(new URL('output/qa/',root),{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1000,height:700},deviceScaleFactor:1});
 for(const id of ['normal','guard-missing','leak']){
  await page.goto(`http://127.0.0.1:5173/demo/${id}.svg`);
  await page.locator('svg').screenshot({path:fileURLToPath(new URL(`data/demo/images/${id}.png`,root))});
 }
 await page.goto('http://127.0.0.1:5173/stand.html');
 await page.locator('.sheet').screenshot({path:fileURLToPath(new URL('output/qa/stand.png',root))});
 console.log('Captured 3 schematic PNGs and the printable stand');
}finally{await browser.close();}
