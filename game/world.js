// world.js — the Kestrel Ridge valley: terrain heightfield, the river and
// road, both runways, scattered trees and houses, clouds, and the ring
// courses for each rally leg. Everything is deterministic: the same world
// is generated on every load from fixed formulas and a small hash.

/** Deterministic 2D hash -> [0, 1). */
export function hash2(a, b) {
  let n = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

// World axes: x east, y north, z up, all in metres. The valley runs north.
export const RUNWAYS = [
  { name: 'South Field', cx: 0, y0: -650, y1: -150, z: 2, dir: 0 },
  { name: 'North Field', cx: 120, y0: 5550, y1: 6050, z: 2, dir: 0 },
];

const RUNWAY_HALF_WIDTH = 17;

/** Ground height in metres at (x, y). */
export function terrainHeight(x, y) {
  // Gentle valley-floor undulation.
  let h = 3.2 * Math.sin(x * 0.004 + 1.3) * Math.cos(y * 0.0031)
        + 2.1 * Math.sin(x * 0.0013 - y * 0.0017)
        + 1.4 * Math.sin(y * 0.005 + x * 0.002);
  // Mountain ridges closing the valley to west and east.
  const ax = Math.abs(x);
  if (ax > 620) {
    const t = Math.min(1, (ax - 620) / 700);
    h += t * t * 430 + 26 * Math.sin(y * 0.002 + x * 0.001) * t;
  }
  // End caps far beyond the course.
  if (y > 6600) h += Math.min(380, (y - 6600) / 600 * 380);
  if (y < -1500) h += Math.min(380, (-1500 - y) / 600 * 380);
  // Both runway strips are graded flat.
  for (const r of RUNWAYS) {
    const dx = Math.abs(x - r.cx) - (RUNWAY_HALF_WIDTH + 30);
    const dy = Math.max(r.y0 - 90 - y, y - (r.y1 + 90));
    const d = Math.max(dx, dy);
    if (d < 130) {
      const f = Math.max(0, 1 - Math.max(0, d) / 130);
      const s = f * f * (3 - 2 * f);
      h = h * (1 - s) + r.z * s;
    }
  }
  return h;
}

/** The runway whose strip contains (x, y), or null. */
export function runwayAt(x, y) {
  for (const r of RUNWAYS) {
    if (Math.abs(x - r.cx) <= RUNWAY_HALF_WIDTH && y >= r.y0 && y <= r.y1) return r;
  }
  return null;
}

/** Centreline of the river that winds down the east side of the valley. */
export function riverCenterX(y) {
  return 560 + 260 * Math.sin(y * 0.00075) + 120 * Math.sin(y * 0.0021 + 2.0);
}
export const RIVER_HALF_WIDTH = 52;

/** The farm road running north along the west side. */
export const ROAD_X = -280;

// --- scattered dressing, generated once -------------------------------------

function scatterTrees() {
  const trees = [];
  for (let gx = -15; gx <= 15; gx++) {
    for (let gy = -14; gy <= 70; gy++) {
      const cx = gx * 100, cy = gy * 100;
      if (terrainHeight(cx, cy) > 60) continue;          // no trees on the ridges
      if (Math.abs(cx - riverCenterX(cy)) < 90) continue; // nor in the river
      const n = hash2(gx, gy);
      if (n < 0.45) continue;
      const count = n > 0.85 ? 3 : n > 0.65 ? 2 : 1;
      for (let i = 0; i < count; i++) {
        trees.push({
          x: cx + hash2(gx * 3 + i, gy) * 90 - 45,
          y: cy + hash2(gx, gy * 3 + i) * 90 - 45,
          s: 0.8 + hash2(gx + i, gy - i) * 0.7,
        });
      }
    }
  }
  return trees;
}

function scatterHouses() {
  // A farming hamlet east of South Field, hangars beside both runways.
  const houses = [];
  const spots = [
    [300, -420], [345, -380], [290, -330], [360, -300], [315, -250],
    [395, -430], [410, -350], [265, -290], [380, -210], [330, -160],
  ];
  for (const [x, y] of spots) {
    houses.push({ x, y, w: 14, d: 11, h: 6.5, rot: hash2(x, y) * 0.6 - 0.3, kind: 'house' });
  }
  houses.push({ x: -70, y: -420, w: 34, d: 20, h: 10, rot: 0, kind: 'hangar' });
  houses.push({ x: -75, y: 5780, w: 34, d: 20, h: 10, rot: 0, kind: 'hangar' });
  houses.push({ x: 215, y: 5900, w: 16, d: 12, h: 7, rot: 0.2, kind: 'house' });
  return houses;
}

function scatterClouds() {
  const clouds = [];
  for (let i = 0; i < 46; i++) {
    clouds.push({
      x: -1800 + hash2(i, 7) * 3600,
      y: -1200 + hash2(3, i) * 8400,
      z: 215 + hash2(i, 11) * 120,
      s: 45 + hash2(i, 13) * 70,
    });
  }
  return clouds;
}

export const TREES = scatterTrees();
export const HOUSES = scatterHouses();
export const CLOUDS = scatterClouds();

// --- rally legs ---------------------------------------------------------------

const LEG_DEFS = [
  { rings: 8, wind: 0, sky: 'day', par: 150, name: 'Leg 1 — Valley Run' },
  { rings: 9, wind: 6, sky: 'day', par: 165, name: 'Leg 2 — Crosswind Return' },
  { rings: 10, wind: -9, sky: 'dusk', par: 180, name: 'Leg 3 — Dusk Final' },
];

/**
 * Build the course for a leg: start and finish runways, the ring line, one
 * fuel gate, wind and sky. Odd legs fly north, even legs fly back south.
 */
export function buildCourse(legIndex) {
  const def = LEG_DEFS[legIndex % LEG_DEFS.length];
  const northbound = legIndex % 2 === 0;
  const start = northbound ? RUNWAYS[0] : RUNWAYS[1];
  const finish = northbound ? RUNWAYS[1] : RUNWAYS[0];
  const dirSign = northbound ? 1 : -1;

  const rings = [];
  for (let i = 0; i < def.rings; i++) {
    const along = 700 + i * (4300 / Math.max(1, def.rings - 1)) * 1.0;
    const y = northbound ? along : 6050 - along - 350;
    const x = 380 * Math.sin(i * 0.9 + legIndex * 1.7) + 140 * Math.sin(i * 2.3 + 1.0);
    const z = 78 + 52 * Math.sin(i * 1.3 + legIndex * 2.0) + (i % 3) * 16;
    rings.push({ x, y, z: Math.max(48, Math.min(175, z)), r: 24, passed: false, missed: false });
  }
  // Ring tangents follow the course line so a ring reads as a gate in flight.
  for (let i = 0; i < rings.length; i++) {
    const prev = rings[Math.max(0, i - 1)], next = rings[Math.min(rings.length - 1, i + 1)];
    const tx = next.x - prev.x, ty = next.y - prev.y, tz = next.z - prev.z;
    const len = Math.hypot(tx, ty, tz) || 1;
    rings[i].tx = tx / len; rings[i].ty = ty / len; rings[i].tz = tz / len;
  }

  const midY = northbound ? 2750 : 3200;
  const fuelGate = {
    x: northbound ? -390 : 430, y: midY, z: 58, r: 30,
    tx: 0, ty: dirSign, tz: 0, used: false,
  };

  return {
    legIndex,
    name: def.name,
    par: def.par,
    sky: def.sky,
    windX: def.wind,
    gusty: legIndex === 2,
    start, finish, northbound,
    rings, fuelGate,
    startPos: {
      x: start.cx,
      y: northbound ? start.y0 + 40 : start.y1 - 40,
      heading: northbound ? 0 : Math.PI,
    },
    landDir: northbound ? 0 : Math.PI,
  };
}
