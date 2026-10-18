import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
try{
 await page.goto('http://127.0.0.1:4173/');await page.getByTestId('start-accounting').click();await page.getByTestId('object-knowledge').waitFor();await page.getByRole('button',{name:'Keep workspace',exact:true}).click();const saved=await page.evaluate(()=>localStorage.getItem('living-canvas.workspaces.v1'));
 await page.getByRole('button',{name:'Watch demo',exact:true}).click();await page.getByLabel('Demo playback speed').selectOption('16');await expect(page.getByLabel('Replay demo')).toBeVisible({timeout:180000});await expect(page.getByTestId('workspace-overview')).toContainText('36 months');await expect(page.getByTestId('workspace-overview')).toContainText('20 exceptions');expect(await page.evaluate(()=>localStorage.getItem('living-canvas.workspaces.v1'))).toBe(saved);
 await page.getByLabel('Close guided demo').click();await page.getByRole('button',{name:'Constellation',exact:true}).click();await expect(page.getByTestId('knowledge-constellation')).toBeVisible();await page.getByRole('button',{name:'Readable list',exact:true}).click();await expect(page.getByLabel('Knowledge list')).toBeVisible();expect(errors).toEqual([]);
 const report={checks:['Built app runs the complete guided work/teach/knowledge/handoff/reopen loop','Guided production save preserves normal saved work','Built semantic lens and readable list are functional'],errors};console.log(JSON.stringify(report,null,2));await writeFile('test-results/production-demo-report.json',JSON.stringify(report,null,2));
}catch(e){await page.screenshot({path:'test-results/production-failure.png'});throw e;}finally{await browser.close();}
