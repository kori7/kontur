import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
const root=new URL('../',import.meta.url);
const checkLoss=process.argv.includes('--loss');
const video=checkLoss?'tmp/stand-tracking.y4m':'tmp/stand.y4m';
const browser=await chromium.launch({headless:true,args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-video-capture=${fileURLToPath(new URL(video,root))}`,'--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1000,height:702},permissions:['camera']});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:5173/ar.html');
 await page.getByRole('button',{name:'Включить AR-камеру'}).click();
 await page.waitForFunction(()=>document.getElementById('notice')?.textContent?.includes('Маркер найден'),{},{timeout:30000});
 await page.screenshot({path:fileURLToPath(new URL('output/qa/ar-tracking.png',root))});
 let markerHiddenAfterLoss=null;
 if(checkLoss){
  await page.waitForFunction(()=>document.getElementById('notice')?.textContent?.includes('Маркер потерян'),{},{timeout:15000});
  markerHiddenAfterLoss=await page.locator('a-marker').evaluate(marker=>!marker.object3D.visible);
  if(!markerHiddenAfterLoss)throw new Error('Marker content remained visible after tracking loss');
 }
 console.log(JSON.stringify({markerDetected:true,markerHiddenAfterLoss,errors}));
}finally{await browser.close();}
