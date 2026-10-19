import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';

const arg=(name,fallback)=>process.argv.find(a=>a.startsWith(`--${name}=`))?.split('=')[1]||fallback;
const selected=arg('case','all'),cases=selected==='all'?['shipping','quest','music']:[selected];
const width=Number(arg('width','1600')),height=Number(arg('height','900')),speed=arg('speed','1');
const base=process.env.TRIO_URL||'http://127.0.0.1:5173/';
const root=process.env.TRIO_REPORT_DIR||`test-results/canvas-${width}x${height}-${speed}x`;
await mkdir(root,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const reports=[];
try{
 for(const id of cases){
  const context=await browser.newContext({viewport:{width,height}}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.addInitScript(()=>{
   window.__canvasTrace=[];let last='';
   const record=()=>{const p=document.querySelector('[data-testid="trio-player"]'),s=document.querySelector('[data-testid="trio-stage"]');if(!p||!s)return;const bounds=s.getBoundingClientRect();const visibleSamples=[...document.querySelectorAll('[data-testid="verification-sample"]')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&Math.min(r.bottom,bounds.bottom)-Math.max(r.top,bounds.top)>Math.min(75,r.height*.5)&&r.left<bounds.right&&r.right>bounds.left;}).map(el=>el.getAttribute('data-sample-id'));const v={at:performance.now(),step:p.getAttribute('data-step'),phase:p.getAttribute('data-phase'),level:s.getAttribute('data-level'),nodes:document.querySelectorAll('[data-trio-object]').length,skeletons:document.querySelectorAll('.trio-canvas-skeleton').length,visibleSamples};const key=JSON.stringify({...v,at:0});if(key!==last){last=key;window.__canvasTrace.push(v);}};
   new MutationObserver(record).observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-step','data-phase','data-level','data-sample-id']});setInterval(record,100);
  });
  await page.goto(base);await page.getByTestId('trio-demo-picker').waitFor();
  await expect(page.locator('.workspace-bar .brand')).toBeVisible();
  if(width>760)await expect(page.getByLabel('Canvas tools',{exact:true})).toBeVisible();
  else await expect(page.getByLabel('Canvas tools',{exact:true})).toHaveCount(1);
  await expect(page.locator('.canvas-area .react-flow')).toBeVisible();
  await expect(page.locator('[data-testid^="case-"]')).toHaveCount(3);
  await expect(page.getByTestId('trio-hub')).toHaveCount(0);
  await page.screenshot({path:`${root}/welcome-${id}.png`});
  const originalCanvas=await page.locator('.canvas-area .react-flow').elementHandle();
  await page.getByTestId(`case-${id}`).click();
  expect(await originalCanvas.evaluate(el=>el.isConnected),'original Canvas instance survives story selection').toBe(true);
  const player=page.getByTestId('trio-player');await player.waitFor();
  if(speed!=='1')await page.getByLabel('Story playback speed',{exact:true}).selectOption(speed);
  const began=Date.now();await page.getByLabel('Start demo',{exact:true}).click();
  const captured=new Set(),geometry=[];
  while(Date.now()-began<150000){
   const state=await player.evaluate(el=>({step:el.getAttribute('data-step'),phase:el.getAttribute('data-phase')}));
   if(state.phase==='reading'&&!captured.has(state.step)){
    captured.add(state.step);await page.waitForTimeout(speed==='1'?650:100);
    geometry.push(await page.evaluate(()=>{const player=document.querySelector('[data-testid="trio-player"]'),stage=document.querySelector('[data-testid="trio-stage"]');const p=player.getBoundingClientRect(),s=stage.getBoundingClientRect();const target=document.querySelector(`[data-trio-object="${player.getAttribute('data-step')}"]`),t=target?.getBoundingClientRect();return{step:player.getAttribute('data-step'),overflow:document.documentElement.scrollWidth>innerWidth,stage:{x:s.x,y:s.y,right:s.right,bottom:s.bottom,height:s.height},dock:{x:p.x,y:p.y,right:p.right,bottom:p.bottom},target:t&&{x:t.x,y:t.y,right:t.right,bottom:t.bottom,width:t.width,height:t.height},zoom:document.querySelector('.react-flow__viewport')?.getAttribute('style')};}));
    await page.screenshot({path:`${root}/${id}-${state.step}.png`});
   }
   if(state.phase==='complete')break;
   await page.waitForTimeout(100);
  }
  await expect(player).toHaveAttribute('data-phase','complete');
  await expect(page.getByLabel('Replay story',{exact:true})).toBeVisible();
  const trace=await page.evaluate(()=>window.__canvasTrace),elapsedMs=Date.now()-began;
  const steps=['sources','minimal','notice','teach','verify','approve','simulate','handoff'];
  expect([...new Set(trace.map(x=>x.step))]).toEqual(steps);
  expect(trace.some(x=>x.level==='0'&&x.nodes===0),'blank Canvas before construction').toBe(true);
  expect(trace.some(x=>x.skeletons>0),'actual construction skeleton').toBe(true);
  const teach=trace.filter(x=>x.step==='teach');const thinkCycles=teach.filter((x,i)=>x.phase==='thinking'&&(i===0||teach[i-1].phase!=='thinking')).length;
  expect(thinkCycles).toBe(1);
  expect(Math.max(...trace.map(x=>x.nodes))).toBe(8);
  if(speed==='1')expect(new Set(trace.filter(x=>x.step==='verify').flatMap(x=>x.visibleSamples)).size,'four visible actual verification examples').toBeGreaterThanOrEqual(4);
  for(const g of geometry){expect(g.overflow,`${id}/${g.step} page overflow`).toBe(false);expect(g.stage.bottom,`${id}/${g.step} dock clearance`).toBeLessThanOrEqual(g.dock.y+1);expect(g.target?.right??0,`${id}/${g.step} target intersects`).toBeGreaterThan(40);expect(g.target?.x??width).toBeLessThan(width-20);}
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-version','2');
  await expect(page.getByTestId('canvas-object-handoff')).toContainText(/ยังค้าง/);
  expect(await page.locator('.react-flow__edge').count(),'visible dependencies').toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await page.screenshot({path:`${root}/${id}-complete.png`});
  const report={id,width,height,speed:Number(speed),elapsedMs,thinkCycles,steps:[...captured],geometry,trace,errors};reports.push(report);await writeFile(`${root}/${id}-report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({id,elapsedMs,thinkCycles,nodes:8,scenes:steps.length,errors}));
  await context.close();
 }
 await writeFile(`${root}/report.json`,JSON.stringify({reports},null,2));
}catch(error){await writeFile(`${root}/failure.json`,JSON.stringify({error:String(error),reports},null,2));throw error;}finally{await browser.close();}
