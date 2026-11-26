// main.js — the shell of Kestrel Ridge Rally: it owns the rally state
// (score, lives, legs), runs the frame loop, feeds input to the flight
// model, turns flight events into score and messages, draws the scene and
// HUD, and paints the menu, briefing, pause, crash and results overlays.

import { buildCourse } from './world.js';
import { Flight } from './flight.js';
import { makeCamera, drawScene } from './render.js';
import { drawHud, formatTime } from './hud.js';
import { Input } from './input.js';
import { SoundEngine } from './audio.js';

const canvas = document.getElementById('sky');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;

const input = new Input(canvas);
const sound = new SoundEngine();
const cam = makeCamera();

const rally = {
  phase: 'menu', // menu | brief | fly | pause | crash | legdone | over | complete
  leg: 0,
  score: 0,
  lives: 3,
  legTime: 0,
  courseName: '',
  ringTotal: 0,
  muted: false,
  crashTimer: 0,
  summary: [],
};

let course = buildCourse(0);
let flight = new Flight(course);
let messages = [];
let lastTs = performance.now();
let elapsed = 0;

function say(text, color = '#e8f1f8', size = 25, ttl = 2.2) {
  messages.push({ text, color, size, ttl });
  if (messages.length > 3) messages.shift();
}

function startLeg(legIndex) {
  course = buildCourse(legIndex);
  flight = new Flight(course);
  rally.leg = legIndex;
  rally.courseName = course.name;
  rally.ringTotal = course.rings.length;
  rally.legTime = 0;
  messages = [];
  cam.ready = false;
  rally.phase = 'brief';
}

function beginRally() {
  rally.score = 0;
  rally.lives = 3;
  startLeg(0);
}

// A gently autopiloted Kestrel wanders the valley behind the menu.
const menuFlight = new Flight(buildCourse(0));
menuFlight.onGround = false;
menuFlight.mode = 'air';
menuFlight.z = 120;
menuFlight.speed = 46;
menuFlight.throttle = 0.55;
menuFlight.fuel = 100;

function autopilot(dt) {
  // Steer the held pitch toward a gentle altitude-keeping attitude.
  const wantPitch = Math.max(-0.22, Math.min(0.28, (115 - menuFlight.z) * 0.008));
  const ctl = {
    pitch: Math.max(-1, Math.min(1, (wantPitch - menuFlight.pitch) * 3)),
    roll: Math.sin(elapsed * 0.25) * 0.35,
    throttleDelta: 0,
    gearToggle: false,
  };
  menuFlight.update(dt, ctl);
  if (menuFlight.mode === 'crashed' || menuFlight.mode === 'done' || menuFlight.fuel < 30) {
    menuFlight.reset();
    menuFlight.onGround = false;
    menuFlight.mode = 'air';
    menuFlight.z = 120;
    menuFlight.speed = 46;
    menuFlight.throttle = 0.55;
  }
}

function handleEvents(events) {
  for (const ev of events) {
    switch (ev.type) {
      case 'liftoff':
        sound.liftoff();
        say('AIRBORNE', '#7fd08a', 24);
        break;
      case 'ring':
        sound.ring();
        say(`RING +${ev.points}`, '#3ce68f', 27);
        break;
      case 'ringmiss':
        say('RING MISSED', '#ffb340', 21);
        break;
      case 'fuelgate':
        sound.fuelGate();
        say('FUEL +40 · +100', '#57b6e6', 24);
        break;
      case 'flameout':
        say('ENGINE OUT — GLIDE TO A LANDING', '#ff6a55', 23, 3.2);
        break;
      case 'gear':
        sound.gear();
        break;
      case 'landed': {
        sound.touchdown();
        const lines = [];
        let points = flight.legScore;
        lines.push(`Rings and gates: ${flight.legScore}`);
        if (ev.belly) {
          points += 50;
          lines.push('Belly landing on the strip: +50');
        } else {
          points += 300;
          lines.push('Touchdown: +300');
          if (ev.vz >= -2) { points += 200; lines.push('Greased it: +200'); }
          else if (ev.vz >= -3.8) { points += 100; lines.push('Firm arrival: +100'); }
          else lines.push('Hard landing — the hull took a knock');
          if (ev.alignErr <= 0.3) { points += 50; lines.push('Straight in: +50'); }
        }
        const fuelBonus = Math.round(flight.fuel) * 2;
        points += fuelBonus;
        lines.push(`Fuel in hand: +${fuelBonus}`);
        const timeBonus = Math.max(0, Math.round(course.par - rally.legTime)) * 2;
        if (timeBonus > 0) { points += timeBonus; lines.push(`Ahead of par: +${timeBonus}`); }
        lines.push(`Leg total: ${points}`);
        rally.score += points;
        rally.summary = lines;
        rally.phase = 'legdone';
        break;
      }
      case 'forced':
        rally.score += flight.legScore;
        rally.summary = [
          `Rings and gates: ${flight.legScore}`,
          'Forced landing in a field — no arrival bonus.',
          `Leg total: ${flight.legScore}`,
        ];
        rally.phase = 'legdone';
        break;
      case 'crash':
        sound.crash();
        rally.lives -= 1;
        rally.crashTimer = 2.4;
        rally.phase = 'crash';
        break;
    }
  }
}

