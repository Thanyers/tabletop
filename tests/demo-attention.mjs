import {watchDetails} from './demo-helpers.mjs';
import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.argv.find(s=>s.startsWith('--url='))?.slice(6)||'http://127.0.0.1:5173/';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1024,height:768}});
const player=page.getByTestId('demo-player'),failures=[],observed={};
async function settle(action,first=false){if(!first)await page.getByLabel('Next demo scene',{exact:true}).click();await expect(player).toHaveAttribute('data-scene',action);if(await player.getAttribute('data-phase')==='typing')await page.getByLabel('Next demo scene',{exact:true}).click();await expect(player).toHaveAttribute('data-phase','reading',{timeout:30000});await page.getByLabel('Pause demo',{exact:true}).click();await page.waitForTimeout(700);}
try{
 await page.goto(base);await watchDetails(page);await page.getByLabel('Demo playback speed').selectOption('4');await settle('connect',true);
 await page.getByLabel('Next demo scene',{exact:true}).click();await page.getByLabel('Next demo scene',{exact:true}).click();
 try{await page.locator('[data-construction-phase="skeleton"]').waitFor({state:'visible',timeout:5000});observed.skeleton=true;}catch{observed.skeleton=false;failures.push('No visible skeleton-to-content construction phase before the real UI appears');}
 await expect(player).toHaveAttribute('data-phase','reading',{timeout:30000});await page.getByLabel('Pause demo',{exact:true}).click();await page.waitForTimeout(700);
 observed.edges=await page.locator('.canvas-area .react-flow__edge').count();if(!observed.edges)failures.push('Guided source/worker/table have no visible relationship lines');
 await settle('compare');
 const card=await page.getByTestId('object-table').boundingBox(),prompt=await page.locator('.prompt-area').boundingBox(),playback=await player.boundingBox();observed.framing={card,prompt,playback};
 if(card.y+card.height>Math.min(prompt?.y??Infinity,playback.y)-8)failures.push('Focused table is obscured by the prompt or playback controls');
 observed.horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);if(observed.horizontalOverflow)failures.push('Page overflows horizontally');
 await page.screenshot({path:'test-results/attention-after.png'});await writeFile('test-results/attention-after.json',JSON.stringify({observed,failures},null,2));console.log(JSON.stringify({observed,failures},null,2));expect(failures).toEqual([]);
}finally{await browser.close();}
