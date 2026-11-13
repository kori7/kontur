import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
const output=new URL('../output/qa/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1050}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173/');
 await page.getByRole('heading',{name:'Насосный агрегат Н-101'}).waitFor();
 await page.getByRole('button',{name:'Демосценарии'}).click();
 await page.getByLabel('Сценарий демонстрации').selectOption('r06');
 await page.getByRole('button',{name:'Применить сценарий'}).click();
 await page.getByText('R06',{exact:false}).first().waitFor();
 await page.screenshot({path:fileURLToPath(new URL('desktop.png',output)),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:fileURLToPath(new URL('mobile.png',output)),fullPage:true});
 console.log(JSON.stringify({screenshots:['desktop.png','mobile.png'],errors}));
}finally{await browser.close();}
