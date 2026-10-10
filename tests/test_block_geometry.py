import importlib.util,unittest
from pathlib import Path
from shapely.geometry import box,Polygon
from shapely import STRtree,union_all,coverage_is_valid
spec=importlib.util.spec_from_file_location('builder',Path(__file__).parents[1]/'scripts/build-block-data.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class GeometryTests(unittest.TestCase):
 def test_city_enclave_and_crossing_parent_boundaries(self):
  block=b.clean(box(0,0,10,10));city=b.clean(Polygon([(3,3),(7,3),(7,7),(3,7)],holes=[[(4,4),(4,6),(6,6),(6,4)]]))
  parent=[b.clean(box(0,0,5,10)),b.clean(box(5,0,10,10))]
  atoms=[]
  for pid,piece in b.partition(block,STRtree(parent),parent,['County A','County B']):
   atoms.extend((pid,cid,geom) for cid,geom in b.partition(piece,STRtree([city]),[city],['city']))
  self.assertAlmostEqual(sum(g.area for _,_,g in atoms),100)
  self.assertAlmostEqual(union_all([g for _,cid,g in atoms if cid]).symmetric_difference(city).area,0)
  self.assertEqual({pid for pid,cid,_ in atoms if cid},{'County A','County B'})
  self.assertAlmostEqual(sum(g.area for _,cid,g in atoms if cid is None),88)
  for i,(_,_,left) in enumerate(atoms):
   for _,_,right in atoms[i+1:]:self.assertAlmostEqual(left.intersection(right).area,0)
  counts=b.allocate(17,[g.area for _,_,g in atoms]);self.assertEqual(sum(counts),17)
 def test_zero_population_and_stable_remainders(self):
  self.assertEqual(b.allocate(0,[0,0]).tolist(),[0,0])
  self.assertEqual(b.allocate(5,[1,1,1]).tolist(),[2,2,1])
 def test_shared_edge_repair_preserves_real_narrow_holes_and_enclaves(self):
  # The real source hole is narrower than the gap-repair tolerance. Background
  # protection must preserve it while closing a synthetic crack elsewhere.
  source=Polygon([(0,0),(10,0),(10,10),(0,10)],holes=[[(2,2),(2.0001,2),(2.0001,8),(2,8)]])
  left=source.intersection(box(0,0,5,10));right=source.intersection(box(5.0001,0,10,10))
  repaired=b.repair_coverage([left,right],[source],gap_width=.002,snapping_distance=1e-7)
  self.assertTrue(coverage_is_valid(repaired))
  self.assertAlmostEqual(union_all(repaired).symmetric_difference(source).area,0,places=8)
  self.assertAlmostEqual(repaired[0].intersection(repaired[1]).area,0)
  self.assertEqual(sum(len(p.interiors) for p in b.polygons(union_all(repaired))),1)
 def test_geometry_repair_preserves_ids_membership_counts_and_votes(self):
  import copy
  source=box(0,0,10,10)
  atoms=[{'id':'left','block':'b','parents':{'CA':'p'},'city':None,'polygons':b.encode_polygons(box(0,0,5,10)),'stats':[3,4],'votes':{'race':[1,2,0]}},
         {'id':'right','block':'b','parents':{'CA':'p'},'city':None,'polygons':b.encode_polygons(box(5+1e-8,0,10,10)),'stats':[5,6],'votes':{'race':[2,1,0]}}]
  original=copy.deepcopy(atoms)
  geoms,_=b.repair_atom_geometry(atoms,[source])
  for before,after in zip(original,atoms):
   self.assertEqual({k:v for k,v in before.items() if k!='polygons'},{k:v for k,v in after.items() if k!='polygons'})
  self.assertAlmostEqual(union_all(geoms).area,100)
 def test_alpine_serialized_fixture_has_matching_edges_and_no_county_voids(self):
  import gzip,json
  root=Path(__file__).parent/'fixtures/block-v1'
  doc=json.loads(gzip.decompress((root/'atoms/alpine.json.gz').read_bytes()))
  geoms=[b.decode_polygons(a['polygons']) for a in doc['atoms']]
  self.assertTrue(coverage_is_valid(geoms))
  self.assertEqual(sum(len(p.interiors) for p in b.polygons(union_all(geoms))),0)
 def test_geometry_repair_refuses_to_hide_populated_fragments(self):
  atom={'id':'populated','polygons':b.encode_polygons(box(0,0,1e-12,1e-12)),'stats':[1],'votes':{}}
  bulk={'id':'bulk','polygons':b.encode_polygons(box(0,0,1,1)),'stats':[0],'votes':{}}
  with self.assertRaisesRegex(RuntimeError,'nonzero atom'):b.repair_atom_geometry([atom,bulk],[box(0,0,1,1)])
 def test_source_alignment_restores_projection_border_slivers(self):
  source=box(0,0,10,10)
  repaired=b.repair_coverage([box(5e-7,0,10+5e-7,10)],[source])
  self.assertAlmostEqual(union_all(repaired).symmetric_difference(source).area,0,places=10)
if __name__=='__main__':unittest.main()
