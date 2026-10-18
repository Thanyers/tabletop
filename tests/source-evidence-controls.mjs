import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:960}});
const checks=[];
try {
 await page.goto(process.env.TRIO_URL||'http://127.0.0.1:5173/');
 await page.getByTestId('case-shipping').click();
 await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
 await page.getByLabel('Start demo',{exact:true}).click();
 const player=page.getByTestId('trio-player');
 await expect(player).toHaveAttribute('data-evidence-purpose','create',{timeout:30000});
 await page.getByLabel('Story playback speed',{exact:true}).selectOption('1');
 await page.getByLabel('Next story step',{exact:true}).click();
 await expect(player).toHaveAttribute('data-step','minimal',{timeout:1500});
 checks.push('Next exits create evidence promptly');
 await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
 const minimal=page.getByTestId('canvas-object-minimal');
 await expect(minimal.getByTestId('materialize-surface')).toHaveAttribute('data-state','ready',{timeout:20000});
 await page.getByLabel('Pause story',{exact:true}).click();
 const origin=minimal.getByTestId('evidence-origin');
 await origin.click();
 const source=page.getByTestId('source-preview');
 for(let i=0;i<2;i++) {
  await expect(source.getByTestId('source-evidence')).toBeVisible();
  await source.locator('.source-evidence__full').click();
  await expect(source.getByTestId('source-evidence')).toHaveCount(0);
  // Exercise the same backlink handler while its node is off-camera.
  await origin.dispatchEvent('click');
 }
 checks.push('Repeated same-cue backlink reopens after full preview');
 await source.locator('.source-evidence__full').click();
 await source.locator('input[type=file]').setInputFiles({name:'my-notes.json',mimeType:'application/json',buffer:Buffer.from('{"localMarker":"retained"}')});
 await expect(source.locator('pre')).toContainText('retained');
 await origin.dispatchEvent('click');
 await expect(source.getByTestId('source-evidence')).toBeVisible();
 await source.locator('.source-evidence__full').click();
 await source.locator('[role=tab][id*="local-"]').click();
 await expect(source.locator('pre')).toContainText('retained');
 checks.push('Local parsed file survives guided evidence detour');
 await page.getByLabel('Resume story',{exact:true}).click();
 await expect(player).toHaveAttribute('data-evidence-purpose','revise',{timeout:30000});
 await page.getByLabel('Story playback speed',{exact:true}).selectOption('1');
 const started=Date.now();
 await page.getByLabel('Next story step',{exact:true}).click();
 await expect(player).toHaveAttribute('data-step','teach',{timeout:2000});
 checks.push(`Next exits revise evidence, preserves build and skips reading dwell (${Date.now()-started}ms)`);
 await mkdir('test-results/source-evidence-controls',{recursive:true});
 await writeFile('test-results/source-evidence-controls/report.json',JSON.stringify({checks},null,2));
 console.log(JSON.stringify({checks}));
} finally {await browser.close();}
