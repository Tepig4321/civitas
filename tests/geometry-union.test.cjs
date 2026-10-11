const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const polygonClipping=require('../web/vendor/polygon-clipping.umd.js');
const U=require('../web/lib/geometry-union.js');
const fixture=name=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/union',name+'.json'),'utf8'));
// The union used before this fix: every chunk of 100 re-sweeps the whole accumulated prefix.
const chunked=polys=>{let r=[];for(let i=0;i<polys.length;i+=100)r=polygonClipping.union(r,...polys.slice(i,i+100));return r;};
const square=(x,y,w=1,h=w)=>[[[x,y],[x+w,y],[x+w,y+h],[x,y+h],[x,y]]];
const holes=geom=>geom.reduce((n,poly)=>n+poly.length-1,0);
const rawArea=geoms=>geoms.reduce((n,g)=>n+U.geomArea(g),0);
const rawPerimeter=geoms=>geoms.reduce((n,g)=>n+U.geomPerimeter(g),0);
const inRing=(x,y,r)=>{let c=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>y)!==(r[j][1]>y)&&x<(r[j][0]-r[i][0])*(y-r[i][1])/(r[j][1]-r[i][1])+r[i][0])c=!c;return c;};
const covers=(geom,[x,y])=>geom.some(poly=>inRing(x,y,poly[0])&&!poly.slice(1).some(h=>inRing(x,y,h)));
const at100000x=1e-5; // world units per CSS pixel at the maximum zoom (one world unit is about one pixel at 1x)

// Real Los Angeles inputs captured from data revision manifest 5c8c6ce0…, atoms 0b7fcf18… (before repair).
for(const [name,baseline] of [
  ['ca-bg-lancaster-060379009012',/Unable to find segment/],
  ['ca-bg-palmdale-060379104041',/Unable to find segment/],
  ['ca-lancaster-district-pair',/Unable to find segment/],
  ['la-unmapped-step-output-ring',/Unable to complete output ring/],
  ['ca-bg-palmdale-060379102102',null],
]) test(`real reproducer ${name} merges on the 1e-7 grid without changing its input`,()=>{
  const {polygons}=fixture(name),before=JSON.stringify(polygons);
  if(baseline)assert.throws(()=>chunked(polygons),baseline,'baseline union should fail on this input');
  const result=U.robustUnion(polygons);
  assert.equal(JSON.stringify(polygons),before,'caller input is not modified');
  assert.equal(result.grid,1e-7);
  assert.ok(result.polygons.length>0);
  // The largest vertex move is invisible at the 100,000x maximum zoom.
  assert.ok(result.grid*Math.SQRT1_2<at100000x/100);
  assert.ok(result.outputArea<=rawArea(polygons)+result.grid*Math.SQRT1_2*rawPerimeter(polygons));
  // Already-snapped input gives the same outline.
  assert.equal(JSON.stringify(U.robustUnion(U.snapPolygons(polygons,1e-7)).polygons),JSON.stringify(result.polygons));
});

test('a failed reduction step is re-snapped and retried instead of failing the outline',()=>{
  const {polygons}=fixture('la-unmapped-step-output-ring');
  assert.throws(()=>polygonClipping.union(...polygons),/Unable to complete output ring/);
  const collapsed=[],merged=U.balancedUnion(polygons,8,1e-7,collapsed);
  assert.ok(merged.length>0);assert.ok(collapsed.every(c=>c.width<=U.QUANTUM));
});

