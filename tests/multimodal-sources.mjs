import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const base=process.env.TRIO_URL||'http://127.0.0.1:5173/';
const out='test-results/multimodal-sources';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const checks=[],errors=[];
const mark=s=>{checks.push(s);console.log('PASS '+s)};
async function open(id,width=1440){
 const page=await browser.newPage({viewport:{width,height:width===319?612:960}});
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);await page.getByTestId(`case-${id}`).click();
 await page.getByLabel('Story playback speed',{exact:true}).selectOption('4');
 await page.getByLabel('Start demo',{exact:true}).click();
 const source=page.getByTestId('source-preview');
 await expect(page.getByTestId('canvas-object-sources').getByTestId('materialize-surface')).toHaveAttribute('data-state','ready',{timeout:20000});
 await page.getByLabel('Pause story',{exact:true}).click();
 if(await source.getByTestId('source-evidence').count()) await source.locator('.source-evidence__full').click();
 return {page,source};
}
async function fit(page){
 await page.getByTestId('canvas-object-sources').locator('.trio-canvas-node__chrome').dblclick();
 await page.waitForTimeout(400);
}
async function bounds(page,source){
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 const sizes=await source.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth}));
 expect(sizes.scroll).toBeLessThanOrEqual(sizes.width+1);
}
async function upload(page,source,name,kind){
 await source.locator('input[type=file]').setInputFiles(resolve('public/data',name));
 await expect(source).toHaveAttribute('data-source-kind',kind);
 await expect(source).toHaveAttribute('data-source-local','true');
 await expect(source.locator('header strong')).toHaveText(name);
 await expect(source.locator('[role=alert]')).toHaveCount(0);
}
try{
 const {page,source}=await open('shipping');
 await expect(source.locator('[data-source-record]')).toHaveCount(6);
 expect(await source.evaluate(el=>getComputedStyle(el).borderColor)).toMatch(/^rgba?\((33, 115, 70|22, 132, 71)(, [\d.]+)?\)$/);
 await source.locator('#source-preview-tab-shipping-contract-pdf').click();
 await expect(source.locator('iframe')).toHaveAttribute('src',/shipping-contract\.pdf/);
 expect(await source.evaluate(el=>getComputedStyle(el).borderColor)).not.toMatch(/^rgba?\((33, 115, 70|22, 132, 71)(, [\d.]+)?\)$/);
 const pdf=await page.request.get(`${base}data/shipping-contract.pdf`);expect((await pdf.body()).subarray(0,5).toString()).toBe('%PDF-');
 await page.screenshot({path:`${out}/shipping-pdf.png`});
 await source.locator('#source-preview-tab-shipping-contract-json').click();
 await expect(source.locator('pre')).toContainText('2026-10-15');
 await expect(source.locator('pre')).toContainText('35');
 mark('Shipping keeps a green spreadsheet, with an actual PDF and parsed contract JSON');
 const requests=[];page.on('request',r=>{if(['POST','PUT','PATCH'].includes(r.method()))requests.push(r.url())});
 for(const [name,kind] of [['shipping-orders.csv','sheet'],['general-ledger-2026-09.xlsx','sheet'],['shipping-contract.pdf','pdf'],['quest-route.svg','image'],['music-rehearsal.wav','audio'],['music-rehearsal.webm','video'],['music-notes.json','json']]){
  await upload(page,source,name,kind);
  if(kind==='image')await expect.poll(()=>source.locator('img').evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
  if(kind==='audio'||kind==='video')await expect.poll(()=>source.locator(kind).evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(1);
  if(kind==='sheet')await expect(source.locator('tbody tr')).not.toHaveCount(0);
  if(kind==='json')await expect(source.locator('pre')).toContainText('MU-004');
  if(kind==='pdf')expect(await source.locator('iframe').evaluate(async el=>(await fetch(el.src)).headers.get('content-type'))).toBe('application/pdf');
  mark(`Local ${name} opens as ${kind}`);
 }
 await source.locator('input[type=file]').setInputFiles({name:'broken.json',mimeType:'application/json',buffer:Buffer.from('{not json')});
 await expect(source.getByRole('alert')).toBeVisible();
 await expect(source.locator('pre')).toContainText('MU-004');
 await source.locator('input[type=file]').setInputFiles({name:'fake.pdf',mimeType:'application/pdf',buffer:Buffer.from('<html><script>window.invalidPdf=true</script></html>')});
 await expect(source.getByRole('alert')).toBeVisible();
 expect(await page.evaluate(()=>window.invalidPdf)).toBeUndefined();
 await source.locator('input[type=file]').setInputFiles({name:'pretend.pdf',mimeType:'text/html',buffer:Buffer.from('<!-- %PDF-1.7 --><script>parent.invalidPdf=true</script>')});
 await expect(source.getByRole('alert')).toBeVisible();
 await expect(source.locator('pre')).toContainText('MU-004');
 expect(await page.evaluate(()=>window.invalidPdf)).toBeUndefined();
 await page.evaluate(()=>{
  const original=File.prototype.text;
  File.prototype.text=function(){if(this.name==='slow.json')return new Promise(resolve=>{window.releaseSlowSource=()=>resolve('{"late":true}')});return original.call(this)};
 });
 await source.locator('input[type=file]').setInputFiles({name:'slow.json',mimeType:'application/json',buffer:Buffer.from('{"late":true}')});
 await page.waitForFunction(()=>typeof window.releaseSlowSource==='function');
 await source.locator('#source-preview-tab-shipping-contract-json').click();
 await page.evaluate(()=>window.releaseSlowSource());
 await page.waitForTimeout(250);
 await expect(source.locator('header strong')).toHaveText('shipping-contract.json');
 await source.locator('input[type=file]').setInputFiles({name:'many-rows.csv',mimeType:'text/csv',buffer:Buffer.from('id,value\n'+Array.from({length:150},(_,i)=>`${i},row ${i}`).join('\n'))});
 await expect(source.locator('header strong')).toHaveText('many-rows.csv');
 expect(await source.locator('tbody tr').count()).toBeLessThanOrEqual(100);
 await expect(source).toContainText(/100/);
 mark('PDF MIME is fixed; HTML impersonation is rejected; stale reads cannot replace tabs; large sheets have bounded previews');
 expect(requests).toEqual([]);
 mark('Invalid JSON/PDF preserve current preview and local files trigger no upload writes');
 await page.close();
 for(const width of [1440,319]){
  for(const id of ['quest','music']){
   const {page,source}=await open(id,width);
   await expect(source).toHaveAttribute('data-source-kind',id==='quest'?'image':'audio');
   await expect(source.locator('table')).toHaveCount(0);
   if(id==='quest'){
    await expect.poll(()=>source.locator('img').evaluate(el=>el.naturalWidth)).toBeGreaterThan(0);
    await expect(source.locator('[data-narrative-field=station]')).toHaveCount(3);
   }else{
    const audio=source.locator('audio');await expect.poll(()=>audio.evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(1);
    await expect(source.locator('[data-narrative-record="MU-004"]')).toContainText('100 BPM');
    await audio.evaluate(async el=>{el.muted=true;await el.play()});
    await expect.poll(()=>audio.evaluate(el=>el.currentTime)).toBeGreaterThan(.1);
    const oldAudio=await audio.elementHandle();
    await source.locator('#source-preview-tab-music-video').click();
    expect(await oldAudio.evaluate(el=>el.paused)).toBe(true);
    const video=source.locator('video');await expect.poll(()=>video.evaluate(el=>el.readyState)).toBeGreaterThanOrEqual(1);
    await video.evaluate(async el=>{el.muted=true;await el.play()});
    await expect.poll(()=>video.evaluate(el=>el.currentTime)).toBeGreaterThan(.1);
    const oldVideo=await video.elementHandle();
    await page.getByRole('button',{name:'Constellation',exact:true}).click();
    expect(await oldVideo.evaluate(el=>el.paused)).toBe(true);
    await page.getByRole('button',{name:'Work',exact:true}).click();
    mark(`Music ${width}px plays native audio/video and stops hidden media`);
   }
   await fit(page);await bounds(page,source);
   const styles=await source.evaluate(el=>({source:getComputedStyle(el).borderColor,card:getComputedStyle(el.closest('.trio-canvas-node')).borderColor}));
   expect(styles.source).not.toMatch(/^rgb\((33, 115, 70|22, 132, 71|40, 135, 90)\)$/);
   expect(styles.card).not.toMatch(/^rgb\((33, 115, 70|22, 132, 71|40, 135, 90)\)$/);
   await page.screenshot({path:`${out}/${id}-${width}.png`});
   mark(`${id} ${width}px starts with native source, no green frame or document overflow`);
   await page.close();
  }
 }
 expect(errors).toEqual([]);
 await writeFile(`${out}/report.json`,JSON.stringify({checks,errors},null,2));
}catch(error){await writeFile(`${out}/failure.json`,JSON.stringify({error:String(error),checks,errors},null,2));throw error}finally{await browser.close()}
