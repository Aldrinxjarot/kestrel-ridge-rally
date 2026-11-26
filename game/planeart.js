// planeart.js — the Kestrel itself: a cream-and-red single-prop rally plane
// built from flat-shaded polygons in its own local frame (x right, y nose,
// z up), transformed by heading, pitch and roll and drawn far-to-near with
// the scene's projector. Includes the spinning prop disc and fixed gear.

const SUN = norm3(-0.55, 0.25, 0.8);

function norm3(x, y, z) {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}

/** Rotation basis for the airframe: columns are local x (right), y (nose), z (up) in world space. */
export function planeBasis(heading, pitch, roll) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fwd = [Math.sin(heading) * cp, Math.cos(heading) * cp, sp];
  let right = [fwd[1], -fwd[0], 0];
  const rl = Math.hypot(right[0], right[1]) || 1;
  right = [right[0] / rl, right[1] / rl, 0];
  let up = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ];
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const r2 = right.map((v, i) => v * cr + up[i] * sr);
  const u2 = up.map((v, i) => up[i] * cr - right[i] * sr);
  return { right: r2, fwd, up: u2 };
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f);
  const g = Math.min(255, ((n >> 8) & 255) * f);
  const b = Math.min(255, (n & 255) * f);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

// Fuselage stations: [y, radius, centreZ]. The tube is a diamond of four
// points per station, giving four shaded sides per segment.
const STATIONS = [
  [-6.8, 0.42, 0.55],
  [-4.4, 0.78, 0.35],
  [-1.2, 1.02, 0.22],
  [2.2, 1.06, 0.22],
  [4.4, 0.88, 0.18],
  [5.4, 0.62, 0.12],
];
const CREAM = '#f0e7d2';
const CREAM_LOW = '#d9cfb6';
const RED = '#bc3a2c';

function buildFaces(gearDown) {
  const faces = [];
  const quad = (pts, color) => faces.push({ pts, color });
  const box = (x0, x1, y0, y1, z0, z1, color) => {
    quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], color); // top
    quad([[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]], color); // bottom
    quad([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], color); // right
    quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], color); // left
    quad([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], color); // front
    quad([[x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]], color); // back
  };

  // Fuselage tube: segment by segment, side by side.
  for (let s = 0; s < STATIONS.length - 1; s++) {
    const [y0, r0, cz0] = STATIONS[s];
    const [y1, r1, cz1] = STATIONS[s + 1];
    const cowl = s >= 3;
    const ring = (y, r, cz) => [[r, y, cz], [0, y, cz + r], [-r, y, cz], [0, y, cz - r]];
    const a = ring(y0, r0, cz0), b = ring(y1, r1, cz1);
    const sideColors = [cowl ? RED : CREAM, cowl ? RED : '#f7efdb', cowl ? RED : CREAM, CREAM_LOW];
    for (let k = 0; k < 4; k++) {
      const k2 = (k + 1) % 4;
      quad([a[k], b[k], b[k2], a[k2]], sideColors[k]);
    }
  }
  // Canopy: a tinted glasshouse over the cabin.
  box(-0.6, 0.6, 0.7, 2.9, 1.05, 1.62, '#2c4d68');
  // Main wing (low, red) with cream tips, tailplane, and the fin.
  box(-5.8, 5.8, -0.3, 1.9, -0.12, 0.14, RED);
  box(-5.8, -4.9, -0.3, 1.9, -0.13, 0.15, CREAM);
  box(4.9, 5.8, -0.3, 1.9, -0.13, 0.15, CREAM);
  box(-2.4, 2.4, -6.9, -5.7, 0.62, 0.8, RED);
  quad([[0, -7.0, 0.5], [0, -5.1, 0.62], [0, -5.5, 2.6], [0, -6.8, 2.35]], RED);
  quad([[0.02, -7.0, 0.5], [0.02, -6.8, 2.35], [0.02, -5.5, 2.6], [0.02, -5.1, 0.62]], RED);
  if (gearDown) {
    box(-1.15, -0.8, 1.1, 1.6, -2.0, -0.6, '#5a5f66');
    box(0.8, 1.15, 1.1, 1.6, -2.0, -0.6, '#5a5f66');
    box(-1.3, -0.62, 1.05, 1.68, -2.35, -1.95, '#23252a');
    box(0.62, 1.3, 1.05, 1.68, -2.35, -1.95, '#23252a');
    box(-0.16, 0.16, -1.2, -0.7, -1.9, -0.7, '#5a5f66');
    box(-0.3, 0.3, -1.25, -0.62, -2.2, -1.85, '#23252a');
  }
  return faces;
}

/**
 * Draw the aircraft at the flight state. `project` maps a world point to
 * [screenX, screenY, cameraDepth] or null when behind the camera.
 */
export function drawPlane(ctx, project, flight, time) {
  const { right, fwd, up } = planeBasis(flight.heading, flight.pitch, flight.roll);
  const toWorld = ([lx, ly, lz]) => [
    flight.x + right[0] * lx + fwd[0] * ly + up[0] * lz,
    flight.y + right[1] * lx + fwd[1] * ly + up[1] * lz,
    flight.z + right[2] * lx + fwd[2] * ly + up[2] * lz,
  ];

  const drawn = [];
  for (const face of buildFaces(flight.gearDown)) {
    const world = face.pts.map(toWorld);
    const scr = world.map(project);
    if (scr.some(p => p === null)) continue;
    const e1 = world[1].map((v, i) => v - world[0][i]);
    const e2 = world[3].map((v, i) => v - world[0][i]);
    const n = norm3(
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0]);
    const light = 0.68 + 0.32 * Math.max(0, n[0] * SUN[0] + n[1] * SUN[1] + n[2] * SUN[2]);
    const depth = scr.reduce((s, p) => s + p[2], 0) / scr.length;
    drawn.push({ scr, fill: shade(face.color, light), depth });
  }
  drawn.sort((a, b) => b.depth - a.depth);
  for (const f of drawn) {
    ctx.beginPath();
    ctx.moveTo(f.scr[0][0], f.scr[0][1]);
    for (let i = 1; i < f.scr.length; i++) ctx.lineTo(f.scr[i][0], f.scr[i][1]);
    ctx.closePath();
    ctx.fillStyle = f.fill;
    ctx.fill();
  }

  // Propeller: a blurred disc plus two blade streaks, spinning with throttle.
  const centre = project(toWorld([0, 5.55, 0.12]));
  if (centre) {
    const rim = project(toWorld([2.7, 5.55, 0.12]));
    const rPx = rim ? Math.hypot(rim[0] - centre[0], rim[1] - centre[1]) : 30;
    ctx.beginPath();
    ctx.arc(centre[0], centre[1], rPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(28,28,32,0.16)';
    ctx.fill();
    const a = time * (6 + flight.throttle * 55);
    ctx.strokeStyle = 'rgba(40,40,44,0.5)';
    ctx.lineWidth = Math.max(2, rPx * 0.09);
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      ctx.moveTo(centre[0] - Math.cos(a + off) * rPx * 0.92, centre[1] - Math.sin(a + off) * rPx * 0.92);
      ctx.lineTo(centre[0] + Math.cos(a + off) * rPx * 0.92, centre[1] + Math.sin(a + off) * rPx * 0.92);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(centre[0], centre[1], Math.max(2.5, rPx * 0.14), 0, Math.PI * 2);
    ctx.fillStyle = '#bc3a2c';
    ctx.fill();
  }
}