test('every populated fragment of the real Los Angeles strip survives the union',()=>{
  const strip=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/geometry/los-angeles-strip.json'),'utf8'));
  const p=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/block-v1/CA/geometry/manifest.json'),'utf8')).projection;
  const D=Math.PI/180,n=(Math.sin(p.lat1*D)+Math.sin(p.lat2*D))/2,C=Math.cos(p.lat1*D)**2+2*n*Math.sin(p.lat1*D),rho0=Math.sqrt(C-2*n*Math.sin(p.lat0*D))/n,lam0=p.lon0*D;
  const project=pt=>{const rho=Math.sqrt(C-2*n*Math.sin(pt[1]*D))/n,th=n*(pt[0]*D-lam0);return [(rho*Math.sin(th)-p.xmin)*p.scale,(p.ymax-(rho0-rho*Math.cos(th)))*p.scale];};
  const atoms=strip.atoms.map(a=>({...a,world:a.polygons.map(poly=>poly.map(ring=>ring.map(project)))}));
  const result=U.robustUnion(atoms.map(a=>a.world));
  assert.equal(result.grid,1e-7);assert.equal(result.droppedRings,0);
  for(const a of atoms.filter(a=>a.required))for(const poly of a.world){
    const probe=U.interiorPoint(poly);
    assert.ok(covers(result.polygons,probe.point),a.id+' is covered');
  }
  // A grid coarse enough (about 0.57 m) to collapse a fragment is rejected rather than losing it.
  assert.throws(()=>U.robustUnion(atoms.map(a=>a.world),{grids:[1e-3]}),/collapse|missing/);
});

test('a narrow populated piece and a narrow real hole are preserved, or the grid is rejected',()=>{
  // 2e-6 world units is about 1 mm: far below a pixel at 1x, about 0.2 px at 100,000x.
  const w=2e-6,strip=[[[10,9.5],[11,9.5],[11,9.5+w],[10,9.5+w],[10,9.5]]];
  const left=square(9,9),right=square(11,9);
  const piece=U.robustUnion([left,strip,right]);
  assert.ok(Math.abs(piece.outputArea-(2+w))<1e-9,'strip area kept');
  assert.equal(piece.polygons.length,1,'the strip still joins both blocks');
  const withHole=[[[0,0],[4,0],[4,4],[0,4],[0,0]],[[1,1],[3,1],[3,1+w],[1,1+w],[1,1]]];
  const hole=U.robustUnion([withHole]);
  assert.equal(holes(hole.polygons),1,'narrow hole kept');
  assert.ok(Math.abs(hole.outputArea-(16-2*w))<1e-9);
  for(const input of [[left,strip,right],[withHole]])assert.throws(()=>U.robustUnion(input,{grids:[1e-5]}),/wider than 1e-7 collapse/);
});

test('an enclave inside noisy neighbouring blocks survives as a hole',()=>{
  const noise=v=>v+(Math.sin(v*977)*1e-12);
  const blocks=[];
  for(const [x,y,w,h] of [[0,0,10,4],[0,6,10,4],[0,4,4,2],[6,4,4,2]])blocks.push(square(x,y,w,h).map(r=>r.map(p=>[noise(p[0]),noise(p[1])])));
  const result=U.robustUnion(blocks);
  assert.equal(result.polygons.length,1);assert.equal(holes(result.polygons),1);
  assert.ok(Math.abs(Math.abs(U.ringArea(result.polygons[0][1]))-4)<1e-6);
  assert.ok(Math.abs(result.outputArea-96)<1e-6);
});

test('ring area is computed without cancellation at world coordinates near 1000',()=>{
  const top=1000+2e-12,sliver=[[1000,1000],[1001,1000],[1000.5,top],[1000,1000]];
  assert.equal(Math.abs(U.ringArea(sliver)),(top-1000)/2);
});

test('balanced reduction matches the chunked union on simple inputs',()=>{
  const tiles=[];for(let x=0;x<23;x++)for(let y=0;y<11;y++)if((x*7+y*3)%11)tiles.push(square(x,y));
  const a=U.balancedUnion(tiles),b=chunked(tiles);
  assert.equal(a.length,b.length);assert.equal(holes(a),holes(b));
  assert.ok(Math.abs(U.geomArea(a)-U.geomArea(b))<1e-9);
  const vertices=g=>g.flat(2).map(p=>p.join(',')).sort();
  assert.deepEqual([...new Set(vertices(a))],[...new Set(vertices(b))]);
  assert.deepEqual(U.balancedUnion([]),[]);
});

