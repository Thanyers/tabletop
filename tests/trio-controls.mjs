import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.TRIO_URL||'http://127.0.0.1:5173/',dir='test-results/trio-controls';await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true}),checks=[],errors=[];
const context=await browser.newContext({viewport:{width:1366,height:768}}),page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const mark=t=>{checks.push(t);console.log(`PASS ${t}`);};
const start=async id=>{await page.getByTestId(`case-${id}`).getByRole('button',{name:'เริ่มจากพื้นที่ว่าง',exact:true}).click();await page.getByTestId('trio-player').waitFor();};
const back=async()=>{await page.getByLabel('Back to stories',{exact:true}).click();await page.getByTestId('trio-hub').waitFor();};
try{
 await page.addInitScript(()=>{localStorage.setItem('living-canvas.workspaces.v1','legacy-test-sentinel');});
 await page.goto(base);await start('quest');await page.getByLabel('Pause story',{exact:true}).click();
 const held=await page.getByTestId('trio-request').innerText(),level=await page.getByTestId('trio-stage').getAttribute('data-level');
 await page.waitForTimeout(900);expect(await page.getByTestId('trio-request').innerText()).toBe(held);await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-level',level);
 mark('Pause freezes typing and construction');
 await back();await page.waitForTimeout(900);await expect(page.getByTestId('trio-player')).toHaveCount(0);await expect(page.locator('[data-testid^="case-"]')).toHaveCount(3);mark('Leaving a story cancels delayed mutations');

 await start('shipping');await page.getByLabel('Take over workspace',{exact:true}).click();
 for(let i=0;i<5;i++){
  const next=page.getByTestId('trio-continue');if(await next.count()&&await next.isEnabled())await next.click();
 }
 await expect(page.locator('#draft-bangkok')).toBeEnabled();
 await page.locator('#draft-bangkok').fill('35');await page.locator('#draft-regional').fill('45');await page.locator('#draft-effectiveDate').fill('2026-10-15');
 await page.getByLabel('Run example checks',{exact:true}).click();
 await expect(page.locator('[data-testid="verification-sample"].is-failed')).toHaveCount(0);
 mark('Early takeover can continue building and run real examples');
 await back();

 for(const id of ['shipping','quest','music']){
  await start(id);await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase','complete',{timeout:90000});
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-version','2');
  await page.getByLabel('Take over workspace',{exact:true}).click();
  const active=await page.getByTestId('active-rule-summary').innerText();
  const field={shipping:'draft-bangkok',quest:'draft-firstHint',music:'draft-chorusBpm'}[id],good={shipping:'35',quest:'180',music:'80'}[id],wrong={shipping:'34',quest:'120',music:'90'}[id];
  await page.locator(`#${field}`).fill(wrong);await page.getByLabel('Run example checks',{exact:true}).click();
  expect(await page.locator('[data-testid="verification-sample"].is-failed').count()).toBeGreaterThan(0);
  await expect(page.getByLabel('Approve tested rule',{exact:true})).toBeDisabled();
  expect(await page.getByTestId('active-rule-summary').innerText()).toBe(active);mark(`${id}: wrong candidate fails independently and keeps active rule`);
  await page.locator(`#${field}`).fill(good);await page.getByLabel('Run example checks',{exact:true}).click();await expect(page.locator('[data-testid="verification-sample"].is-failed')).toHaveCount(0);
  await page.locator(`#${field}`).fill(wrong);await expect(page.getByLabel('Approve tested rule',{exact:true})).toBeDisabled();mark(`${id}: editing after checks invalidates approval`);
  await page.locator(`#${field}`).fill(good);await page.getByLabel('Run example checks',{exact:true}).click();
  const slider=page.getByTestId('simulation-control'),before=await slider.inputValue();await slider.focus();await slider.press('ArrowRight');expect(await slider.inputValue()).not.toBe(before);
  expect(await page.getByTestId('active-rule-summary').innerText()).toBe(active);mark(`${id}: interactive simulation leaves active rules unchanged`);
  await page.getByLabel('Open work knowledge',{exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();expect(await page.locator('.trio-knowledge__map [data-event-id]').count()).toBeGreaterThanOrEqual(8);expect(await page.locator('.trio-knowledge__edges > path').count()).toBeGreaterThanOrEqual(5);await page.getByLabel('Close work knowledge',{exact:true}).click();mark(`${id}: recorded source/test/approval references open in knowledge`);
  await page.getByLabel('Save workspace',{exact:true}).click();await expect(page.locator('.trio-workspace__footer')).toContainText('บันทึก');
  const raw=await page.evaluate(id=>localStorage.getItem(`procedural.trio.manual.v1.${id}`),id);expect(JSON.parse(raw).snapshot.caseId).toBe(id);
  await back();await page.reload();await page.getByTestId(`case-${id}`).getByRole('button',{name:/เปิดงานที่บันทึก/}).click();await expect(page.locator('.trio-workspace')).toHaveAttribute('data-guided','false');expect(await page.getByTestId('active-rule-summary').innerText()).toBe(active);mark(`${id}: saved manual workspace reopens without replay or cross-case replacement`);
  if(id==='quest'){
   await page.getByLabel('Start game timer',{exact:true}).click();await page.waitForTimeout(1150);await page.getByLabel('Pause game timer',{exact:true}).click();const timer=await page.locator('.trio-quest-clock').innerText();await page.waitForTimeout(1100);expect(await page.locator('.trio-quest-clock').innerText()).toBe(timer);mark('Quest timer genuinely pauses');
   await page.getByRole('button',{name:'ทำเครื่องหมายว่าจบ',exact:true}).click();await page.getByLabel('Replay story',{exact:true}).click();await page.getByLabel('Take over workspace',{exact:true}).click();for(let i=0;i<2;i++)await page.getByTestId('trio-continue').click();await expect(page.getByLabel('Start game timer',{exact:true})).toBeEnabled();await expect(page.locator('.trio-quest-clock')).toContainText('0:00');mark('Replay resets the solved game and its clock');
  }
  if(id==='music'){
   await page.getByLabel('Start metronome',{exact:true}).click();await page.waitForTimeout(900);await page.getByLabel('Stop metronome',{exact:true}).click();await page.getByLabel('Mark late entry',{exact:true}).click();await expect(page.getByTestId('trio-main')).toContainText('เข้าช้า');await page.getByLabel('Save workspace',{exact:true}).click();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('procedural.trio.manual.v1.music')));expect(saved.snapshot.events.some(e=>e.kind==='source'&&e.title==='บันทึกจากคนซ้อม')).toBe(true);mark('Music visual metronome works and human feedback is saved in evidence');
  }
  await page.screenshot({path:`${dir}/${id}-manual.png`});await back();
 }
 expect(await page.evaluate(()=>localStorage.getItem('living-canvas.workspaces.v1'))).toBe('legacy-test-sentinel');mark('Three stories preserve the previous workspace storage');
 expect(errors).toEqual([]);
 await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors},null,2));
}catch(error){await page.screenshot({path:`${dir}/failure.png`});await writeFile(`${dir}/report.json`,JSON.stringify({checks,errors,error:String(error)},null,2));throw error;}finally{await context.close();await browser.close();}
