#!/usr/bin/env python3
"""Validate bundled atoms against parent summaries, source counts and race audits."""
from pathlib import Path
import argparse,gzip,json
import numpy as np
import pandas as pd
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'web/data/block-v1'
parser=argparse.ArgumentParser();parser.add_argument('--completed',action='store_true');args=parser.parse_args()
manifest=json.loads((OUT/'manifest.json').read_text())
reports=sorted((OUT/'reports').glob('*.json'))
if not args.completed:
 assert len(manifest['counties'])==58,'Statewide manifest is incomplete'
 assert manifest['population']==39538223
 assert manifest['blocks']==519723
pop=pd.read_pickle(ROOT/'.cache/geodata/population.pkl')
checked=0
for path in reports:
 report=json.loads(path.read_text())
 if report.get('buildRevision')!=3:continue
 slug=report['slug'];doc=json.loads(gzip.decompress((OUT/'atoms'/f'{slug}.json.gz').read_bytes()))
 atoms=doc['atoms'];keys=doc['statKeys'];matrix=np.array([a['stats'] for a in atoms],dtype=np.float64)
 assert len({a['id'] for a in atoms})==len(atoms)
 for geo in ['CA','CA-BG']:
  records=json.loads((OUT/geo/'geometry'/f'precincts-{slug}.json').read_text())['records']
  original=json.loads((ROOT/'web/data'/geo/'geometry'/f'precincts-{slug}.json').read_text())['records']
  index={r['county']+'|'+str(r['precinct']):r for r in records}
  assert all(r['county']+'|'+str(r['precinct']) in index for r in original),'Lost legacy IDs'
  memberships=doc['parents'][geo]
  indices=[i for members in memberships.values() for i in members]
  assert sorted(indices)==list(range(len(atoms))),'Atoms must belong to exactly one parent per geography'
  for key,members in memberships.items():
   totals=matrix[members].sum(axis=0) if members else np.zeros(len(keys))
   for field,total in zip(keys,totals):assert abs(index[key].get(field,0)-total)<.01,(slug,geo,key,field)
  for race,audit in report['elections'].items():
   data=json.loads((OUT/geo/race/f'votes-{slug}.json').read_text())['records']
   votes={r['county']+'|'+str(r['precinct']):[r['dem'],r['rep'],r['other']] for r in data}
   totals=[0,0,0]
   for parent,members in memberships.items():
    expected=[sum(atoms[i]['votes'].get(race,[0,0,0])[side] for i in members) for side in range(3)]
    assert votes.get(parent,[0,0,0])==expected,(slug,geo,race,parent)
    for i,n in enumerate(expected):totals[i]+=n
   assert totals==audit.get('sourceTotals',[0,0,0]),(slug,race,totals,audit.get('sourceTotals',[0,0,0]))
 # Each original block count must survive all parent/city cuts.
 blocks={}
 for a in atoms:
  sums=blocks.setdefault(a['block'],[0,0,0])
  for i,k in enumerate(['pop20','vap20','pop20Adjusted']):sums[i]+=a['stats'][keys.index(k)]
 for bid,values in blocks.items():assert values==pop.loc[bid,['pop20','vap20','pop20Adjusted']].tolist(),(slug,bid)
 checked+=1;print('Validated',slug,len(atoms),'pieces',flush=True)
if not args.completed:assert checked==58
print('PASS:',checked,'counties; both geographies, all audited races, statistics, block counts and legacy IDs.')
