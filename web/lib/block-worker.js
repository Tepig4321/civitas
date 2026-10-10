/* Decompression, parsing and polygon unions run outside the map's UI thread. */
importScripts('../vendor/polygon-clipping.umd.js');
const cache=new Map();
self.onmessage=async ({data})=>{
  try {
    if(data.operation==='union') {
      const groups={};
      for(const [key,polygons] of Object.entries(data.groups)) {
        // Pairwise chunks avoid exceeding JavaScript's argument limit in dense cities.
        let result=[];
        for(let i=0;i<polygons.length;i+=100)result=polygonClipping.union(result,...polygons.slice(i,i+100));
        groups[key]=result;
      }
      self.postMessage({id:data.id,groups});return;
    }
    let doc=cache.get(data.url);
    if(!doc) {
      const response=await fetch(data.url);
      if(!response.ok)throw new Error('Could not load block data ('+response.status+')');
      const body=data.url.endsWith('.gz') ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
      doc=JSON.parse(await new Response(body).text());
      cache.set(data.url,doc);
      if(cache.size>3)cache.delete(cache.keys().next().value);
    }
    const parents={},index=doc.parents[data.geography];
    let project;
    if(data.projection) {
      const p=data.projection,D=Math.PI/180,n=(Math.sin(p.lat1*D)+Math.sin(p.lat2*D))/2;
      const C=Math.cos(p.lat1*D)**2+2*n*Math.sin(p.lat1*D),rho0=Math.sqrt(C-2*n*Math.sin(p.lat0*D))/n,lam0=p.lon0*D;
      project=point=>{const rho=Math.sqrt(C-2*n*Math.sin(point[1]*D))/n,th=n*(point[0]*D-lam0);return [(rho*Math.sin(th)-p.xmin)*p.scale,(p.ymax-(rho0-rho*Math.cos(th)))*p.scale];};
    }
    for(const id of data.parents){
      if(!index?.[id])throw new Error('Missing block data for '+id);
      parents[id]=index[id].map(i=>{const rec=doc.atoms[i];return project?{...rec,world:true,polygons:rec.polygons.map(poly=>poly.map(ring=>ring.map(project)))}:rec;});
    }
    self.postMessage({id:data.id,parents,statKeys:doc.statKeys});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
