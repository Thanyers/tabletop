import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const out=process.env.TRIO_REPORT_DIR||'test-results/encounter-story';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],errors=[];
async function run(width){
 const page=await browser.newPage({viewport:{width,height:width===319?612:960},acceptDownloads:true});
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(process.env.TRIO_URL||'http://127.0.0.1:5173/');
  await page.getByTestId('case-quest').click();
  await expect(page.getByLabel('Start demo',{exact:true})).toBeVisible();
  await page.getByLabel('Story playback speed',{exact:true}).selectOption('2');
  await page.getByLabel('Start demo',{exact:true}).click();
  const player=page.getByTestId('trio-player');
  // Teaching changes the same board without auto-playing another round.
  // Simulation presents a labeled estimate; its board waits for manual play.
  for(const [step,hp] of [['minimal',6],['verify',8]]){
   await expect(player).toHaveAttribute('data-step',step,{timeout:45000});
   await expect(player).toHaveAttribute('data-phase','reading',{timeout:15000});
   const node=page.getByTestId('canvas-object-minimal'),game=node.getByTestId('encounter-game');
   await expect(game.getByRole('progressbar',{name:'pip HP',exact:true})).toHaveAttribute('aria-valuenow',String(hp),{timeout:12000});
   await expect(game.getByRole('progressbar',{name:'goblin HP',exact:true})).toHaveAttribute('aria-valuenow','0',{timeout:12000});
   await page.getByLabel('Pause story',{exact:true}).click();
   await expect(node).toHaveAttribute('data-spotlight','focused');
   await page.waitForTimeout(500);
   const field=game.locator('.encounter-game__field');
   const clipping=await field.evaluate(el=>{const r=el.getBoundingClientRect();for(let p=el.parentElement;p;p=p.parentElement){let s=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|hidden|clip|scroll/.test(s.overflowY)&&(r.bottom>b.bottom+3||r.top<b.top-3))return p.className;}return null;});
   expect(clipping).toBeNull();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await page.screenshot({path:`${out}/${width}-${step}.png`});
   await page.waitForTimeout(300);
   await expect(game.getByRole('progressbar',{name:'pip HP',exact:true})).toHaveAttribute('aria-valuenow',String(hp));
   checks.push(`${width}: ${step} plays real trace, Pip ${hp}, Goblin 0; pause and camera preserve board`);
   await page.getByLabel('Resume story',{exact:true}).click();
  }
  await expect(player).toHaveAttribute('data-phase','complete',{timeout:30000});
  const originalRound=page.getByTestId('canvas-object-minimal');
  const beforeTakeoverHP=await originalRound.getByRole('progressbar',{name:'pip HP',exact:true}).getAttribute('aria-valuenow');
  await page.getByLabel('Take over workspace',{exact:true}).click();
  await expect(player).toHaveAttribute('data-guided','false');
  await expect(originalRound.getByRole('progressbar',{name:'pip HP',exact:true})).toHaveAttribute('aria-valuenow',beforeTakeoverHP);
  checks.push(`${width}: takeover preserves the currently visible encounter state`);
  await page.getByRole('button',{name:'Teach a rule',exact:true}).click();
  await originalRound.getByRole('button',{name:'ประวัติเดิม',exact:true}).click();
  await expect(originalRound.getByTestId('encounter-history')).toContainText('Pip 6/10 HP');
  await originalRound.getByRole('button',{name:'Draft',exact:true}).click();
  const draft=originalRound;
  await draft.getByRole('button',{name:/เล่นอีกรอบ|เล่นหนึ่งตา|เล่น 1/}).first().click();
  await expect(draft.getByRole('progressbar',{name:'pip HP',exact:true})).toHaveAttribute('aria-valuenow','8');
  const reset=draft.getByRole('button',{name:/เริ่มใหม่|รีเซ็ต/}).first();
  await reset.click();
  await expect(draft.getByRole('progressbar',{name:'pip HP',exact:true})).toHaveAttribute('aria-valuenow','10');
  checks.push(`${width}: takeover keeps draft playable and reset restores HP`);
  if(width===1600){
   await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
   await expect(draft.getByRole('button',{name:/เล่นอีกรอบ|เล่นหนึ่งตา|เล่น 1/}).first()).toBeDisabled();
   await page.waitForTimeout(1400);
   await expect(draft.getByRole('progressbar',{name:'pip HP',exact:true})).toHaveAttribute('aria-valuenow','10');
   await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
   checks.push('Hidden document disables encounter playback and preserves HP');
  }
  if(width===1600){
   await page.getByLabel('Fit to work',{exact:true}).click();
   await page.getByTestId('canvas-object-handoff').locator('.trio-canvas-node__chrome').dblclick();
   const downloadReady=page.waitForEvent('download');
   await page.getByTestId('canvas-object-handoff').getByRole('button',{name:/เกมที่เล่นได้/}).click();
   const download=await downloadReady, path=resolve(out,download.suggestedFilename());await download.saveAs(path);
   const offline=await browser.newPage();const network=[];offline.on('request',r=>{if(r.url().startsWith('http'))network.push(r.url())});
   await offline.goto(pathToFileURL(path).href);await offline.locator('#play').click();
   await expect(offline.locator('#pip')).toHaveText('8 / 10 HP');await expect(offline.locator('#goblin')).toHaveText('0 / 6 HP');
   await offline.locator('#reset').click();await expect(offline.locator('#pip')).toHaveText('10 / 10 HP');
   expect(network).toEqual([]);await offline.close();checks.push('Downloaded game runs offline with current approved shield rule and resets');
  }

 }catch(e){await page.screenshot({path:`${out}/${width}-failure.png`});throw e;}finally{await page.close();}
}
try{await Promise.all([1600,319].map(run));expect(errors).toEqual([]);await writeFile(`${out}/report.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));}finally{await browser.close();}
