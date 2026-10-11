/* Robust display-outline unions. Usable in the block worker and in Node tests.
   Projected block edges that should coincide differ by floating-point noise, which makes
   polygon-clipping's sweep line fail ("Unable to complete output ring", "Infinite loop").
   Coordinates are snapped to the 1e-7 world-unit precision already used by serialized world
   paths, so shared vertices become identical; a 1e-6 grid is tried only if that fails. At the
   100,000x maximum zoom one CSS pixel is about 1e-5 world units, so the largest vertex move
   (grid*sqrt(2)/2) is about 0.007 px, or 0.07 px on the fallback grid.
   Inputs are never modified. Snapping can only remove a ring by collapsing it; a collapsed
   ring narrower than the 1e-7 world precision (a zero-width artifact) is counted and reported,
   and any wider collapse rejects the grid. Every source piece must also be covered by the result. */
(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('../vendor/polygon-clipping.umd.js'));
  else root.CivitasUnion = factory(root.polygonClipping);
})(typeof globalThis === 'object' ? globalThis : this, function(polygonClipping) {
  'use strict';
  // QUANTUM is the world-path precision. A ring whose mean width (2*area/perimeter) is below it
  // has no representable interior, so snapping may collapse it; any wider collapse is an error.
  const GRIDS = [1e-7, 1e-6], QUANTUM = 1e-7, FAN_IN = 8;
  // Shoelace relative to the first vertex: coordinates near 1000 would otherwise cancel.
  function ringArea(ring) {
    if (ring.length < 3) return 0;
    const x0 = ring[0][0], y0 = ring[0][1];
    let a = 0;
    for (let i = 1; i + 1 < ring.length; i++) a += (ring[i][0] - x0) * (ring[i + 1][1] - y0) - (ring[i + 1][0] - x0) * (ring[i][1] - y0);
    return a / 2;
  }
  function ringLength(ring) {
    let n = 0;
    for (let i = 1; i < ring.length; i++) n += Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
    return n;
  }
  const polygonsOf = geom => typeof geom[0]?.[0]?.[0] === 'number' ? [geom] : geom;
  // Area of a polygon or multipolygon, holes subtracted.
  function geomArea(geom) {
    let total = 0;
    for (const poly of polygonsOf(geom)) poly.forEach((ring, i) => { const a = Math.abs(ringArea(ring)); total += i ? -a : a; });
    return total;
  }
  function geomPerimeter(geom) {
    let total = 0;
    for (const poly of polygonsOf(geom)) for (const ring of poly) total += ringLength(ring);
    return total;
  }
  // Round to the grid and drop repeated vertices. Rings that become degenerate are omitted
  // and every omitted ring with nonzero source area is recorded in `collapsed`.
  function snapPolygons(geoms, grid, collapsed = []) {
    const scale = Math.round(1 / grid), out = [];
    geoms.forEach((geom, g) => {
      const snapped = [];
      polygonsOf(geom).forEach((poly, p) => {
        const rings = [];
        for (let r = 0; r < poly.length; r++) {
          const ring = [];
          for (const point of poly[r]) {
            const x = Math.round(point[0] * scale) / scale, y = Math.round(point[1] * scale) / scale, last = ring[ring.length - 1];
            if (!last || last[0] !== x || last[1] !== y) ring.push([x, y]);
          }
          if (ring.length && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) ring.push(ring[0].slice());
          if (ring.length >= 4 && ringArea(ring) !== 0) { rings.push(ring); continue; }
          const area = Math.abs(ringArea(poly[r]));
          if (area > 0) collapsed.push({geom: g, polygon: p, ring: r, area, width: 2 * area / ringLength(poly[r])});
          if (r === 0) break; // holes of a collapsed outer ring have nothing to cut
        }
        if (rings.length) snapped.push(rings);
      });
      if (snapped.length) out.push(snapped);
    });
    return out;
  }
  // Tree reduction: every step unions at most fanIn pieces of similar size, instead of
  // repeatedly re-sweeping an ever-growing accumulated result. Intersection points created by
  // earlier steps are off the grid; when a step fails, its inputs are re-snapped and it is
  // retried once. Rings collapsed by that re-snap are recorded like source collapses.
  function balancedUnion(geoms, fanIn = FAN_IN, grid = 0, collapsed = []) {
    if (geoms.length < 2) return geoms.length ? polygonClipping.union(geoms[0]) : [];
    const step = group => {
      try { return polygonClipping.union(...group); } catch (error) {
        if (!grid) throw error;
        const snapped = snapPolygons(group, grid, collapsed);
        return snapped.length ? polygonClipping.union(...snapped) : [];
      }
    };
    let level = geoms;
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += fanIn) {
        const group = level.slice(i, i + fanIn);
        next.push(group.length === 1 ? group[0] : step(group));
      }
      level = next;
    }
    return level[0];
  }
  // A point strictly inside a polygon: the middle of the widest span cut by a horizontal line
  // through the largest vertical gap between vertices, with its distance to the nearest edge.
  function interiorPoint(poly) {
    const ys = [...new Set(poly.flatMap(ring => ring.map(p => p[1])))].sort((a, b) => a - b);
    let y = null, gap = -1;
    for (let i = 1; i < ys.length; i++) if (ys[i] - ys[i - 1] > gap) { gap = ys[i] - ys[i - 1]; y = (ys[i] + ys[i - 1]) / 2; }
    if (y === null) return null;
    const xs = [];
    for (const ring of poly) for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1], [x2, y2] = ring[i];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + (y - y1) * (x2 - x1) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    let best = null;
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best.width) best = {point: [(xs[i] + xs[i + 1]) / 2, y], width: xs[i + 1] - xs[i]};
    if (!best) return null;
    let clearance = Infinity;
    const [px, py] = best.point;
    for (const ring of poly) for (let i = 1; i < ring.length; i++) {
      const [ax, ay] = ring[i - 1], dx = ring[i][0] - ax, dy = ring[i][1] - ay, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
      clearance = Math.min(clearance, Math.hypot(px - ax - t * dx, py - ay - t * dy));
    }
    return {point: best.point, clearance};
  }
  // Even-odd containment against every ring of a union result, using horizontal bands.
  function containment(polygons) {
    const edges = [];
    for (const poly of polygons) for (const ring of poly) for (let i = 1; i < ring.length; i++) edges.push([ring[i - 1], ring[i]]);
    let y0 = Infinity, y1 = -Infinity;
    for (const [a, b] of edges) { y0 = Math.min(y0, a[1], b[1]); y1 = Math.max(y1, a[1], b[1]); }
    const count = Math.max(1, Math.ceil(Math.sqrt(edges.length))), size = (y1 - y0) / count || 1, bands = Array.from({length: count}, () => []);
    for (const edge of edges) {
      const lo = Math.min(edge[0][1], edge[1][1]), hi = Math.max(edge[0][1], edge[1][1]);
      for (let b = Math.max(0, Math.floor((lo - y0) / size)); b <= Math.min(count - 1, Math.floor((hi - y0) / size)); b++) bands[b].push(edge);
    }
    return ([x, y]) => {
      if (y < y0 || y > y1) return false;
      let inside = false;
      for (const [[ax, ay], [bx, by]] of bands[Math.min(count - 1, Math.floor((y - y0) / size))])
        if ((ay > y) !== (by > y) && x < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
      return inside;
    };
  }
  // Snap and union, trying finer grids first. Throws, never returns partial geometry.
  // Rings narrower than QUANTUM that snapping removes are reported as droppedRings/droppedArea.
  // inputArea and perimeter are measured on the caller's original pieces. The union cannot
  // exceed inputArea by more than one snap displacement along every source edge. It may be
  // smaller where source pieces overlap, so loss is checked by coverage instead: snapping
  // losses are the collapses above, and an interior point of every snapped polygon must lie
  // inside the result. A re-snapped step may move edges by one displacement, so polygons too
  // thin to hold a point farther than that from their edges are counted as `unchecked`.
  function robustUnion(geoms, options = {}) {
    const errors = [], grids = options.grids || GRIDS;
    let inputArea = 0, perimeter = 0;
    for (const g of geoms) { inputArea += geomArea(g); perimeter += geomPerimeter(g); }
    for (const grid of grids) {
      try {
        const collapsed = [], input = snapPolygons(geoms, grid, collapsed);
        const lost = collapsed.filter(c => c.width > QUANTUM).length;
        if (lost) throw new Error(lost + ' source ring(s) wider than ' + QUANTUM + ' collapse on this grid');
        const resnapped = [], polygons = balancedUnion(input, FAN_IN, grid, resnapped);
        const resnapLost = resnapped.filter(c => c.width > QUANTUM).length;
        if (resnapLost) throw new Error(resnapLost + ' merged ring(s) wider than ' + QUANTUM + ' collapse when re-snapping a failed step');
        const dropped = collapsed.concat(resnapped);
        const outputArea = geomArea(polygons), displacement = grid * Math.SQRT1_2, tolerance = displacement * perimeter;
        if (input.length && !polygons.length) throw new Error('union is empty');
        if (outputArea > inputArea + tolerance) throw new Error('union area ' + outputArea + ' exceeds input area ' + inputArea);
        const inside = containment(polygons);
        let unchecked = 0, uncovered = 0;
        for (const geom of input) for (const poly of geom) {
          const probe = interiorPoint(poly);
          if (!probe || probe.clearance <= displacement) { unchecked++; continue; }
          if (!inside(probe.point)) uncovered++;
        }
        if (uncovered) throw new Error(uncovered + ' source polygon(s) missing from the union');
        return {polygons, grid, inputArea, outputArea, tolerance, droppedRings: dropped.length, droppedArea: dropped.reduce((n, c) => n + c.area, 0), unchecked, attempts: errors};
      } catch (error) {
        errors.push('grid ' + grid + ': ' + error.message);
      }
    }
    throw new Error('Could not merge outline (' + errors.join('; ') + ')');
  }
  return {GRIDS, QUANTUM, snapPolygons, balancedUnion, robustUnion, interiorPoint, geomArea, geomPerimeter, ringArea};
});
