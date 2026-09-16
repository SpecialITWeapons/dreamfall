import { defineStructure } from '../contract';

// The landmark: the tall thing a town is steered by, and the only building in
// this library meant to be read from the air rather than from the road. The
// other three are seen at a hundred metres by a flight that is going past; this
// one has to say "a town, over there" from two kilometres out and still be
// worth looking at from over the plaza.
//
// Sixty metres is not a floor count. A recipe is baked once per floor count in
// its range and gets a pool of its own for each, so forty storeys would be
// forty bakes; the height comes from a tall `floorHeight` instead. A floor
// here is a stage of the shaft -- ten metres of stonework with one band of
// openings in it -- and the range is two counts rather than the four the budget
// allows, because the floor count is the only number a plan varies per lot and
// so the only lever a settlement has on the landmark's height (spec 8 asks for
// a kind *and* a height). Three stages stand 46 m over a village, four stand
// 57 m over a town: under the 60 m the spec allows, and under the 70 m of
// relief that ends a low pass, so the flight still comes down over a town
// rather than climbing out of the one place worth a low pass.
//
// What keeps it from being a stick, in the order the distance gives it up: a
// spire, a crown that overhangs what carries it, and a shaft that steps inward
// as it rises. A plain prism of any height reads as a chimney -- the mill is
// that shape, and it is 13 m -- and a smooth batter is two degrees of lean that
// nothing sees past a few hundred metres. What carries is a break in the
// outline: the gallery throws a shadow line across the shaft, and the lantern
// standing on it is turned corner-on, which is the one cue that survives being
// looked at straight down, where the flight spends most of its time and where
// a square on a square is just a bigger roof.
//
// It bakes itself because the built-in generator builds one box, one roof and a
// chimney, and a stack of stages is none of those; nothing in here reaches past
// the kit's own verbs, though -- it is box, roof and windows the whole way.

/** A stage of the shaft, m: three storeys of a house, and no floor in it. */
const STAGE = 10.8;
/** How wide the last stage is against the foot: the waist, spread over the stages there are. */
const TAPER = 0.73;
/** The skirt at the foot, m: what plants the tower instead of sticking it in. */
const PLINTH = { out: 0.4, height: 1.3 };
/** A string course over a set-back, m. The step is invisible at distance; the line over it is not. */
const COURSE = { out: 0.2, deep: 0.5 };
/** The gallery, m: the one overhang big enough to throw a shadow a kilometre away. */
const GALLERY = { out: 0.55, deep: 0.8, over: 0.6 };
/**
 * The lantern and its cornice, m. `share` is of the gallery it stands on: a
 * square turned 45 degrees reaches with its corners where a straight one
 * reaches with its edges, so 0.69 is what sets those corners just inside the
 * gallery rim instead of hanging over it.
 */
const LANTERN = { share: 0.69, height: 4.6, out: 0.18, cornice: 0.4 };
/**
 * A band of openings: how far up its stage it starts, as a share, and how tall
 * it is, in metres. The kit's own band is a share of the storey, which is right
 * when a storey is a storey; a stage here is three of them and a window is
 * still a window.
 */
const OPENING = { up: 0.62, height: 0.9 };
/** The lantern's band, m: taller, because it is the one that has to be seen after dark. */
const LAMP = { up: 0.9, height: 2.6 };

export default defineStructure({
  id: 'tower',
  name: 'tower',
  // Slender: a landmark is read against the roofs around it, and 6.6 m of plan
  // under 57 m of height is the proportion that says tower rather than silo. It
  // also keeps the disc the flight must miss narrow, since that disc is
  // measured to the corner of the widest thing baked -- here the plinth.
  footprint: [6.6, 6.6],
  floors: [3, 4],
  floorHeight: STAGE,
  roof: 'hip',
  // A hip over a square is a pyramid, which is what a spire is -- the mill's
  // argument, three times taller. The pitch is rise over half the short side,
  // as everywhere else in the kit, so 3.7 puts 8.2 m of spire on a 4.4 m
  // lantern: steep enough to be a point rather than a hat.
  roofPitch: 3.7,
  palette: { wall: 'stoneWarm', roof: 'stoneDark', trim: 'stoneCool', window: 'gold' },
  bake(kit) {
    const { box, roof, merge, matrix, windows, spec, floors } = kit;
    const foot = spec.footprint[0],
      stage = spec.floorHeight ?? STAGE,
      wall = spec.palette.wall,
      trim = spec.palette.trim ?? spec.palette.wall;

    /** @type {Parameters<typeof merge>[0]} */
    const parts = [];
    /**
     * A block of square plan on the tower's axis, standing on `base`. It is the
     * only shape in here; `turn` is what sets the lantern corner-on.
     *
     * @param {number} base
     * @param {number} width
     * @param {number} height
     * @param {import('../contract').SceneryColor} color
     * @param {number} [turn]
     */
    const block = (base, width, height, color, turn = 0) => {
      parts.push({
        geometry: box(width, height, width, color),
        matrix: matrix(0, base + height / 2, 0, 1, 1, 1, 0, turn, 0),
      });
    };

    block(0, foot + 2 * PLINTH.out, PLINTH.height, trim);

    // The shaft. The taper is spread over however many stages the plan asked
    // for, so the foot and the lantern are the same size either way: what the
    // floor count changes is the height and how often the wall steps in.
    const crest = foot * TAPER;
    for (let i = 0; i < floors; i++) {
      const width = foot + (crest - foot) * (i / Math.max(1, floors - 1));
      block(i * stage, width, stage, wall);
      if (i + 1 < floors) block((i + 1) * stage - COURSE.deep / 2, width + 2 * COURSE.out, COURSE.deep, trim);
    }

    // The crown: gallery, lantern, cornice, spire. Each slab straddles or
    // overhangs the joint under it, so no two faces of it end up coplanar.
    const shaft = floors * stage,
      galleryTop = shaft + GALLERY.over,
      galleryWidth = crest + 2 * GALLERY.out;
    block(galleryTop - GALLERY.deep, galleryWidth, GALLERY.deep, trim);
    const lantern = galleryWidth * LANTERN.share,
      lanternTop = galleryTop + LANTERN.height;
    block(galleryTop, lantern, LANTERN.height, wall, Math.PI / 4);
    const cornice = lantern + 2 * LANTERN.out;
    block(lanternTop, cornice, LANTERN.cornice, trim, Math.PI / 4);
    parts.push({
      geometry: roof('hip', cornice, cornice, (spec.roofPitch ?? 1) * 0.5 * cornice, spec.palette.roof),
      matrix: matrix(0, lanternTop + LANTERN.cornice, 0, 1, 1, 1, 0, Math.PI / 4, 0),
    });

    const geometry = merge(parts);
    for (const part of parts) part.geometry.dispose();

    // The light. One band a stage and a taller one in the lantern: a landmark
    // that goes dark while the cottages under it glow is a power cut, not a
    // landmark, and the lantern is what should be seen first.
    //
    // Nothing is cut above the cornice, on purpose. The kit calls a face a wall
    // when it stands within twenty degrees of vertical, and a spire this steep
    // is well inside that, so a band laid across it would cut windows into the
    // spire and light the roof.
    const pane = spec.palette.window;
    if (pane !== undefined) {
      for (let i = 0; i < floors; i++) windows(geometry, (i + OPENING.up) * stage, OPENING.height, pane);
      windows(geometry, galleryTop + LAMP.up, LAMP.height, pane);
    }
    return geometry;
  },
});
