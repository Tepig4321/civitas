// Compare real Canvas rendering on a dense county, using an isolated development profile.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {_electron:electron}=require('playwright');
(async()=>{
 const source=process.argv[2]||'.',label=process.argv[3]||'current';
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'civitas-render-'));let app;
 try {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:[source,`--user-data-dir=${profile}`],env});
  await app.context().route('https://**',r=>r.abort());
  const page=await app.firstWindow();page.on('pageerror',e=>console.error('Renderer',e.message));await page.waitForFunction(()=>!!window.CivitasApp);await page.selectOption('#home-geo-select','precinct');await page.locator('#home-create-btn').dispatchEvent('click');await page.waitForFunction(()=>!document.getElementById('app-view').hidden);
  await page.evaluate(()=>CivitasApp.ready());
  const result=await page.evaluate(async()=>{
   const doc=await (await fetch('data/block-v1/CA/geometry/precincts-los-angeles.json')).json();
   const shapes=doc.records.map(r=>({...r,_id:r.county+'|'+r.precinct,rings:r.d.split(' Z').filter(s=>s.trim()).map(s=>s.trim().replace(/^M\s*/,'').split(/\s+/).map(p=>p.split(',').map(Number))),paths:[null,null,null],fill:'#2375cb',districtId:null,bboxArea:(r.bbox[2]-r.bbox[0])*(r.bbox[3]-r.bbox[1]),dem:10,rep:0,other:0,margin:1}));
   CivitasApp.editor.initialize(shapes);await CivitasApp.editor.ready;
   const render=()=>document.getElementById('border-slider').dispatchEvent(new Event('input'));
   render();render();
   const samples=[];for(let i=0;i<30;i++){const start=performance.now();render();samples.push(performance.now()-start);}
   samples.sort((a,b)=>a-b);
   return {shapes:shapes.length,vertices:shapes.reduce((n,s)=>n+s.rings.reduce((m,r)=>m+r.length,0),0),medianMilliseconds:samples[15],p95Milliseconds:samples[28]};
  });
  await fs.mkdir('dist',{recursive:true});await page.screenshot({path:`dist/render-${label}.png`});
  console.log(JSON.stringify({label,...result}));
 }finally{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();}await fs.rm(profile,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
