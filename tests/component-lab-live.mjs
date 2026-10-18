import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
const out='test-results/component-lab-live';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
let round=0;
page.on('response',async response=>{
 if(response.url().includes('/api/component-lab/jobs/')&&response.request().method()==='GET'){
  try{const data=await response.json();if(data.status==='complete')await fs.writeFile(`${out}/round-${round}-result.json`,JSON.stringify(data,null,2));}catch{}
 }
});
try{
 await page.goto('http://127.0.0.1:5173/?componentLab=1');
 await expect(page.getByTestId('component-lab-generate')).toBeEnabled();
 const prompts=[null,'มือใหม่ให้คลาดเคลื่อนได้ 150ms','แยกแผ่นซ้ายขวาแยกผล','เปลี่ยนเป็นโทนส้มครีมเก็บผลเดิม'];
 let previous=[];
 for(round=0;round<prompts.length;round++){
  if(prompts[round])await page.locator('#component-lab-prompt').fill(prompts[round]);
  const start=Date.now();console.log(`ROUND ${round} generating`);
  await page.getByTestId('component-lab-generate').click();
  await expect(page.getByTestId('component-lab-run-tests')).toBeEnabled({timeout:195000});
  console.log(`ROUND ${round} preview ${Date.now()-start}ms`);
  await page.getByTestId('component-lab-run-tests').click();
  await expect(page.getByTestId('component-lab-activate')).toBeEnabled({timeout:15000});
  await page.getByTestId('component-lab-activate').click();
  const frame=page.frameLocator('.generated-component-frame');
  await expect(frame.locator('button').first()).toBeVisible();
  console.log(`ROUND ${round} buttons`,await frame.locator('button').allTextContents());
  const startButton=frame.getByRole('button',{name:/เริ่ม|start/i}).first();
  await startButton.click();
  const pads=frame.getByRole('button',{name:/เคาะ|แตะ|tap|มือซ้าย|มือขวา/i});
  const count=await pads.count();
  if(!count)throw Error('No tap pad identifiable by accessible name');
  for(let i=0;i<3;i++){await page.waitForTimeout(180);await pads.nth(i%count).click();}
  await frame.getByRole('button',{name:/หยุด|stop/i}).first().click();
  const downloadEvent=page.waitForEvent('download');
  await page.getByRole('button',{name:'เก็บผลการทดลองเป็นไฟล์'}).click();
  const download=await downloadEvent;await download.saveAs(`${out}/round-${round}-export.json`);
  const saved=JSON.parse(await fs.readFile(`${out}/round-${round}-export.json`,'utf8'));
  expect(saved.state.history.slice(0,previous.length)).toEqual(previous);
  expect(saved.state.history.length).toBe(previous.length+3);
  if(round>=1)expect(saved.state.settings.toleranceMs).toBe(150);
  if(round>=2)expect(saved.state.settings.splitHands).toBe(true);
  previous=saved.state.history;
  await page.locator('.component-lab__body').evaluate(el=>el.scrollTop=0);
  await page.screenshot({path:`${out}/round-${round}.png`});
  console.log(`ROUND ${round} PASS`,JSON.stringify({settings:saved.state.settings,history:previous.length,metrics:saved.revisions[0]}).slice(0,450));
 }
 await fs.writeFile(`${out}/status.json`,JSON.stringify({passed:true,errors,rounds:round},null,2));
 console.log('ALL FOUR REAL GENERATION ROUNDS PASSED');
}catch(error){
 await page.screenshot({path:`${out}/failure.png`}).catch(()=>{});
 await fs.writeFile(`${out}/failure.txt`,`${String(error)}\n${await page.locator('body').innerText()}`);
 console.error(error);process.exitCode=1;
}finally{await browser.close();}
