import {chromium,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const speed=process.argv.includes('--fast')?'16':'1';
const dir=process.env.VIDEO_REPORT_DIR||`test-results/video-demo-${speed}x`;await mkdir(dir,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1600,height:900}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.addInitScript(()=>{
  window.__videoTrace=[];let last='';
  const record=()=>{const p=document.querySelector('[data-testid="demo-player"]');if(!p)return;const label=document.querySelector('[data-demo-cue]'),target=document.querySelector('.demo-attention__target');const visible=el=>!!el&&el.getBoundingClientRect().width>0&&getComputedStyle(el).display!=='none'&&getComputedStyle(el).visibility!=='hidden';const data={at:performance.now(),scene:p.getAttribute('data-scene'),stage:p.getAttribute('data-stage'),phase:p.getAttribute('data-phase'),draft:document.querySelector('[data-testid="asset-policy-draft"]')?.getAttribute('data-demo-draft-stage'),cue:label?.getAttribute('data-demo-cue'),visibleCue:visible(label)||visible(target)?label?.getAttribute('data-demo-cue'):null,inspectorHeight:Math.round(document.querySelector('.inspector')?.getBoundingClientRect().height||0)};const key=JSON.stringify({...data,at:0});if(key!==last){last=key;window.__videoTrace.push(data);}};
  new MutationObserver(record).observe(document,{subtree:true,childList:true,attributes:true,attributeFilter:['data-stage','data-phase','data-scene','data-demo-draft-stage','data-demo-cue']});
  setInterval(record,80);
 });
 await page.goto(process.env.VIDEO_BASE_URL||'http://127.0.0.1:5173/');const started=Date.now();await page.getByTestId('watch-demo').click();if(speed!=='1')await page.getByLabel('Demo playback speed').selectOption(speed);
 const screenshots=new Set();while(Date.now()-started<180000){const current=await page.getByTestId('demo-player').evaluate(el=>({scene:el.getAttribute('data-scene'),phase:el.getAttribute('data-phase'),draft:document.querySelector('[data-testid="asset-policy-draft"]')?.getAttribute('data-demo-draft-stage')}));const key=current.phase==='reading'?current.scene:current.scene==='teach'&&['threshold-set','life-set','schedule-set'].includes(current.draft)?'teach-'+current.draft:null;if(key&&!screenshots.has(key)){screenshots.add(key);await page.screenshot({path:`${dir}/${key}.png`});}if(current.phase==='complete')break;await page.waitForTimeout(100);}
 await expect(page.getByLabel('Replay demo',{exact:true})).toBeVisible();
 const trace=await page.evaluate(()=>window.__videoTrace);const teach=trace.filter(x=>x.scene==='teach'),thinking=teach.filter((x,i)=>x.stage==='thinking'&&(i===0||teach[i-1].stage!=='thinking')).length;
 const scenes=[...new Set(trace.map(x=>x.scene))];const report={speed:Number(speed),elapsedMs:Date.now()-started,thinkingCyclesInTeach:thinking,scenes,trace,errors};await writeFile(`${dir}/report.json`,JSON.stringify(report,null,2));await page.screenshot({path:`${dir}/complete.png`});
 expect(scenes).toHaveLength(10);expect(thinking,'Teach must think once, then draft continuously').toBe(1);expect(trace.some(x=>x.visibleCue),'The story must visibly point at the referenced UI').toBe(true);expect(errors).toEqual([]);if(speed==='1'){
  expect(report.elapsedMs,'Main story should play like a short video without long idle holds').toBeLessThan(110000);
  for(const cue of ['table-compare','fa001-calculated','draft-threshold','draft-life','draft-start','evaluation','approval-proof','experiment-proof','knowledge','handoff','overview'])expect(trace.some(x=>x.visibleCue===cue),`${cue} must be visibly pointed out`).toBe(true);
  const heights=teach.filter(x=>x.inspectorHeight>0).map(x=>x.inspectorHeight);expect(Math.max(...heights)-Math.min(...heights),'The setting container must grow with the generated controls').toBeGreaterThan(30);
  for(const scene of scenes.slice(0,-1)){const reading=trace.find(x=>x.scene===scene&&x.phase==='reading');const next=reading&&trace.find(x=>x.at>reading.at&&x.scene!==scene);if(reading&&next)expect(next.at-reading.at,`${scene} must not leave a long idle gap`).toBeLessThan(3600);}
 }
 console.log(JSON.stringify({elapsedMs:report.elapsedMs,thinkingCyclesInTeach:thinking,scenes:scenes.length,errors},null,2));
}catch(e){await page.screenshot({path:`${dir}/failure.png`});throw e;}finally{await browser.close();}
