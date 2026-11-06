/**
 * A small, realistic Overpass `out geom` response for a fictional 3-hole
 * layout near Seattle, shaped exactly like the real API's JSON. Built from
 * metre offsets so the expected geometry is known.
 *
 * Deliberate quirks a real map has:
 *  - hole 2 is drawn green → tee (backwards)
 *  - hole 3 has no par tag and doglegs right
 *  - a lake is a multipolygon relation; a wood is a plain way
 */

const LAT0 = 47.69;
const LON0 = -122.3;
const M_LAT = 110_540;
const M_LON = 111_320 * Math.cos((LAT0 * Math.PI) / 180);

export const ll = (x: number, y: number) => ({ lat: LAT0 + y / M_LAT, lon: LON0 + x / M_LON });

function ring(cx: number, cy: number, rx: number, ry = rx, n = 16) {
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return ll(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry);
  });
  return [...pts, pts[0]!];
}

let nextId = 1000;
const way = (tags: Record<string, string>, geometry: { lat: number; lon: number }[]) => ({ type: 'way', id: nextId++, tags, geometry });

export function osmCourseFixture() {
  nextId = 1000;
  return {
    version: 0.6,
    generator: 'Overpass API (fixture)',
    elements: [
      // Hole 1: par 4, straight north, 340 m.
      way({ golf: 'hole', ref: '1', par: '4', handicap: '5' }, [ll(0, 0), ll(0, 170), ll(0, 340)]),
      way({ golf: 'tee' }, ring(0, -4, 6, 4)),
      way({ golf: 'fairway' }, ring(0, 200, 16, 90)),
      way({ golf: 'green' }, ring(0, 342, 14)),
      way({ golf: 'bunker' }, ring(20, 330, 5)),
      way({ golf: 'bunker' }, ring(-14, 230, 7)),

      // Hole 2: par 3, 150 m east of hole 1's green, drawn backwards (green first).
      way({ golf: 'hole', ref: '2', par: '3', handicap: '17' }, [ll(150, 360), ll(150, 210)]),
      way({ golf: 'tee' }, ring(150, 206, 5, 3)),
      way({ golf: 'green' }, ring(150, 362, 12)),
      way({ golf: 'bunker' }, ring(166, 355, 4)),

      // Hole 3: par missing, doglegs right; ~420 m.
      way({ golf: 'hole', ref: '3', handicap: '1' }, [ll(300, 200), ll(300, 450), ll(400, 560)]),
      way({ golf: 'green' }, ring(405, 566, 15)),
      way({ golf: 'fairway' }, ring(300, 360, 18, 110)),

      // A lake left of hole 3, as a multipolygon relation with an island (inner) ring.
      {
        type: 'relation',
        id: 9001,
        tags: { type: 'multipolygon', natural: 'water' },
        members: [
          { type: 'way', ref: 1, role: 'outer', geometry: ring(250, 400, 25, 50) },
          { type: 'way', ref: 2, role: 'inner', geometry: ring(250, 400, 5, 8) },
        ],
      },
      // Woods between holes 1 and 2, and a few single trees.
      way({ natural: 'wood' }, ring(75, 250, 25, 60)),
      { type: 'node', id: 7001, lat: ll(-40, 120).lat, lon: ll(-40, 120).lon, tags: { natural: 'tree' } },
      { type: 'node', id: 7002, lat: ll(40, 60).lat, lon: ll(40, 60).lon, tags: { natural: 'tree' } },
      // Clutter that must be ignored.
      way({ golf: 'cartpath' }, [ll(10, 0), ll(10, 300)]),
      way({ highway: 'service' }, [ll(-80, 0), ll(-80, 300)]),
    ],
  };
}

/** Nominatim jsonv2 search results: one course, one non-course with the same name. */
export const nominatimFixture = [
  {
    place_id: 1,
    osm_type: 'way',
    osm_id: 4242,
    lat: '47.692',
    lon: '-122.298',
    category: 'leisure',
    type: 'golf_course',
    name: 'Test Links',
    display_name: 'Test Links, Seattle, King County, Washington, United States',
    boundingbox: ['47.689', '47.696', '-122.301', '-122.294'],
    address: { city: 'Seattle', state: 'Washington', country: 'United States' },
  },
  {
    place_id: 2,
    osm_type: 'node',
    osm_id: 5,
    category: 'amenity',
    type: 'restaurant',
    name: 'Test Links Grill',
    display_name: 'Test Links Grill, Seattle',
    boundingbox: ['47.69', '47.69', '-122.3', '-122.3'],
  },
];
