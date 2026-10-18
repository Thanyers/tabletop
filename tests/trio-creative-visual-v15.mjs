import { chromium, expect } from '@playwright/test';
import { mkdir,writeFile } from 'node:fs/promises';
const out='test-results/creative-visual-v15';await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});const checks=[];
try{for(const [width,height] of [[1600,900],[319,612]])for(const id of ['quest','music']){
 const context=await browser.newContext({viewport:{width,height}});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.TRIO_URL||'http://127.0.0.1:4173/');await page.getByTestId('case-'+id).click();await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');await page.getByLabel('Start demo',{exact:true}).click();
 await page.locator('[data-testid="trio-player"][data-step="minimal"][data-phase="reading"]').waitFor();await page.getByLabel('Pause story',{exact:true}).click();await page.waitForTimeout(650);
 await page.screenshot({path:`${out}/${id}-${width}-created.png`});
 const surface=page.getByTestId(id==='quest'?'quest-game':'music-lab');const overflow=await surface.evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));expect(overflow.scroll).toBeLessThanOrEqual(overflow.client+2);
 const target=page.locator(id==='quest'?'.quest-game__preview-feedback':'[data-testid="music-waveform"]');const box=await target.boundingBox(),canvas=await page.getByTestId('trio-stage').boundingBox();expect(box.y).toBeGreaterThanOrEqual(canvas.y-3);expect(box.y+box.height).toBeLessThanOrEqual(canvas.y+canvas.height+3);
 checks.push(`${id}/${width}: construction preview, primary reference within Canvas, no component horizontal overflow`);expect(errors).toEqual([]);await context.close();
}}finally{await browser.close();}
await writeFile(`${out}/report.json`,JSON.stringify({checks},null,2));console.log(JSON.stringify({checks:checks.length}));