function update(dt) {
  elapsed += dt;
  for (const m of messages) m.ttl -= dt;
  messages = messages.filter(m => m.ttl > 0);

  if (input.pressed('KeyM')) {
    rally.muted = !rally.muted;
    sound.setMuted(rally.muted);
  }

  switch (rally.phase) {
    case 'menu':
      autopilot(dt);
      if (input.confirmPressed()) { sound.ensure(); beginRally(); }
      break;
    case 'brief':
      if (input.confirmPressed()) { sound.ensure(); rally.phase = 'fly'; input.clearEdges(); }
      break;
    case 'fly': {
      rally.legTime += dt;
      const axes = input.axes();
      const events = flight.update(dt, { ...axes, gearToggle: input.pressed('KeyG') });
      handleEvents(events);
      sound.update(flight);
      if (flight.stalled || (flight.fuel < 22 && !flight.onGround) || flight.engineOut) {
        sound.warn(elapsed);
      }
      if (input.pressed('KeyP') || input.pressed('Escape')) rally.phase = 'pause';
      break;
    }
    case 'pause':
      if (input.pressed('KeyP') || input.pressed('Escape') || input.confirmPressed()) rally.phase = 'fly';
      break;
    case 'crash':
      rally.crashTimer -= dt;
      if (rally.crashTimer <= 0 || input.confirmPressed()) {
        if (rally.lives > 0) startLeg(rally.leg);
        else rally.phase = 'over';
        input.clearEdges();
      }
      break;
    case 'legdone':
      if (input.confirmPressed()) {
        if (rally.leg >= 2) rally.phase = 'complete';
        else startLeg(rally.leg + 1);
        input.clearEdges();
      }
      break;
    case 'over':
    case 'complete':
      autopilot(dt);
      if (input.confirmPressed()) { beginRally(); input.clearEdges(); }
      break;
  }
  input.edges = input.edges.filter(c => c === 'KeyM');
}

// --- overlays ---------------------------------------------------------------

