/* Shared, reversible map state. Usable in the browser and in Node tests. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CivitasEditor = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  function difference(before, after) {
    const changes = [];
    for (const section of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[section] || {}, b = after[section] || {};
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const old = Object.hasOwn(a,key) ? a[key] : null;
        const next = Object.hasOwn(b,key) ? b[key] : null;
        if (!equal(old,next)) changes.push({ section,key,before:copy(old),after:copy(next) });
      }
    }
    return changes;
  }
  class History {
    constructor(persisted) {
      this.commands = persisted ? copy(persisted.commands || []) : [];
      this.cursor = persisted ? Math.max(0,Math.min(this.commands.length,persisted.cursor|0)) : 0;
    }
    record(label,before,after) {
      const changes = difference(before,after);
      if (!changes.length) return false;
      this.commands.splice(this.cursor);
      this.commands.push({label,changes});
      this.cursor++;
      return true;
    }
    get canUndo() { return this.cursor > 0; }
    get canRedo() { return this.cursor < this.commands.length; }
    undo(state) {
      if (!this.canUndo) return null;
      const command = this.commands[this.cursor-1];
      const result = this.apply(state,command,'before');
      this.cursor--;
      return result;
    }
    redo(state) {
      if (!this.canRedo) return null;
      const command = this.commands[this.cursor];
      const result = this.apply(state,command,'after');
      this.cursor++;
      return result;
    }
    apply(state,command,direction) {
      const result = copy(state);
      for (const c of command.changes) {
        result[c.section] ||= {};
        if (c[direction] === null) delete result[c.section][c.key];
        else result[c.section][c.key] = copy(c[direction]);
      }
      return result;
    }
    persistent(limit=15) {
      const start = Math.max(0,this.cursor-limit), end = Math.min(this.commands.length,this.cursor+limit);
      return {commands:copy(this.commands.slice(start,end)),cursor:this.cursor-start};
    }
  }
  function allocate(total,weights,ids) {
    if (!Number.isFinite(total) || total < 0) throw new Error('Invalid allocation total');
    if (!weights.length) return [];
    const sum = weights.reduce((a,w) => a + Math.max(0,w),0);
    const shares = weights.map(w => sum ? Math.max(0,w)/sum : 1/weights.length);
    if (!Number.isInteger(total)) return shares.map(w => total*w);
    const exact = shares.map(w => w*total), result=exact.map(Math.floor);
    let left = total-result.reduce((a,v) => a+v,0);
    const order=exact.map((v,i) => i).sort((a,b) => (exact[b]-result[b])-(exact[a]-result[a]) || String(ids?.[a] ?? a).localeCompare(String(ids?.[b] ?? b)));
    for (let n=0;n<left;n++) result[order[n%order.length]]++;
    return result;
  }
  function aggregate(records,keys) {
    const out={};
    for (const key of keys) out[key]=records.reduce((s,r) => s+(Number(r[key])||0),0);
    out.age_avg=out.age_total ? out.age_sum/out.age_total : 0;
    out.inc_med=out.inc_medhh ? out.inc_medw/out.inc_medhh : 0;
    const two=(out.dem||0)+(out.rep||0);
    out.margin=two ? ((out.dem||0)-(out.rep||0))/two : null;
    return out;
  }
  class SpatialIndex {
    constructor(records,cell=30) {
      this.cell=cell;this.buckets=new Map();this.large=[];
      for (const record of records) {
        const b=record.bbox, x0=Math.floor(b[0]/cell),x1=Math.floor(b[2]/cell),y0=Math.floor(b[1]/cell),y1=Math.floor(b[3]/cell);
        if ((x1-x0+1)*(y1-y0+1)>1000) {this.large.push(record);continue;}
        for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++) {
          const key=x+','+y;
          if(!this.buckets.has(key))this.buckets.set(key,[]);
          this.buckets.get(key).push(record);
        }
      }
    }
    at(x,y) {return [...(this.buckets.get(Math.floor(x/this.cell)+','+Math.floor(y/this.cell))||[]),...this.large].filter(r => x>=r.bbox[0]&&x<=r.bbox[2]&&y>=r.bbox[1]&&y<=r.bbox[3]);}
  }
  return {History,difference,allocate,aggregate,SpatialIndex,copy};
});
