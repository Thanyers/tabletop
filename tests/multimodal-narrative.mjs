import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.TRIO_URL||'http://127.0.0.1:5173/';
const out='test-results/multimodal-narrative';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],errors=[];
try{
 await Promise.all(['shipping','quest','music'].map(async id=>{
  const page=await browser.newPage({viewport:{width:1600,height:960}});
  page.on('pageerror',e=>errors.push(e.message));
  try{
   await page.goto(base);await page.getByTestId(`case-${id}`).click();
   await page.getByLabel('Story playback speed',{exact:true}).selectOption('2');
   await page.getByLabel('Start demo',{exact:true}).click();
   const player=page.getByTestId('trio-player');
   await expect(player).toHaveAttribute('data-step','minimal',{timeout:25000});
   await expect(player).toHaveAttribute('data-phase','thinking',{timeout:20000});
   await page.getByLabel('Pause story',{exact:true}).click();
   const source=page.getByTestId('canvas-object-sources');
   await expect(source).toHaveAttribute('data-spotlight','focused');
   const field=id==='shipping'?'billed':id==='quest'?'station':'bpm';
   await expect(source.locator(`[data-narrative-field="${field}"].is-narrative-detail`).first()).toBeVisible();
   await expect(page.getByTestId('trio-request').locator('mark')).not.toHaveCount(0);
   await page.screenshot({path:`${out}/${id}-source-reference.png`});
   checks.push(`${id}: named sheet cell, map station or audio BPM is highlighted before construction`);
   await page.getByLabel('Resume story',{exact:true}).click();
   await expect(player).toHaveAttribute('data-step','notice',{timeout:25000});
   await expect(player).toHaveAttribute('data-phase','thinking',{timeout:20000});
   await page.getByLabel('Pause story',{exact:true}).click();
   const minimal=page.getByTestId('canvas-object-minimal');
   await expect(minimal).toHaveAttribute('data-spotlight','focused');
   const target=minimal.locator('.is-narrative-detail').first();await expect(target).toBeVisible();
   expect(await target.evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
   await page.waitForTimeout(400);
   const box=await target.boundingBox(),stage=await page.getByTestId('trio-stage').boundingBox();
   expect(box.x).toBeGreaterThanOrEqual(stage.x-2);expect(box.x+box.width).toBeLessThanOrEqual(stage.x+stage.width+2);
   expect(box.y).toBeGreaterThanOrEqual(stage.y-2);expect(box.y+box.height).toBeLessThanOrEqual(stage.y+stage.height+2);
   await page.screenshot({path:`${out}/${id}-problem-reference.png`});
   await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
   await page.getByLabel('Resume story',{exact:true}).click();
   await expect(player).toHaveAttribute('data-phase','complete',{timeout:50000});
   await expect(page.locator('[data-testid="materialize-surface"]:not([data-state="ready"])')).toHaveCount(0);
   checks.push(`${id}: problem reference stays visible without green outlines, and full story completes`);
  }catch(e){await page.screenshot({path:`${out}/${id}-failure.png`});throw e}
  finally{await page.close()}
 }));
 expect(errors).toEqual([]);await writeFile(`${out}/report.json`,JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
}finally{await browser.close()}