function overlayBox(w, h) {
  ctx.fillStyle = 'rgba(8,13,19,0.66)';
  ctx.beginPath();
  ctx.roundRect(W / 2 - w / 2, H / 2 - h / 2, w, h, 16);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,215,106,0.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function line(text, y, size = 19, color = '#e8f1f8', weight = 600) {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

function drawOverlays() {
  const cy = H / 2;
  switch (rally.phase) {
    case 'menu':
      overlayBox(700, 430);
      line('KESTREL RIDGE RALLY', cy - 168, 44, '#ffd76a', 800);
      line('A three-leg air rally up the Kestrel valley.', cy - 118, 19);
      line('Take off, thread every glowing ring, mind your fuel —', cy - 82, 17, '#9fb6c6');
      line('detour through the blue FUEL gate if you run low —', cy - 58, 17, '#9fb6c6');
      line('then land on the far runway to bank the leg.', cy - 34, 17, '#9fb6c6');
      line('↑ climb · ↓ dive · ← → bank and steer · W/S throttle', cy + 16, 17);
      line('G landing gear · P pause · M mute · drag with the mouse to steer', cy + 42, 17);
      line('Three aeroplanes. Land all three legs to win the rally.', cy + 84, 17, '#9fb6c6');
      line('ENTER OR CLICK TO FLY', cy + 140, 23, '#3ce68f', 800);
      break;
    case 'brief': {
      overlayBox(640, 300);
      line(course.name.toUpperCase(), cy - 104, 30, '#ffd76a', 800);
      line(`Take off from ${course.start.name} and fly ${course.rings.length} rings`, cy - 52, 18);
      line(`Land at ${course.finish.name}. Par ${formatTime(course.par)}.`, cy - 24, 18);
      if (course.windX !== 0) {
        line(`Crosswind ${course.windX > 0 ? 'from the west' : 'from the east'}${course.gusty ? ', gusting' : ''} — crab into it.`, cy + 8, 17, '#ffb340');
      } else {
        line('Calm air. A clean run beats par.', cy + 8, 17, '#9fb6c6');
      }
      line('Full throttle to roll — pull up past 65 knots.', cy + 44, 17, '#9fb6c6');
      line('ENTER TO ROLL', cy + 96, 22, '#3ce68f', 800);
      break;
    }
    case 'pause':
      overlayBox(300, 130);
      line('PAUSED', cy - 18, 30, '#ffd76a', 800);
      line('P to resume', cy + 28, 16, '#9fb6c6');
      break;
    case 'crash':
      overlayBox(640, 210);
      line('CRASHED', cy - 62, 36, '#ff6a55', 800);
      line(`The Kestrel ${flight.crashReason}.`, cy - 14, 18);
      line(rally.lives > 0 ? `${rally.lives} aeroplane${rally.lives > 1 ? 's' : ''} left — ENTER to fly the leg again`
        : 'That was the last aeroplane.', cy + 30, 17, '#9fb6c6');
      break;
    case 'legdone': {
      const forced = flight.landing?.forced;
      overlayBox(560, 330);
      line(forced ? 'DOWN IN A FIELD' : `LANDED AT ${course.finish.name.toUpperCase()}`, cy - 132, 27, forced ? '#ffb340' : '#3ce68f', 800);
      rally.summary.forEach((s, i) => line(s, cy - 84 + i * 30, 18, i === rally.summary.length - 1 ? '#ffd76a' : '#e8f1f8', i === rally.summary.length - 1 ? 800 : 500));
      line(rally.leg >= 2 ? 'ENTER FOR THE RESULT' : 'ENTER FOR THE NEXT LEG', cy + 128, 20, '#3ce68f', 800);
      break;
    }
    case 'over':
      overlayBox(620, 300);
      line('RALLY OVER', cy - 100, 38, '#ff6a55', 800);
      line(`Final score ${rally.score}`, cy - 40, 24, '#ffd76a', 800);
      line(`You reached ${course.name} with ${rally.lives} aeroplanes left to lose —`, cy + 8, 17, '#9fb6c6');
      line('the valley keeps the trophy this year.', cy + 34, 17, '#9fb6c6');
      line('ENTER TO FLY AGAIN', cy + 96, 21, '#3ce68f', 800);
      break;
    case 'complete':
      overlayBox(620, 300);
      line('RALLY COMPLETE!', cy - 100, 38, '#3ce68f', 800);
      line(`Final score ${rally.score}`, cy - 40, 24, '#ffd76a', 800);
      line(`All three legs landed, ${rally.lives} of 3 aeroplanes still flying.`, cy + 8, 17, '#9fb6c6');
      line('The Kestrel Ridge trophy is yours.', cy + 34, 17, '#9fb6c6');
      line('ENTER TO FLY AGAIN', cy + 96, 21, '#3ce68f', 800);
      break;
  }
}

// --- frame loop ---------------------------------------------------------------

function frame(ts) {
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  update(dt);
  const shown = ['menu', 'over', 'complete'].includes(rally.phase) ? menuFlight : flight;
  const shownCourse = shown === menuFlight ? menuFlight.course : course;
  drawScene(ctx, W, H, shown, shownCourse, cam, dt, elapsed);
  if (rally.phase !== 'menu') {
    drawHud(ctx, W, H, flight, { ...rally, legTime: rally.legTime }, messages, elapsed);
  }
  drawOverlays();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// A small staging hook: lets the maker (and only the maker, locally) pose
// the aeroplane for screenshots and smoke tests. Harmless in play.
window.KestrelRally = {
  rally,
  get flight() { return flight; },
  get course() { return course; },
  start() { beginRally(); rally.phase = 'fly'; },
  setFlight(patch) {
    Object.assign(flight, patch);
    if (patch.mode === 'air') flight.onGround = false;
    if (patch.mode === 'ground') flight.onGround = true;
  },
  stageApproach() {
    for (const r of course.rings) r.passed = true;
    flight.ringIndex = course.rings.length;
    const f = course.finish;
    const dir = course.landDir;
    flight.mode = 'air';
    flight.onGround = false;
    flight.x = f.cx - Math.sin(dir) * 750;
    flight.y = (dir === 0 ? f.y0 : f.y1) - Math.cos(dir) * 750;
    flight.z = f.z + 95;
    flight.heading = dir;
    flight.pitch = -0.04;
    flight.roll = 0;
    flight.speed = 40;
    flight.throttle = 0.35;
    flight.gearDown = true;
    cam.ready = false;
  },
};
