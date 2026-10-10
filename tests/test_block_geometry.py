import importlib.util,unittest
from pathlib import Path
from shapely.geometry import box,Polygon
from shapely import STRtree,union_all
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
if __name__=='__main__':unittest.main()
