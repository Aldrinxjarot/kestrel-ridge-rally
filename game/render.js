// render.js — the chase-camera renderer. A small perspective projector
// turns the world (x east, y north, z up) into screen space; the scene is
// painted far-to-near: sky, terrain cells, river and road ribbons, the
// runways, houses and trees, rings and the fuel gate, clouds, the plane's
// ground shadow, and finally the plane itself (planeart.js).

import { terrainHeight, riverCenterX, RIVER_HALF_WIDTH, ROAD_X, RUNWAYS, TREES, HOUSES, CLOUDS, hash2 } from './world.js';
import { drawPlane } from './planeart.js';

const FOV_Y = 68 * Math.PI / 180;
const CELL = 100;
const VIEW_RANGE = 1750;

const SKIES = {
  day: { top: '#5f97c4', mid: '#9dc0da', horizon: '#d9e6ee', fog: '#cfdde8', sun: '#fff3c4' },
  dusk: { top: '#3d4470', mid: '#a05a78', horizon: '#f2a65e', fog: '#d9a37e', sun: '#ffb347' },
};
const FIELD_COLORS = ['#5d8f3e', '#6fa04a', '#7fae56', '#4e7d35', '#c9a959', '#8a6a44', '#679a44'];

export function makeCamera() {
  return { x: 0, y: 0, z: 0, heading: 0, pitch: 0, ready: false };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const rgbCache = new Map();
function mix(hexA, hexB, t) {
  const key = hexA + hexB + t.toFixed(2);
  if (rgbCache.has(key)) return rgbCache.get(key);
  const a = hexRgb(hexA), b = hexRgb(hexB);
  const out = `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
  rgbCache.set(key, out);
  return out;
}
function shade(hex, f) {
  // Returns a hex string like every other colour here, so callers can feed
  // the result straight into mix() (which parses hex, not rgb() strings).
  const [r, g, b] = hexRgb(hex);
  const ch = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + [ch(r), ch(g), ch(b)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Build this frame's camera and projector from the flight state. */
function makeProjector(ctx, W, H, flight, cam, dt) {
  const cp = Math.cos(flight.pitch * 0.55), sp = Math.sin(flight.pitch * 0.55);
  const fwd = [Math.sin(flight.heading) * cp, Math.cos(flight.heading) * cp, sp];
  const want = [
    flight.x - fwd[0] * 42,
    flight.y - fwd[1] * 42,
    flight.z - fwd[2] * 42 + 13,
  ];
  if (!cam.ready) {
    cam.x = want[0]; cam.y = want[1]; cam.z = want[2];
    cam.heading = flight.heading; cam.ready = true;
  } else {
    const k = 1 - Math.exp(-dt * 4.5);
    cam.x += (want[0] - cam.x) * k;
    cam.y += (want[1] - cam.y) * k;
    cam.z += (want[2] - cam.z) * k;
    let dh = flight.heading - cam.heading;
    while (dh > Math.PI) dh -= Math.PI * 2;
    while (dh < -Math.PI) dh += Math.PI * 2;
    cam.heading += dh * (1 - Math.exp(-dt * 5));
  }
  const vf = [
    flight.x + fwd[0] * 90 - cam.x,
    flight.y + fwd[1] * 90 - cam.y,
    flight.z + fwd[2] * 90 - cam.z,
  ];
  const vl = Math.hypot(...vf) || 1;
  const F = vf.map(v => v / vl);
  let R = [F[1], -F[0], 0];
  const rl = Math.hypot(R[0], R[1]) || 1;
  R = [R[0] / rl, R[1] / rl, 0];
  const U = [
    R[1] * F[2] - R[2] * F[1],
    R[2] * F[0] - R[0] * F[2],
    R[0] * F[1] - R[1] * F[0],
  ];
  const focal = (H / 2) / Math.tan(FOV_Y / 2);
  const cx0 = W / 2, cy0 = H * 0.52;
  const rollA = -flight.roll * 0.38;
  const cosR = Math.cos(rollA), sinR = Math.sin(rollA);
  const C = [cam.x, cam.y, cam.z];
  function project(p) {
    const dx = p[0] - C[0], dy = p[1] - C[1], dz = p[2] - C[2];
    const cz = dx * F[0] + dy * F[1] + dz * F[2];
    if (cz < 2.5) return null;
    const cx = dx * R[0] + dy * R[1] + dz * R[2];
    const cy = dx * U[0] + dy * U[1] + dz * U[2];
    let sx = cx0 + (cx / cz) * focal;
    let sy = cy0 - (cy / cz) * focal;
    const ox = sx - cx0, oy = sy - cy0;
    sx = cx0 + ox * cosR - oy * sinR;
    sy = cy0 + ox * sinR + oy * cosR;
    return [sx, sy, cz];
  }
  return { project, camPos: C, fwd: F };
}

function fillQuad(ctx, pts, fill) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function cellFill(cx, cy, sky) {
  const hC = terrainHeight(cx, cy);
  const fogT = 0; // fog is applied by the caller, which knows the distance
  void fogT;
  if (Math.abs(cx - riverCenterX(cy)) < RIVER_HALF_WIDTH + 26) return '#b3a071'; // sandy banks
  if (hC > 175) return '#e8edf2';
  if (hC > 70) return shade('#8a7f72', 0.9 + hash2(cx, cy) * 0.2);
  const base = FIELD_COLORS[Math.floor(hash2(cx / CELL, cy / CELL) * FIELD_COLORS.length) % FIELD_COLORS.length];
  return shade(base, 0.94 + hash2(cy, cx) * 0.12);
}

export function drawScene(ctx, W, H, flight, course, cam, dt, time) {
  const sky = SKIES[course.sky] ?? SKIES.day;
  const { project, camPos } = makeProjector(ctx, W, H, flight, cam, dt);

  // Sky and sun.
  const grad = ctx.createLinearGradient(0, 0, 0, H * 0.72);
  grad.addColorStop(0, sky.top);
  grad.addColorStop(0.62, sky.mid);
  grad.addColorStop(1, sky.horizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  const sunDir = course.sky === 'dusk' ? [-0.5, 0.75, 0.16] : [-0.55, 0.25, 0.8];
  const sunP = project([camPos[0] + sunDir[0] * 4000, camPos[1] + sunDir[1] * 4000, camPos[2] + sunDir[2] * 4000]);
  if (sunP) {
    ctx.beginPath();
    ctx.arc(sunP[0], sunP[1], 26, 0, Math.PI * 2);
    ctx.fillStyle = sky.sun;
    ctx.fill();
  }

  // Terrain cells around the focus point ahead of the plane.
  const fx = flight.x + Math.sin(flight.heading) * 500;
  const fy = flight.y + Math.cos(flight.heading) * 500;
  const gx0 = Math.floor((fx - VIEW_RANGE) / CELL), gx1 = Math.floor((fx + VIEW_RANGE) / CELL);
  const gy0 = Math.floor((fy - VIEW_RANGE) / CELL), gy1 = Math.floor((fy + VIEW_RANGE) / CELL);
  const cells = [];
  for (let gx = gx0; gx <= gx1; gx++) {
    for (let gy = gy0; gy <= gy1; gy++) {
      const x0 = gx * CELL, y0 = gy * CELL;
      const corners = [
        [x0, y0, terrainHeight(x0, y0)],
        [x0 + CELL, y0, terrainHeight(x0 + CELL, y0)],
        [x0 + CELL, y0 + CELL, terrainHeight(x0 + CELL, y0 + CELL)],
        [x0, y0 + CELL, terrainHeight(x0, y0 + CELL)],
      ];
      const scr = corners.map(project);
      if (scr.some(p => p === null)) continue;
      if (scr.every(p => p[0] < -80 || p[0] > W + 80 || p[1] < -80 || p[1] > H + 80)) continue;
      const d = scr.reduce((s, p) => s + p[2], 0) / 4;
      const fogF = Math.min(0.82, Math.max(0, (d - 600) / 2100));
      cells.push({ scr, d, fill: mix(cellFill(x0 + CELL / 2, y0 + CELL / 2, sky), sky.fog, fogF) });
    }
  }
  cells.sort((a, b) => b.d - a.d);
  for (const c of cells) fillQuad(ctx, c.scr, c.fill);

  // Painter-ordered props: ribbons, runways, buildings, trees, gates.
  const props = [];
  const addProp = (wx, wy, wz, draw) => {
    const p = project([wx, wy, wz]);
    if (p) props.push({ d: p[2], draw });
  };

  // River and road ribbons, in segments along y.
  for (let y = Math.floor((fy - VIEW_RANGE) / CELL) * CELL; y < fy + VIEW_RANGE; y += CELL) {
    const rc = riverCenterX(y + CELL / 2);
    addProp(rc, y + CELL / 2, 4, () => {
      const quad = ribbonQuad(project, y, rc, RIVER_HALF_WIDTH, 0.7);
      if (quad) fillQuad(ctx, quad, '#47789f');
    });
    addProp(ROAD_X, y + CELL / 2, 4, () => {
      const quad = ribbonQuad(project, y, ROAD_X, 7, 0.5);
      if (quad) fillQuad(ctx, quad, '#6d6a63');
    });
  }

  for (const r of RUNWAYS) addProp(r.cx, (r.y0 + r.y1) / 2, r.z, () => drawRunway(ctx, project, r));

  for (const h of HOUSES) {
    addProp(h.x, h.y, terrainHeight(h.x, h.y), () => drawBox(ctx, project, h));
  }
  for (const t of TREES) {
    const dx = t.x - flight.x, dy = t.y - flight.y;
    if (dx * dx + dy * dy > 1500 * 1500) continue;
    addProp(t.x, t.y, terrainHeight(t.x, t.y), () => drawTree(ctx, project, t));
  }

  course.rings.forEach((ring, i) => {
    if (ring.passed) return;
    addProp(ring.x, ring.y, ring.z, () =>
      drawRing(ctx, project, ring, i === flight.ringIndex, time, ring.missed ? '#8b9299' : null));
  });
  const fg = course.fuelGate;
  if (!fg.used) {
    addProp(fg.x, fg.y, fg.z, () => drawFuelGate(ctx, project, fg, time));
  }

  props.sort((a, b) => b.d - a.d);
  for (const p of props) p.draw();

  // Clouds drift above everything on the ground but behind the plane.
  const cloudDraws = [];
  for (const c of CLOUDS) {
    const p = project([c.x, c.y, c.z]);
    if (p && p[2] < 3200) cloudDraws.push({ p, c });
  }
  cloudDraws.sort((a, b) => b.p[2] - a.p[2]);
  for (const { p, c } of cloudDraws) {
    const s = (c.s / p[2]) * 700;
    ctx.fillStyle = course.sky === 'dusk' ? 'rgba(246,205,170,0.85)' : 'rgba(255,255,255,0.88)';
    for (const [ox, oy, orr] of [[0, 0, 1], [-0.7, 0.12, 0.66], [0.72, 0.1, 0.7], [0.1, -0.3, 0.6]]) {
      ctx.beginPath();
      ctx.ellipse(p[0] + ox * s, p[1] + oy * s * 0.5, s * orr, s * orr * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Ground shadow: a soft ellipse that tightens as the plane descends.
  const gh = terrainHeight(flight.x, flight.y);
  const agl = flight.z - gh;
  if (agl < 260) {
    const sp = project([flight.x, flight.y, gh + 0.8]);
    if (sp) {
      const r = Math.max(6, 900 / sp[2] * 9) * Math.max(0.35, 1 - agl / 340);
      ctx.beginPath();
      ctx.ellipse(sp[0], sp[1], r, r * 0.36, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(20,26,20,${0.34 * Math.max(0, 1 - agl / 260)})`;
      ctx.fill();
    }
  }

  drawPlane(ctx, project, flight, time);

  // A soft vignette to seat the scene.
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.86);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(8,12,18,0.28)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);
}

