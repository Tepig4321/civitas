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
    for(const id of data.parents){
      if(!index?.[id])throw new Error('Missing block data for '+id);
      parents[id]=index[id].map(i=>doc.atoms[i]);
    }
    self.postMessage({id:data.id,parents,statKeys:doc.statKeys});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
