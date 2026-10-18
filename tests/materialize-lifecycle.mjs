import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const output = 'test-results/materialize-lifecycle';
await mkdir(output, {recursive:true});
const browser = await chromium.launch({channel:'msedge',headless:true});
const page = await browser.newPage({viewport:{width:1440,height:900}});
const errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
try {
  await page.goto(process.env.TRIO_URL || 'http://127.0.0.1:5173/');
  await page.getByTestId('case-shipping').click();
  await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
  await page.evaluate(()=>{
    let paused=false,skipped=false;
    new MutationObserver(()=>{
      const minimal=document.querySelector('[data-testid="canvas-object-minimal"] [data-state="revealing"]');
      if(minimal&&!paused){paused=true;document.querySelector('[aria-label="Pause story"]')?.click();}
      const handoff=document.querySelector('[data-testid="canvas-object-handoff"] [data-state="revealing"]');
      if(handoff&&!skipped){const next=document.querySelector('[aria-label="Next story step"]');if(next&&!next.disabled){skipped=true;next.click();}}
    }).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-state','disabled','data-phase']});
  });
  await page.getByLabel('Start demo',{exact:true}).click();
  const minimal=page.getByTestId('canvas-object-minimal').getByTestId('materialize-surface');
  await expect(minimal).toHaveAttribute('data-paused','true',{timeout:20000});
  await page.waitForTimeout(900);
  await expect(minimal).toHaveAttribute('data-state','revealing');
  const animations=await minimal.evaluate(el=>el.getAnimations({subtree:true}).map(a=>a.playState));
  expect(animations.every(state=>state==='paused'||state==='finished')).toBe(true);
  await page.getByLabel('Resume story',{exact:true}).click();
  await expect(minimal).toHaveAttribute('data-state','ready');
  checks.push('Pause holds the reveal; Resume completes it and enables content');
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase','complete',{timeout:60000});
  const handoff=page.getByTestId('canvas-object-handoff').getByTestId('materialize-surface');
  await expect(handoff).toHaveAttribute('data-state','ready');
  await expect(handoff.locator('.materialize-surface__content')).not.toHaveAttribute('inert','');
  expect(await page.locator('[data-testid="materialize-surface"]:not([data-state="ready"])').count()).toBe(0);
  checks.push('Skipping final reading completes all eight surfaces without an inert skeleton');
  expect(errors).toEqual([]);
  await writeFile(`${output}/report.json`,JSON.stringify({checks,errors},null,2));
  console.log(JSON.stringify({checks,errors}));
}finally{await browser.close()}
