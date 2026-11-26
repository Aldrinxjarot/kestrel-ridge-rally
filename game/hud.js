// hud.js — everything painted over the 3D scene: the heading tape, round
// airspeed and altimeter dials with digital readouts, the artificial
// horizon, fuel and hull bars, the gear light, the target arrow, centre
// messages and flashing warnings. If it shows a number, it comes from the
// flight state, so the panel always reads like a flown aeroplane.

import { angleDiff } from './flight.js';
import { terrainHeight } from './world.js';

const INK = '#e8f1f8';
const DIM = '#9fb6c6';
const PANEL = 'rgba(10,16,22,0.55)';

function panel(ctx, x, y, w, h, r = 10) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = PANEL;
  ctx.fill();
}

function text(ctx, str, x, y, size, color = INK, align = 'left', weight = 600) {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

export function drawHud(ctx, W, H, flight, rally, messages, time) {
  const knots = flight.speed * 1.944;
  const feet = flight.z * 3.281;
  const agl = flight.z - terrainHeight(flight.x, flight.y);
  const headingDeg = ((flight.heading * 180 / Math.PI) % 360 + 360) % 360;

  drawScoreBlock(ctx, flight, rally);
  drawHeadingTape(ctx, W, headingDeg);
  drawTargetArrow(ctx, W, flight, time);
  drawDial(ctx, 92, H - 96, 62, knots, 180, 'SPD', 'kt', knots > 165 ? '#ff5d4d' : null);
  drawAltimeter(ctx, W - 92, H - 96, 62, feet);
  drawHorizon(ctx, W / 2, H - 84, 54, flight);
  drawBars(ctx, W, H, flight, agl, time);
  drawWarnings(ctx, W, H, flight, agl, time);
  drawMessages(ctx, W, H, messages);
  if (rally.phase === 'fly' && rally.legTime < 6) {
    text(ctx, '↑ climb · ↓ dive · ← → bank · W/S throttle · G gear · P pause',
      W / 2, H - 18, 14, 'rgba(232,241,248,0.75)', 'center', 500);
  }
}

function drawScoreBlock(ctx, flight, rally) {
  panel(ctx, 14, 12, 218, 86);
  text(ctx, `SCORE ${rally.score + flight.legScore}`, 28, 36, 21, '#ffd76a');
  text(ctx, rally.courseName, 28, 60, 13.5, INK);
  const total = rally.ringTotal;
  text(ctx, `RINGS ${flight.ringsPassed}/${total}   ·   ${formatTime(rally.legTime)}`, 28, 80, 13.5, DIM);
  // Lives as little plane silhouettes.
  for (let i = 0; i < rally.lives; i++) {
    text(ctx, '✈', 196 - i * 22, 34, 17, '#7fd08a', 'center');
  }
}

function drawHeadingTape(ctx, W, headingDeg) {
  const cx = W / 2, y = 14, w = 360;
  panel(ctx, cx - w / 2, y, w, 44);
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - w / 2 + 6, y, w - 12, 44);
  ctx.clip();
  const pxPerDeg = 3.4;
  for (let d = -60; d <= 60; d += 5) {
    const deg = Math.round((headingDeg + d) / 5) * 5;
    const shown = ((deg % 360) + 360) % 360;
    const x = cx + (deg - headingDeg) * pxPerDeg;
    ctx.strokeStyle = DIM;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y + 30);
    ctx.lineTo(x, y + (shown % 30 === 0 ? 20 : 25));
    ctx.stroke();
    if (shown % 30 === 0) {
      const label = shown === 0 ? 'N' : shown === 90 ? 'E' : shown === 180 ? 'S' : shown === 270 ? 'W'
        : String(shown / 10).padStart(2, '0');
      text(ctx, label, x, y + 11, 12.5, INK, 'center');
    }
  }
  ctx.restore();
  ctx.fillStyle = '#ffd76a';
  ctx.beginPath();
  ctx.moveTo(cx - 6, y + 44);
  ctx.lineTo(cx + 6, y + 44);
  ctx.lineTo(cx, y + 36);
  ctx.closePath();
  ctx.fill();
  text(ctx, `${String(Math.round(headingDeg)).padStart(3, '0')}°`, cx, y + 58, 14, '#ffd76a', 'center', 700);
}

function drawTargetArrow(ctx, W, flight, time) {
  const target = flight.target ?? (flight.ringsDone ? flight.course.finish : null);
  if (!target || flight.mode === 'done') return;
  const tx = target.cx !== undefined ? target.cx : target.x;
  const ty = target.y1 !== undefined ? (target.y0 + target.y1) / 2 : target.y;
  const bearing = Math.atan2(tx - flight.x, ty - flight.y);
  let rel = bearing - flight.heading;
  while (rel > Math.PI) rel -= Math.PI * 2;
  while (rel < -Math.PI) rel += Math.PI * 2;
  const dist = Math.hypot(tx - flight.x, ty - flight.y);
  const cx = W / 2, cy = 96;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rel);
  ctx.fillStyle = flight.target ? '#3ce68f' : '#ffd76a';
  ctx.beginPath();
  ctx.moveTo(0, -11);
  ctx.lineTo(7, 8);
  ctx.lineTo(0, 3);
  ctx.lineTo(-7, 8);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  text(ctx, `${flight.target ? 'RING' : 'RUNWAY'} ${Math.round(dist)}m`, cx, cy + 24, 12.5, DIM, 'center');
}

