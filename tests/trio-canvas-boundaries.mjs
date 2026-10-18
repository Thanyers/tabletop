import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const root=process.env.TRIO_REPORT_DIR||'test-results/canvas-boundaries',base=process.env.TRIO_URL||'http://127.0.0.1:4173/';
await mkdir(root,{recursive:true});const browser=await chromium.launch({channel:'msedge',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage(),checks=[],errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto(base);const originalCanvas=await page.locator('.canvas-area .react-flow').elementHandle();await page.getByTestId('case-shipping').click();expect(await originalCanvas.evaluate(el=>el.isConnected)).toBe(true);
 await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');await page.getByLabel('Start demo',{exact:true}).click();
 await expect(page.getByTestId('trio-player')).toHaveAttribute('data-step','verify',{timeout:30000});
 await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase','reading');
 await page.getByLabel('Take over workspace',{exact:true}).click();
 const composer=page.getByLabel('Describe a rule change',{exact:true});
 for(const instruction of ['do not approve yet',"don't approve",'don’t approve','อย่าเพิ่งอนุมัติ','do not verify']){
  await composer.fill(instruction);await composer.press('Enter');await page.getByLabel('Save workspace',{exact:true}).click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('procedural.trio.manual.v1.shipping')).snapshot);
  expect(saved.version, instruction).toBe(1);expect(saved.approved).toBe(false);expect(saved.events.some(e=>e.kind==='approval')).toBe(false);expect(saved.evaluation.passed).toBe(8);
 }
 checks.push('Negative English and Thai instructions leave a passing candidate unapproved');
 await composer.fill('อนุมัติกติกานี้');await composer.press('Enter');await page.getByLabel('Save workspace',{exact:true}).click();
 const approved=await page.evaluate(()=>JSON.parse(localStorage.getItem('procedural.trio.manual.v1.shipping')).snapshot);expect(approved.version).toBe(2);expect(approved.active.shipping.bangkok).toBe(35);checks.push('Explicit positive instruction approves the actual current tested candidate');
 while(Number(await page.getByTestId('trio-stage').getAttribute('data-level'))<8){await page.getByTestId('trio-continue').click();await page.waitForTimeout(200);}
 await page.getByLabel('Fit to work',{exact:true}).click();await page.waitForTimeout(650);
 const routing=await page.evaluate(()=>{
  const boxes=[...document.querySelectorAll('[data-trio-object]')].map(el=>({id:el.getAttribute('data-trio-object'),r:el.getBoundingClientRect()}));
  const paths=[...document.querySelectorAll('.react-flow__edge path.react-flow__edge-path')].filter(p=>!p.id.endsWith('-halo'));
  const hits=[];let sampled=0;
  for(const path of paths){const matrix=path.getScreenCTM(),length=path.getTotalLength();if(!matrix||!length)continue;const at=t=>{const p=path.getPointAtLength(t);return new DOMPoint(p.x,p.y).matrixTransform(matrix);};const start=at(0),end=at(length);const endpoint=box=>[start,end].some(p=>p.x>=box.r.left-8&&p.x<=box.r.right+8&&p.y>=box.r.top-8&&p.y<=box.r.bottom+8);
   for(let i=1;i<30;i++){const p=at(length*i/30);sampled++;for(const box of boxes){if(endpoint(box))continue;if(p.x>box.r.left+3&&p.x<box.r.right-3&&p.y>box.r.top+3&&p.y<box.r.bottom-3)hits.push({edge:path.closest('.react-flow__edge')?.getAttribute('data-id'),card:box.id});}}
  }
  return {paths:paths.length,sampled,hits};
 });
 expect(routing.paths).toBeGreaterThan(0);expect(routing.sampled).toBeGreaterThan(0);expect(routing.hits).toEqual([]);checks.push('Recorded dependency arrows avoid unrelated rendered cards in the full Canvas');
 await page.screenshot({path:`root`.replace('root',root)+'/overview.png'});
 await page.getByLabel('Back to stories',{exact:true}).click();expect(await originalCanvas.evaluate(el=>el.isConnected)).toBe(true);checks.push('Returning from the demo retains the original Canvas instance');
 await page.getByRole('button',{name:'เชื่อม Database หรือ Excel',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.screenshot({path:root+'/connections.png'});checks.push('Original Database and Excel connection panel remains available');
 expect(errors).toEqual([]);await writeFile(root+'/report.json',JSON.stringify({checks,routing,errors},null,2));console.log(JSON.stringify({checks:checks.length,routing,errors}));
}catch(error){await page.screenshot({path:root+'/failure.png'});await writeFile(root+'/failure.json',JSON.stringify({error:String(error),checks,errors,dom:await page.locator('body').innerText()},null,2));throw error;}finally{await browser.close();}
