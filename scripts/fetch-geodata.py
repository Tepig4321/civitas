#!/usr/bin/env python3
"""Download pinned public inputs atomically and record their checksums."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import hashlib,json,requests,os
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'.cache/geodata';CACHE.mkdir(parents=True,exist_ok=True)
INPUTS={
 'blocks.zip':'https://www2.census.gov/geo/tiger/TIGER2020/TABBLOCK20/tl_2020_06_tabblock20.zip',
 'places.zip':'https://www2.census.gov/geo/tiger/TIGER2025/PLACE/tl_2025_06_place.zip',
 'pl2020.zip':'https://www2.census.gov/programs-surveys/decennial/2020/data/01-Redistricting_File--PL_94-171/California/ca2020.pl.zip',
 'adjusted.zip':'https://statewidedatabase.org/pub/data/D20/PL94/state/state_PL94_2020_Adjusted_P24_DOJ_Block_csv.zip',
}
for y in ['16','18','20']:
 INPUTS[f'g{y}-votes.zip']=f'https://statewidedatabase.org/pub/data/D20/SOV/g{y}/state/state_g{y}_SOV_by_2020_Blocks_csv.zip'
 INPUTS[f'g{y}-codebook.csv']=f'https://statewidedatabase.org/pub/data/D20/SOV/codebooks/g{y}_sov_codebook.csv'
for y in ['22','24']:
 INPUTS[f'g{y}-votes.zip']=f'https://statewidedatabase.org/pub/data/G{y}/state/state_g{y}_sov_data_by_g{y}_srprec.zip'
 INPUTS[f'g{y}-block-map.csv']=f'https://statewidedatabase.org/pub/data/G{y}/state/state_g{y}_sr_blk_map.csv'
 INPUTS[f'g{y}-codebook.csv']=f'https://statewidedatabase.org/pub/data/G{y}/G{y}_SOV_statewide_codebook.csv'
def fetch(item):
 name,url=item;p=CACHE/name
 if not p.exists():
  partial=p.with_suffix(p.suffix+'.part')
  r=requests.get(url,stream=True,timeout=180);r.raise_for_status()
  with partial.open('wb') as f:
   for chunk in r.iter_content(1024*1024):f.write(chunk)
  os.replace(partial,p)
 digest=hashlib.file_digest(p.open('rb'),'sha256').hexdigest()
 print(name,p.stat().st_size,flush=True)
 return name,{'url':url,'sha256':digest,'bytes':p.stat().st_size}
if __name__=='__main__':
 with ThreadPoolExecutor(max_workers=4) as pool:result=dict(pool.map(fetch,INPUTS.items()))
 (CACHE/'sources.json').write_text(json.dumps(result,indent=2)+'\n')
