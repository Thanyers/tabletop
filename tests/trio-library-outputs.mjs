import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
const base=process.env.TRIO_URL||'http://127.0.0.1:4173/',out=process.env.TRIO_REPORT_DIR||'test-results/library-outputs-v13';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
try{
 for(const id of ['shipping','quest','music']){
  const context=await browser.newContext({viewport:{width:1600,height:900}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(base);await page.getByTestId('case-'+id).click();
  await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');await page.getByLabel('Start demo',{exact:true}).click();
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-level','2',{timeout:15000});
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-step','notice',{timeout:10000});
  const surface=page.getByTestId('trio-adaptive-surface');
  const preserved=await page.getByTestId('adaptive-surface-original-tools').elementHandle();
  await page.getByTestId('adaptive-surface-options').click();
  await expect(page.getByLabel('Resume story',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Follow interactions',{exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(surface.getByRole('radio')).toHaveCount(3);
  await expect(surface.getByText('แนะนำ',{exact:true})).toBeVisible();
  await page.waitForTimeout(650);const card=await page.getByTestId('canvas-object-minimal').boundingBox(),canvas=await page.getByTestId('trio-stage').boundingBox();expect(card.y).toBeGreaterThanOrEqual(canvas.y-5);expect(card.y).toBeLessThan(canvas.y+75);await page.screenshot({path:out+'/'+id+'-choices.png'});
  const alternatives=id==='shipping'?['cards','chart']:id==='quest'?['table','cards']:['table','chart'];
  for(const choice of alternatives){
   if(!(await page.getByTestId('adaptive-surface-choice-'+choice).isVisible()))await page.getByTestId('adaptive-surface-options').click();
   await page.getByTestId('adaptive-surface-choice-'+choice).click();
   await expect(surface).toHaveAttribute('data-presentation',choice);
   await expect(page.getByTestId('adaptive-surface-view-'+choice)).toBeVisible();
   expect(await preserved.evaluate(el=>el.isConnected)).toBe(true);
   await expect(page.getByTestId('adaptive-surface-original-tools')).toBeHidden();
   await page.getByTestId('adaptive-surface-tools').click();await expect(page.getByTestId('adaptive-surface-original-tools')).toBeVisible();
  }
  await surface.locator('.trio-adaptive-surface__connections > summary').click();
  await expect(surface.locator('.trio-adaptive-surface__connections')).toHaveAttribute('open','');
  await expect(surface.locator('.trio-adaptive-surface__connections')).toContainText('ยังไม่เชื่อมบริการภายนอก');
  await page.getByTestId('adaptive-surface-options').click();await page.getByTestId('adaptive-surface-choice-original').click();
  await expect(page.getByTestId('adaptive-surface-original-tools')).toBeVisible();
  checks.push(id+': three comparable previews, pause on choice, actual alternate renderers, preserved controls and inspectable binding');
  await page.getByLabel('Resume story',{exact:true}).click();
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase','complete',{timeout:45000});
  const outputs=page.getByTestId('trio-deliverables');
  await expect(outputs.locator('img,iframe')).toHaveCount(0);
  const download=async(label)=>{const pending=page.waitForEvent('download');await outputs.getByRole('button',{name:label}).click();const d=await pending;await d.saveAs(out+'/'+d.suggestedFilename());return {name:d.suggestedFilename(),text:await readFile(out+'/'+d.suggestedFilename(),'utf8')};};
  const csv=await download(/^ดาวน์โหลด CSV /);expect(csv.name).toMatch(/v2.csv$/);expect(csv.text.length).toBeGreaterThan(100);
  const report=await download(/^ดาวน์โหลดรายงาน HTML /);expect(report.name).toBe(id+'-report-v2.html');expect(report.text).toContain('ผลตรวจ Draft ปัจจุบัน');
  await outputs.getByRole('button',{name:'สร้างชิ้นงานภาพ',exact:true}).click();await expect(outputs.getByRole('button',{name:/^ดาวน์โหลดชิ้นงาน /})).toBeVisible();
  const graphic=await download(/^ดาวน์โหลดชิ้นงาน /);
  if(id==='music'){
   expect(graphic.name).toBe('rehearsal-motion-guide-v2.html');expect(graphic.text).toContain('80');expect(graphic.text).toContain('default-src');
   const frame=page.frameLocator('iframe[title="ไกด์จังหวะภาพเคลื่อนไหว · กดเริ่มหรือพักได้"]');
   await expect(frame.getByRole('button',{name:'เริ่มภาพเคลื่อนไหว',exact:true})).toBeVisible();
   expect(await outputs.locator('iframe').getAttribute('sandbox')).toBe('allow-scripts');
   const beat=frame.locator('#beat-number');await expect(beat).toHaveText('1');await frame.getByRole('button',{name:'เริ่มภาพเคลื่อนไหว',exact:true}).click();
   await expect(beat).toHaveText('2',{timeout:2000});
   await frame.getByRole('button',{name:'พักภาพเคลื่อนไหว',exact:true}).click();const frozen=await beat.textContent();await page.waitForTimeout(850);expect(await beat.textContent()).toBe(frozen);
   checks.push('Music motion guide starts paused, plays at the active first-section tempo, and freezes on pause in a script-only sandbox');
  }else{
   expect(graphic.name).toBe(id==='shipping'?'shipping-rate-card-v2.svg':'treasure-route-v2.svg');await expect(outputs.locator('img')).toBeVisible();expect(graphic.text).toContain('<svg');
  }
  checks.push(id+': CSV, HTML report and generated visual files download from Active v2');
  await page.getByLabel('Take over workspace',{exact:true}).click();
  // The persistent original Learn lens focuses this story's original minimal object.
  await page.getByRole('button',{name:'Work',exact:true}).click();
  // Library contract tests are appended after its UI is integrated.
  await page.screenshot({path:out+'/'+id+'-output.png'});
  await context.close();
 }
 expect(errors).toEqual([]);await writeFile(out+'/report.json',JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks:checks.length,errors}));
}finally{await browser.close();}