function ribbonQuad(project, y, cx, half, lift) {
  const pts = [
    [cx - half, y, 0], [cx + half, y, 0], [cx + half, y + CELL, 0], [cx - half, y + CELL, 0],
  ].map(([x, yy]) => [x, yy, terrainHeight(x, yy) + lift]);
  const scr = pts.map(project);
  if (scr.some(p => p === null)) return null;
  return scr;
}

function drawRunway(ctx, project, r) {
  const z = r.z + 0.55;
  const hw = 17;
  const strip = [
    [r.cx - hw, r.y0, z], [r.cx + hw, r.y0, z], [r.cx + hw, r.y1, z], [r.cx - hw, r.y1, z],
  ].map(project);
  if (strip.some(p => p === null)) return;
  fillQuad(ctx, strip, '#3c4147');
  // Centreline dashes and threshold bars.
  ctx.strokeStyle = 'rgba(240,240,235,0.9)';
  const mid0 = project([r.cx, r.y0, z]);
  const mid1 = project([r.cx, r.y1, z]);
  if (mid0 && mid1) {
    ctx.lineWidth = Math.max(1.5, 260 / mid0[2]);
    ctx.setLineDash([26, 20]);
    ctx.beginPath();
    ctx.moveTo(mid0[0], mid0[1]);
    ctx.lineTo(mid1[0], mid1[1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const endY of [r.y0 + 14, r.y1 - 14]) {
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      const a = project([r.cx + i * 4.4 - 1.6, endY - 9, z]);
      const b = project([r.cx + i * 4.4 + 1.6, endY + 9, z]);
      if (a && b) {
        ctx.fillStyle = 'rgba(240,240,235,0.85)';
        ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]) || 2, Math.abs(b[1] - a[1]) || 2);
      }
    }
  }
  // Edge lights.
  ctx.fillStyle = '#ffd76a';
  for (let y = r.y0; y <= r.y1; y += 62) {
    for (const sx of [-hw - 2.5, hw + 2.5]) {
      const p = project([r.cx + sx, y, z]);
      if (p) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], Math.max(1.4, 120 / p[2]), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawBox(ctx, project, h) {
  const gz = terrainHeight(h.x, h.y);
  const cos = Math.cos(h.rot), sin = Math.sin(h.rot);
  const corner = (lx, ly, lz) => project([
    h.x + lx * cos - ly * sin,
    h.y + lx * sin + ly * cos,
    gz + lz,
  ]);
  const hw = h.w / 2, hd = h.d / 2;
  const base = [corner(-hw, -hd, 0), corner(hw, -hd, 0), corner(hw, hd, 0), corner(-hw, hd, 0)];
  const top = [corner(-hw, -hd, h.h), corner(hw, -hd, h.h), corner(hw, hd, h.h), corner(-hw, hd, h.h)];
  if ([...base, ...top].some(p => p === null)) return;
  const wall = h.kind === 'hangar' ? '#7d8894' : '#cdbb9e';
  const roof = h.kind === 'hangar' ? '#5d686f' : '#9a4a38';
  const faces = [
    { pts: [base[0], base[1], top[1], top[0]], c: shade(wall, 0.92) },
    { pts: [base[1], base[2], top[2], top[1]], c: shade(wall, 0.8) },
    { pts: [base[2], base[3], top[3], top[2]], c: shade(wall, 0.98) },
    { pts: [base[3], base[0], top[0], top[3]], c: shade(wall, 0.86) },
    { pts: top, c: roof },
  ];
  for (const f of faces) fillQuad(ctx, f.pts, f.c);
}

function drawTree(ctx, project, t) {
  const gz = terrainHeight(t.x, t.y);
  const base = project([t.x, t.y, gz]);
  if (!base) return;
  const hPx = (11 * t.s / base[2]) * 700 * 0.14;
  if (hPx < 2) return;
  ctx.strokeStyle = '#5d4630';
  ctx.lineWidth = Math.max(1, hPx * 0.07);
  ctx.beginPath();
  ctx.moveTo(base[0], base[1]);
  ctx.lineTo(base[0], base[1] - hPx * 0.35);
  ctx.stroke();
  ctx.fillStyle = '#3d6b2a';
  for (const [oy, ow] of [[0.3, 0.5], [0.55, 0.38], [0.78, 0.24]]) {
    ctx.beginPath();
    ctx.moveTo(base[0] - hPx * ow, base[1] - hPx * oy);
    ctx.lineTo(base[0] + hPx * ow, base[1] - hPx * oy);
    ctx.lineTo(base[0], base[1] - hPx * (oy + 0.3));
    ctx.closePath();
    ctx.fill();
  }
}

function ringPoints(project, gate, segments = 30) {
  // Orthonormal basis (u, v) spanning the gate's plane.
  const n = [gate.tx, gate.ty, gate.tz];
  let u = Math.abs(n[1]) < 0.9 ? [-n[1], n[0], 0] : [0, -n[2], n[1]];
  const ul = Math.hypot(...u) || 1;
  u = u.map(v => v / ul);
  const v = [
    n[1] * u[2] - n[2] * u[1],
    n[2] * u[0] - n[0] * u[2],
    n[0] * u[1] - n[1] * u[0],
  ];
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    const p = project([
      gate.x + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * gate.r,
      gate.y + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * gate.r,
      gate.z + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * gate.r,
    ]);
    if (p === null) return null;
    pts.push(p);
  }
  return pts;
}

