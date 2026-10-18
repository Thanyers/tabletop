import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

const arg=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]||fallback;
const selected=arg('case','all'),cases=selected==='all'?['shipping','quest','music']:[selected];
const width=Number(arg('width','1600')),height=Number(arg('height','900')),speed=arg('speed','1');
const base=process.env.TRIO_URL||'http://127.0.0.1:5173/';
const root=process.env.TRIO_REPORT_DIR||`test-results/trio-${width}x${height}-${speed}x`;
await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[];
try{
 for(const id of cases){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{
   window.__trioTrace=[];let last='';
   const record=()=>{const p=document.querySelector('[data-testid="trio-player"]'),s=document.querySelector('[data-testid="trio-stage"]');if(!p)return;const bounds=s?.getBoundingClientRect();const visibleSamples=[...document.querySelectorAll('[data-testid="verification-sample"]')].filter(el=>{const r=el.getBoundingClientRect();return bounds&&r.width>0&&Math.min(r.bottom,bounds.bottom)-Math.max(r.top,bounds.top)>Math.min(70,r.height*.4);}).map(el=>el.getAttribute('data-sample-id'));const v={at:performance.now(),step:p.getAttribute('data-step'),phase:p.getAttribute('data-phase'),level:s?.getAttribute('data-level'),request:document.querySelector('[data-testid="trio-request"]')?.textContent,examples:document.querySelectorAll('[data-testid="verification-sample"]').length,visibleSamples};const key=JSON.stringify({...v,at:0});if(key!==last){last=key;window.__trioTrace.push(v);}};
   new MutationObserver(record).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-step','data-phase','data-level','data-sample-id']});setInterval(record,100);
  });
  await page.goto(base);await page.getByTestId('trio-hub').waitFor();
  await expect(page.locator('[data-testid^="case-"]')).toHaveCount(3);
  await page.screenshot({path:`${root}/hub-${id}.png`});
  const began=Date.now();await page.getByTestId(`case-${id}`).getByRole('button',{name:'เริ่มจากพื้นที่ว่าง',exact:true}).click();
  const player=page.getByTestId('trio-player');await player.waitFor();
  if(speed!=='1')await page.getByLabel('Story playback speed',{exact:true}).selectOption(speed);
  const captured=new Set(),geometry=[];
  while(Date.now()-began<180000){
   const state=await player.evaluate(el=>({step:el.getAttribute('data-step'),phase:el.getAttribute('data-phase')}));
   if(state.phase==='reading'&&!captured.has(state.step)){
    captured.add(state.step);
    await page.waitForTimeout(speed==='1'?420:140);
    geometry.push(await page.evaluate(()=>{const p=document.querySelector('[data-testid="trio-player"]'),r=p.getBoundingClientRect();return {step:p.getAttribute('data-step'),overflow:document.documentElement.scrollWidth>innerWidth,player:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight}};}));
    await page.screenshot({path:`${root}/${id}-${state.step}.png`});
   }
   if(state.phase==='complete')break;
   await page.waitForTimeout(100);
  }
  await expect(player).toHaveAttribute('data-phase','complete');
  await expect(page.getByLabel('Replay story',{exact:true})).toBeVisible();
  const trace=await page.evaluate(()=>window.__trioTrace),elapsedMs=Date.now()-began;
  await writeFile(`${root}/${id}-observed.json`,JSON.stringify({id,width,height,speed,elapsedMs,geometry,trace,errors,status:await page.getByTestId('trio-status').innerText()},null,2));
  const steps=['sources','minimal','notice','teach','verify','approve','simulate','handoff'];
  expect([...new Set(trace.map(x=>x.step))]).toEqual(steps);
  for(const phase of ['typing','thinking','building','reading'])expect(trace.some(x=>x.phase===phase),`${id} presents ${phase}`).toBe(true);
  const teach=trace.filter(x=>x.step==='teach'),thinkCycles=teach.filter((x,i)=>x.phase==='thinking'&&(i===0||teach[i-1].phase!=='thinking')).length;
  expect(thinkCycles,`${id} one Teach thinking cycle`).toBe(1);
  expect(trace.some(x=>x.step==='sources'&&Number(x.level)===0),`${id} begins without finished objects`).toBe(true);
  expect(Math.max(...trace.map(x=>x.examples)),`${id} real representative examples`).toBeGreaterThanOrEqual(1);
  if(speed==='1')expect(new Set(trace.filter(x=>x.step==='verify').flatMap(x=>x.visibleSamples).filter(Boolean)).size,`${id} four actual examples visible during verification`).toBeGreaterThanOrEqual(4);
  for(const g of geometry){expect(g.overflow,`${id}/${g.step} horizontal overflow`).toBe(false);expect(g.player.x).toBeGreaterThanOrEqual(-1);expect(g.player.right).toBeLessThanOrEqual(width+1);expect(g.player.bottom).toBeLessThanOrEqual(height+1);}
  await expect(page.getByTestId('active-rule-summary')).toBeVisible();
  await expect(page.getByTestId('trio-handoff')).toContainText(/รอ|ตรวจ|รับช่วง|ส่งต่อ/);
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-version','2');
  await page.screenshot({path:`${root}/${id}-complete.png`});
  expect(errors).toEqual([]);
  const report={id,width,height,speed:Number(speed),elapsedMs,thinkCycles,steps:[...captured],geometry,trace,errors};reports.push(report);
  await writeFile(`${root}/${id}-report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({id,elapsedMs,thinkCycles,scenes:steps.length,errors}));
  await context.close();
 }
 await writeFile(`${root}/report.json`,JSON.stringify({reports},null,2));
}catch(error){await writeFile(`${root}/failure.json`,JSON.stringify({error:String(error),reports},null,2));throw error;}finally{await browser.close();}