test('snapping reports every collapsed ring with its width and never edits its input',()=>{
  const zeroWidth=[[[0,0],[1,0],[1,1e-9],[0,1e-9],[0,0]]];
  const repeated=[[[5,5],[5.00000001,5],[6,5],[6,6],[5,6],[5,5]]];
  const input=[zeroWidth,repeated],before=JSON.stringify(input),collapsed=[];
  const out=U.snapPolygons(input,1e-7,collapsed);
  assert.equal(JSON.stringify(input),before);
  assert.equal(out.length,1);assert.deepEqual(out[0][0][0],[[5,5],[6,5],[6,6],[5,6],[5,5]]);
  assert.equal(collapsed.length,1);assert.ok(collapsed[0].width<=U.QUANTUM);
  // Sub-quantum artifacts are dropped and counted, not hidden.
  const result=U.robustUnion([zeroWidth,square(3,3)]);
  assert.equal(result.droppedRings,1);assert.ok(result.droppedArea>0);
});

test('unrecoverable unions throw every attempt; missing pieces are never returned as success',()=>{
  let calls=0;
  const failing={polygonClipping:{union(){calls++;throw new Error('sweep '+calls);}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/lib/geometry-union.js'),'utf8'),failing);
  assert.throws(()=>failing.CivitasUnion.robustUnion([square(0,0),square(2,0)]),/grid 1e-7: sweep .*; grid 0\.000001: sweep/);
  const dropping={polygonClipping:{union:(...geoms)=>JSON.parse(JSON.stringify(geoms[0]))}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../web/lib/geometry-union.js'),'utf8'),dropping);
  assert.throws(()=>dropping.CivitasUnion.robustUnion([square(0,0),square(5,0)]),/missing from the union/);
});

function workerSandbox() {
  const posted=[],dir=path.join(__dirname,'../web/lib');
  const sandbox={posted,setTimeout,console,fetch:()=>{throw Error('no fetch in tests');}};
  sandbox.self=sandbox;sandbox.postMessage=message=>posted.push(message);
  sandbox.importScripts=(...files)=>{for(const file of files)vm.runInContext(fs.readFileSync(path.join(dir,file),'utf8'),sandbox);};
  vm.createContext(sandbox);vm.runInContext(fs.readFileSync(path.join(dir,'block-worker.js'),'utf8'),sandbox);
  const settle=count=>new Promise(resolve=>{const poll=()=>posted.length>=count?resolve(posted):setTimeout(poll,1);poll();});
  return {send:data=>sandbox.onmessage({data}),settle};
}
test('worker cancels queued district outlines superseded by a newer request',async()=>{
  const w=workerSandbox();
  for(const id of [1,2,3])w.send({id,operation:'union',groups:{shape:[square(0,0),square(1,0)]},supersede:'district:4'});
  w.send({id:4,operation:'union',groups:{shape:[square(0,0)]},supersede:'district:5'});
  const posted=await w.settle(4);
  assert.deepEqual(posted.filter(m=>m.cancelled).map(m=>m.id),[1,2]);
  const done=posted.filter(m=>!m.cancelled);
  assert.deepEqual(done.map(m=>m.id),[3,4]);
  assert.equal(done[0].groups.shape.length,1);assert.ok(Math.abs(U.geomArea(done[0].groups.shape)-2)<1e-9);
});
test('worker merges a batch of real parents and reports grid and areas per group',async()=>{
  const w=workerSandbox();
  w.send({id:1,operation:'union',groups:{lancaster:fixture('ca-bg-lancaster-060379009012').polygons,palmdale:fixture('ca-bg-palmdale-060379104041').polygons}});
  const [reply]=await w.settle(1);
  assert.equal(Object.keys(reply.errors).length,0);
  assert.equal(reply.grids.lancaster,1e-7);assert.equal(reply.grids.palmdale,1e-7);
  for(const [input,output] of Object.values(reply.areas))assert.ok(output<=input+1e-9&&(input-output)/input<1e-4);
});