function drawRing(ctx, project, ring, isNext, time, overrideColor) {
  const pts = ringPoints(project, ring);
  if (!pts) return;
  const color = overrideColor ?? (isNext ? '#3ce68f' : '#ffb340');
  const pulse = isNext ? 1 + 0.16 * Math.sin(time * 5) : 1;
  const near = project([ring.x, ring.y, ring.z]);
  const width = Math.max(2, (near ? 900 / near[2] : 4) * 2.4 * pulse);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = 'rgba(20,24,20,0.35)';
  ctx.lineWidth = width * 1.7;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawFuelGate(ctx, project, gate, time) {
  const pts = ringPoints(project, gate);
  if (!pts) return;
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  const near = project([gate.x, gate.y, gate.z]);
  ctx.strokeStyle = '#39c2e6';
  ctx.lineWidth = Math.max(2, (near ? 900 / near[2] : 4) * 2.2);
  ctx.stroke();
  const top = project([gate.x, gate.y, gate.z + gate.r + 9]);
  if (top && near) {
    const size = Math.max(11, 6200 / near[2]);
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#bdeaff';
    ctx.strokeStyle = 'rgba(10,30,40,0.7)';
    ctx.lineWidth = 3;
    const label = 'FUEL +40';
    ctx.strokeText(label, top[0], top[1]);
    ctx.fillText(label, top[0], top[1]);
  }
}
