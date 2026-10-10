/* IndexedDB is authoritative; the synchronous cache supports the existing map catalogue. */
(function(root) {
  'use strict';
  root.CivitasPersistence = {
    async open(legacy) {
      const db=await new Promise((resolve,reject) => {
        const request=indexedDB.open('civitas-editor',1);
        request.onupgradeneeded=()=>{request.result.createObjectStore('records');request.result.createObjectStore('backups');};
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>resolve(request.result);
      });
      const values=new Map();
      await new Promise((resolve,reject)=>{
        const tx=db.transaction('records','readonly'),req=tx.objectStore('records').openCursor();
        req.onsuccess=()=>{const c=req.result;if(c){values.set(c.key,c.value);c.continue();}};
        tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
      });
      const prefix=k=>k.startsWith('civitas-');
      if(!values.has('civitas-idb-migrated')) {
        const old={};
        for(let i=0;i<legacy.length;i++){const k=legacy.key(i);if(prefix(k))old[k]=legacy.getItem(k);}
        await new Promise((resolve,reject)=>{
          const tx=db.transaction(['records','backups'],'readwrite');
          tx.objectStore('backups').put(old,'localStorage-v1');
          for(const [k,v] of Object.entries(old)){tx.objectStore('records').put(v,k);values.set(k,v);}
          tx.objectStore('records').put('1','civitas-idb-migrated');
          tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
        });
        values.set('civitas-idb-migrated','1');
      }
      let queue=Promise.resolve(),failure=null;
      const transact=(entries,store='records')=>new Promise((resolve,reject)=>{
        let tx;
        try {
          tx=db.transaction(store,'readwrite');
          for(const [key,value] of entries) {
            if(value===undefined||value===null)tx.objectStore(store).delete(key);
            else tx.objectStore(store).put(value,key);
          }
          tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||new Error('Storage transaction aborted'));
        } catch(error){if(tx)tx.abort();reject(error);}
      });
      const report=error=>{failure=error;root.dispatchEvent(new CustomEvent('civitas-storage-error',{detail:error.message}));};
      const enqueue=(key,value,store='records',previous)=>{
        queue=queue.then(()=>transact([[key,value]],store)).catch(error=>{
          if(store==='records'&&values.get(key)===value){if(previous===undefined)values.delete(key);else values.set(key,previous);}
          report(error);
        });
      };
      return {
        getItem:k=>values.get(k)??null,
        setItem(k,v){const previous=values.get(k);values.set(k,String(v));enqueue(k,String(v),'records',previous);},
        removeItem(k){const previous=values.get(k);values.delete(k);enqueue(k,undefined,'records',previous);},
        keys:()=>[...values.keys()],
        backup(k,v){enqueue(k,v,'backups');},
        async flush(){await queue;if(failure){const e=failure;failure=null;throw e;}},
        async batch(entries){
          const operation=queue.then(async()=>{
            if(failure){const error=failure;failure=null;throw error;}
            await transact(entries);
            for(const [k,v] of entries){if(v===null)values.delete(k);else values.set(k,String(v));}
          });
          queue=operation.catch(report);
          try { await operation; } catch(error) { if(failure===error)failure=null;throw error; }
        }
      };
    }
  };
})(globalThis);
