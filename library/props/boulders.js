import { defineProp } from '../contract';

// Boulders: the reference for any object that stands in the world. bake(kit)
// builds one geometry once; place(cell, kit) says where instances stand in each
// 96 m cell of the streamed ring, reading the climate there. The engine
// instances it, shrinks it into the ground at the ring's edge like a tree,
// lights it with the world's own material and casts its shadow. A prop with an
// obstacle also keeps the flight and the camera clear of it; boulders lie low
// enough not to need one.
export default defineProp({
  id: 'boulders',
  name: 'boulders',
  budget: { instances: 1500, triangles: 400 },
  bake(kit) {
    // three lumps, jittered, one cluster
    const random = kit.random('boulders'),
      parts = [];
    for (let i = 0; i < 3; i++) {
      const g = new kit.THREE.IcosahedronGeometry(1, 1),
        p = g.getAttribute('position');
      for (let k = 0; k < p.count; k++) {
        const jitter = 0.78 + random() * 0.4;
        p.setXYZ(k, p.getX(k) * jitter, p.getY(k) * jitter * 0.8, p.getZ(k) * jitter);
      }
      g.computeVertexNormals();
      parts.push({
        geometry: g,
        matrix: kit.matrix(
          (i - 1) * 0.9,
          -0.15 * i,
          (i % 2) * 0.6,
          1 - i * 0.22,
          0.9 - i * 0.15,
          1 - i * 0.18,
          0,
          i * 1.1,
          0,
        ),
        color: kit.color('white'),
      });
    }
    return kit.merge(parts);
  },
  place(cell, kit) {
    // boulders like slopes and the biomes that have them; the biome's own rock
    // colour tints each cluster
    const rockiness = cell.mix('boulders');
    if (cell.roll() > rockiness * (0.25 + kit.sstep(0.05, 0.4, cell.slope(cell.center.x, cell.center.z))))
      return [];
    const x = cell.corner.x + cell.roll() * cell.size,
      z = cell.corner.z + cell.roll() * cell.size;
    if (!cell.land(x, z) || cell.slope(x, z) > 0.9) return [];
    const size = 1.6 + cell.roll() * cell.roll() * 6;
    return [
      {
        x,
        z,
        yaw: cell.roll() * 6.283,
        scale: [size, size * (0.6 + cell.roll() * 0.4), size],
        sink: size * 0.25,
        tint: cell.blend('rock').clone(),
      },
    ];
  },
});
