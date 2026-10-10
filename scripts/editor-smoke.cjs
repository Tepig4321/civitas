// Real worker, Canvas and IndexedDB integration; all maps live in an isolated profile.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {_electron:electron}=require('playwright');
(async()=>{
 const profile=await fs.mkdtemp(path.join(os.tmpdir(),'civitas-editor-'));
 let app;const errors=[];
 try {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await electron.launch({args:['.',`--user-data-dir=${profile}`],env,timeout:60000});
  await app.context().route('https://**',route=>route.abort());
  app.context().setDefaultTimeout(120000);
  const page=await app.firstWindow();page.on('pageerror',e=>{errors.push(e.message);console.error('Renderer:',e.message);});
  await page.locator('#home-create-btn').waitFor();
  for(const geography of ['precinct','blockgroup']) {
   console.log('Editor integration:',geography);
   await page.selectOption('#home-geo-select',geography);await page.fill('#home-district-count','2');await page.click('#home-create-btn');
   await page.locator('#loading').waitFor({state:'hidden'});
   await page.evaluate(()=>CivitasApp.ready());
   await page.waitForFunction(()=>CivitasApp.editor.parents.length>0);
   await page.fill('#map-name-input','Editor '+geography);await page.locator('#map-name-input').blur();
   const opened=await page.evaluate(async()=>{
    const e=CivitasApp.editor,p=e.parents.find(p=>p.county==='Alpine'&&p.pop20>10);
    if(!p)throw Error('Missing Alpine fixture');
    e.apply(p,'paint','unit',1,{});e.endStroke();
    const n=e.history.commands.length;await e.openBlocks(p);
    if(!e.opened)throw Error(document.getElementById('editor-status').textContent);
    const a=p._children.find(a=>a.pop20>0&&a.pop20<p.pop20);
    if(!a)throw Error('No populated block in fixture');
    window.fixtureParent=p;window.fixtureAtom=a;
    e.apply(a,'paint','block',2,{});e.endStroke();
    return {id:p._id,parent:p.pop20,child:a.pop20,openingWasViewOnly:e.history.commands.length===n+1,total:CivitasApp.getStats().totals.pop20};
   });
   assert.equal(opened.openingWasViewOnly,true);
   assert.equal(await page.evaluate(()=>CivitasApp.getStats().districts[2].pop20),opened.child);
   await page.click('#block-done');
   assert.equal(await page.evaluate(()=>CivitasApp.getShapes().filter(s=>s._parent===fixtureParent).length),2);
   await page.click('#editor-undo');await page.waitForFunction(()=>fixtureAtom.districtId===1);
   await page.click('#editor-redo');await page.waitForFunction(()=>fixtureAtom.districtId===2);
   await page.selectOption('#population-basis','adjusted');
   assert.equal(await page.evaluate(()=>CivitasApp.getStats().basis),'adjusted');
   await page.locator('#map-name-input').blur();
   await app.evaluate(({Menu,BrowserWindow})=>Menu.getApplicationMenu().items.find(i=>i.label==='Edit').submenu.items.find(i=>i.label==='Undo').click(null,BrowserWindow.getAllWindows()[0]));
   await page.waitForFunction(()=>CivitasApp.getStats().basis==='census',{},{timeout:10000});
   await page.fill('#district-count-input','1');await page.locator('#district-count-input').dispatchEvent('change');
   await page.waitForFunction(()=>fixtureAtom.districtId===null);
   await page.click('#editor-undo');await page.waitForFunction(()=>fixtureAtom.districtId===2);
   const state=await page.evaluate(()=>CivitasApp.editor.snapshot());
   assert.equal(await page.evaluate(async()=>CivitasApp.restore('Bad',{version:2,state:'CA',dataset:'future',count:2})),false);
   assert.deepEqual(await page.evaluate(()=>CivitasApp.editor.snapshot()),state);
   assert.equal(await page.evaluate(()=>CivitasApp.save()),true);
   const failedSave=await page.evaluate(async()=>{
    const original=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(stores,mode,...args){if(mode==='readwrite')throw new Error('Simulated storage failure');return original.call(this,stores,mode,...args);};
    try{return await CivitasApp.save();}finally{IDBDatabase.prototype.transaction=original;}
   });
   assert.equal(failedSave,false);assert.equal(await page.evaluate(()=>CivitasApp.save()),true);
   // Discover the catalogue key rather than depend on its legacy spelling.
   const payload=await page.evaluate(name=>{
    for(const key of CivitasApp.storage.keys()) {try {const doc=JSON.parse(CivitasApp.storage.getItem(key));if(doc&&doc[name])return doc[name];}catch{}}
   },'Editor '+geography);
   assert.ok(payload?.unitAssignments);assert.ok(payload.history.commands.length>0);
   await page.evaluate(({payload,name})=>CivitasApp.restore(name,payload),{payload,name:'Editor '+geography});
   assert.deepEqual(await page.evaluate(()=>CivitasApp.editor.snapshot()),state);
   assert.equal(await page.evaluate(()=>CivitasApp.getStats().totals.pop20),opened.total);
   await page.click('#nav-home');
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: real block worker, split totals, grouping, native history, deletion, transactional saves and restores, both geographies, offline.');
 }finally {
  if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy()));await app.close();}
  await fs.rm(profile,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
