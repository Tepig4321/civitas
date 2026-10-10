/* County chunks are decompressed and parsed off the map's UI thread. */
const cache=new Map();
self.onmessage=async ({data})=>{
  try {
    let doc=cache.get(data.url);
    if(!doc) {
      const response=await fetch(data.url);
      if(!response.ok)throw new Error('Could not load block data ('+response.status+')');
      const body=data.url.endsWith('.gz') ? response.body.pipeThrough(new DecompressionStream('gzip')) : response.body;
      doc=JSON.parse(await new Response(body).text());
      cache.set(data.url,doc);
      if(cache.size>3)cache.delete(cache.keys().next().value);
    }
    const parents={};
    for(const id of data.parents){if(!doc.parents[id])throw new Error('Missing block data for '+id);parents[id]=doc.parents[id];}
    self.postMessage({id:data.id,parents});
  }catch(error){self.postMessage({id:data.id,error:error.message});}
};