function drawDial(ctx, cx, cy, r, value, max, label, unit, redColor) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8,13,18,0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,220,235,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
  for (let i = 0; i <= 6; i++) {
    const v = (max / 6) * i;
    const a = a0 + (a1 - a0) * (v / max);
    ctx.strokeStyle = DIM;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * (r - 9), cy + Math.sin(a) * (r - 9));
    ctx.lineTo(cx + Math.cos(a) * (r - 3), cy + Math.sin(a) * (r - 3));
    ctx.stroke();
    text(ctx, String(Math.round(v)), cx + Math.cos(a) * (r - 19), cy + Math.sin(a) * (r - 19), 11, DIM, 'center');
  }
  const a = a0 + (a1 - a0) * Math.min(1, value / max);
  ctx.strokeStyle = redColor ?? '#ffd76a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(a) * (r - 14), cy + Math.sin(a) * (r - 14));
  ctx.stroke();
  text(ctx, label, cx, cy + r * 0.42, 12, DIM, 'center', 700);
  text(ctx, `${Math.round(value)}${unit}`, cx, cy + r + 14, 14, INK, 'center', 700);
}

function drawAltimeter(ctx, cx, cy, r, feet) {
  drawDial(ctx, cx, cy, r, feet % 1000, 1000, 'ALT', '', null);
  text(ctx, `${Math.round(feet)} ft`, cx, cy + r + 14, 14, INK, 'center', 700);
}

function drawHorizon(ctx, cx, cy, r, flight) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-flight.roll);
  const pitchPx = flight.pitch * 90;
  ctx.fillStyle = '#5f97c4';
  ctx.fillRect(-r * 1.6, -r * 1.6 + pitchPx, r * 3.2, r * 1.6);
  ctx.fillStyle = '#7a5c38';
  ctx.fillRect(-r * 1.6, pitchPx, r * 3.2, r * 1.6);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  for (const p of [-20, -10, 10, 20]) {
    const y = pitchPx - p * 1.6;
    const w = p % 20 === 0 ? 20 : 12;
    ctx.beginPath();
    ctx.moveTo(-w, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(200,220,235,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Fixed aircraft symbol.
  ctx.strokeStyle = '#ffd76a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - 26, cy);
  ctx.lineTo(cx - 8, cy);
  ctx.lineTo(cx - 8, cy + 6);
  ctx.moveTo(cx + 26, cy);
  ctx.lineTo(cx + 8, cy);
  ctx.lineTo(cx + 8, cy + 6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffd76a';
  ctx.fill();
}

function drawBars(ctx, W, H, flight, agl, time) {
  const x = W - 52, y0 = 120, hgt = 150;
  // Fuel.
  panel(ctx, x - 8, y0 - 26, 44, hgt + 62);
  text(ctx, 'FUEL', x + 14, y0 - 12, 11.5, DIM, 'center', 700);
  const fh = hgt * (flight.fuel / 100);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x + 4, y0, 20, hgt);
  ctx.fillStyle = flight.fuel < 25 && Math.sin(time * 6) > 0 ? '#ff5d4d' : '#57b6e6';
  ctx.fillRect(x + 4, y0 + hgt - fh, 20, fh);
  text(ctx, `${Math.round(flight.fuel)}%`, x + 14, y0 + hgt + 14, 12, INK, 'center', 700);
  // Hull.
  text(ctx, 'HULL', x + 14, y0 + hgt + 32, 11.5, DIM, 'center', 700);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(x + 4, y0 + hgt + 42, 20, 8);
  ctx.fillStyle = flight.damage > 55 ? '#ff5d4d' : '#7fd08a';
  ctx.fillRect(x + 4, y0 + hgt + 42, 20 * (1 - flight.damage / 100), 8);
  // Gear light and AGL readout.
  const gy = y0 + hgt + 66;
  ctx.beginPath();
  ctx.arc(x + 14, gy, 8, 0, Math.PI * 2);
  ctx.fillStyle = flight.gearDown ? '#3ce68f' : '#ff5d4d';
  ctx.fill();
  text(ctx, 'GEAR', x + 14, gy + 20, 11, DIM, 'center', 700);
  text(ctx, `AGL ${Math.max(0, Math.round(agl * 3.281))} ft`, x + 14, gy + 40, 11.5, INK, 'center');
  // Throttle.
  text(ctx, `THR ${Math.round(flight.throttle * 100)}%`, 92, H - 190, 13, DIM, 'center');
}

function drawWarnings(ctx, W, H, flight, agl, time) {
  const warnings = [];
  if (flight.stalled && !flight.onGround) warnings.push('STALL');
  if (flight.engineOut) warnings.push('ENGINE OUT — GLIDE');
  else if (flight.fuel < 22 && !flight.onGround) warnings.push('LOW FUEL');
  if (!flight.onGround && agl < 55 && flight.vz < -4) warnings.push('PULL UP');
  if (!flight.gearDown && !flight.onGround && agl < 90) warnings.push('GEAR UP');
  if (warnings.length === 0 || Math.sin(time * 7) < -0.25) return;
  text(ctx, warnings.join('   ·   '), W / 2, 132, 21, '#ff6a55', 'center', 800);
}

function drawMessages(ctx, W, H, messages) {
  let y = 176;
  for (const m of messages) {
    const a = Math.min(1, m.ttl / 0.5);
    ctx.globalAlpha = a;
    text(ctx, m.text, W / 2, y, m.size ?? 25, m.color, 'center', 800);
    ctx.globalAlpha = 1;
    y += 34;
  }
}

export function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
