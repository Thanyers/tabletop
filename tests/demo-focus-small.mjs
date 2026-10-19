import {watchDetails} from './demo-helpers.mjs';
import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.argv.find(arg=>arg.startsWith('--url='))?.slice(6)||'http://127.0.0.1:5173/';
const before=base.includes(':4173');
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:319,height:612}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const player=page.getByTestId('demo-player');
async function settle(action,first=false){if(!first)await page.getByLabel('Next demo scene',{exact:true}).click();await expect(player).toHaveAttribute('data-scene',action);if(await player.getAttribute('data-phase')==='typing')await page.getByLabel('Next demo scene',{exact:true}).click();await expect(player).toHaveAttribute('data-phase','reading',{timeout:30000});await page.getByLabel('Pause demo',{exact:true}).click();await page.waitForTimeout(700);}
try{
 await page.goto(base);await watchDetails(page);await page.getByLabel('Demo playback speed').selectOption('4');
 for(const [index,action] of ['connect','minimal','compare','overview','why','threshold'].entries())await settle(action,index===0);
 const field=page.getByTestId('asset-policy-draft').getByLabel('Laptop threshold amount',{exact:true});
 const fieldBox=await field.boundingBox(),paneBox=await page.locator('.inspector__content').boundingBox();
 const checks=['Threshold field is fully visible in the 319px inspector'];const report={checks,viewport:{width:319,height:612},field:fieldBox,pane:paneBox,fullyVisible:fieldBox.y>=paneBox.y&&fieldBox.y+fieldBox.height<=paneBox.y+paneBox.height,errors};
 await page.screenshot({path:`test-results/v5-${before?'before':'after'}-small-focus.png`});await writeFile(`test-results/small-focus-${before?'before':'after'}-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 expect(report.fullyVisible,'The taught field must be inside the visible inspector, not only present in the DOM').toBe(true);expect(errors).toEqual([]);
 for(const [action,focus] of [['schedule','draft-start'],['types','draft-categories'],['list','draft-preview'],['browse','draft-browse']]){
  if(action==='types')await page.emulateMedia({reducedMotion:'reduce'});
  await settle(action);const region=await page.locator('[data-demo-focus="'+focus+'"]').boundingBox(),pane=await page.locator('.inspector__content').boundingBox();
  expect(region.y).toBeGreaterThanOrEqual(pane.y);expect(region.y).toBeLessThan(pane.y+pane.height-25);await expect(page.locator('[data-demo-focus="'+focus+'"]')).toHaveAttribute('data-demo-focus-active','true');checks.push(action+' focus is visible at 319px');
 }
 await writeFile('test-results/small-focus-after-report.json',JSON.stringify({...report,checks,errors},null,2));
}finally{await browser.close();}
