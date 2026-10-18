import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base=process.env.TRIO_URL||'http://127.0.0.1:5173/';
const out=process.env.TRIO_REPORT_DIR||'test-results/source-understanding'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[], errors=[];
async function framing(page, item) {
 const b=await item.boundingBox(), stage=await page.getByTestId('trio-stage').boundingBox();
 expect(b).toBeTruthy(); expect(stage).toBeTruthy();
 expect(b.x).toBeGreaterThanOrEqual(stage.x-3); expect(b.x+b.width).toBeLessThanOrEqual(stage.x+stage.width+3);
 const unclipped=await item.evaluate(el=>{const b=el.getBoundingClientRect();for(let p=el.parentElement;p;p=p.parentElement){const c=getComputedStyle(p),r=p.getBoundingClientRect();if(/auto|hidden|clip|scroll/.test(c.overflowY)&&b.bottom>r.bottom+3)return false;}return true;}); expect(unclipped).toBe(true);
 expect(b.y).toBeGreaterThanOrEqual(stage.y-3); expect(b.y+b.height).toBeLessThanOrEqual(stage.y+stage.height+3);
}
async function run(id,width) {
 const page=await browser.newPage({viewport:{width,height:width===319?612:960}});
 page.on('pageerror',e=>errors.push(`${id}: ${e.message}`));
 try {
  await page.goto(base); await page.getByTestId(`case-${id}`).click();
  await page.getByLabel('Story playback speed',{exact:true}).selectOption('2');
  await page.getByLabel('Start demo',{exact:true}).click();
  const player=page.getByTestId('trio-player'),source=page.getByTestId('canvas-object-sources');
  for(const purpose of ['create','revise']) {
   for(const beat of ['locate','understand','connect']) {
    await expect(player).toHaveAttribute('data-evidence-purpose',purpose,{timeout:45000});
    await expect(player).toHaveAttribute('data-evidence-beat',beat,{timeout:25000});
    await expect(source.getByTestId('materialize-surface')).toHaveAttribute('data-state','ready');
    await page.getByLabel('Pause story',{exact:true}).click();
    await expect(source).toHaveAttribute('data-spotlight','focused');
    const evidence=source.getByTestId('source-evidence');
    await expect(evidence).toHaveAttribute('data-evidence-beat',beat);
    await expect(source.getByTestId('highlighted-source').first()).toBeVisible();
    await page.waitForTimeout(450);
    await expect(player).toHaveAttribute('data-evidence-beat',beat);
    await framing(page,source.getByTestId('highlighted-source').first());
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    if(beat==='understand') await page.screenshot({path:`${out}/${id}-${width}-${purpose}.png`});
    await page.getByLabel('Resume story',{exact:true}).click();
   }
   checks.push(`${id} ${width}: ${purpose} source is highlighted through three paced beats; pause holds and camera frames it`);
   if(purpose==='create') {
    await expect(player).toHaveAttribute('data-step','minimal',{timeout:20000});
    await expect(player).toHaveAttribute('data-phase','reading',{timeout:20000});
    await expect(page.getByTestId('canvas-object-minimal').getByTestId('materialize-surface')).toHaveAttribute('data-state','ready');
    await page.getByLabel('Pause story',{exact:true}).click();
    const result=page.getByTestId('canvas-object-minimal');
    await expect(result.getByTestId('evidence-origin')).toBeVisible();
    await page.waitForTimeout(500);await page.screenshot({path:`${out}/${id}-${width}-created.png`});
    await result.getByTestId('evidence-origin').click();
    await expect(source.getByTestId('source-evidence')).toHaveAttribute('data-evidence-beat','understand');
    checks.push(`${id} ${width}: result origin reopens evidence`);
    await page.getByLabel('Resume story',{exact:true}).click();
   }
  }
  await expect(player).toHaveAttribute('data-step','teach',{timeout:20000});
  await expect(player).toHaveAttribute('data-phase','reading',{timeout:20000});
  await expect(page.getByTestId('canvas-object-teach').getByTestId('materialize-surface')).toHaveAttribute('data-state','ready');
  await page.getByLabel('Pause story',{exact:true}).click();
  const draft=page.getByTestId('canvas-object-teach');
  await expect(draft.getByTestId('evidence-origin')).toBeVisible();
  await page.waitForTimeout(600);await page.screenshot({path:`${out}/${id}-${width}-draft.png`});
  await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
  await page.getByLabel('Resume story',{exact:true}).click();
  await expect(player).toHaveAttribute('data-phase','complete',{timeout:50000});
  await expect(page.locator('[data-testid=materialize-surface]:not([data-state=ready])')).toHaveCount(0);
  checks.push(`${id} ${width}: UI and draft show source origins; complete verify/approve/simulate/handoff loop`);
 }catch(error){await page.screenshot({path:`${out}/${id}-${width}-failure.png`});throw error;}
 finally{await page.close();}
}
try {
 for(const width of [1600,319]) await Promise.all((process.env.TRIO_CASES?.split(',')||['shipping','quest','music']).map(id=>run(id,width)));
 expect(errors).toEqual([]);await writeFile(`${out}/report.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close();}

