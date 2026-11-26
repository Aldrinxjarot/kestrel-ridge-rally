// flight.js — the Kestrel's flight model and one rally leg's sortie state:
// throttle and speed, pitch and bank, stall and wind, fuel burn, ring and
// fuel-gate crossings, takeoffs, landings (smooth, hard, belly and forced)
// and crashes. Pure simulation: rendering and input live elsewhere.

import { terrainHeight, runwayAt } from './world.js';

const GEAR_HEIGHT = 1.6;          // fuselage origin height above the ground on its gear
const STALL_SPEED = 25;           // m/s, below this the wing stops holding the nose up
const ROTATE_SPEED = 33;          // m/s, earliest a takeoff roll can lift off
const MAX_LANDING_SPEED = 52;     // m/s on the runway
const MAX_FIELD_SPEED = 30;       // m/s for a survivable forced landing

export class Flight {
  constructor(course) {
    this.course = course;
    this.reset();
  }

  reset() {
    const c = this.course;
    this.x = c.startPos.x;
    this.y = c.startPos.y;
    this.z = terrainHeight(this.x, this.y) + GEAR_HEIGHT;
    this.heading = c.startPos.heading;
    this.pitch = 0;
    this.roll = 0;
    this.speed = 0;
    this.vz = 0;
    this.throttle = 0;
    this.onGround = true;
    this.gearDown = true;
    this.fuel = 100;
    this.damage = 0;
    this.engineOut = false;
    this.mode = 'ground'; // ground | air | done | crashed
    this.time = 0;
    this.ringIndex = 0;
    this.ringsPassed = 0;
    this.ringsMissed = 0;
    this.legScore = 0;
    this.landing = null;
    this.crashReason = '';
    this.stalled = false;
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
  }

  get target() {
    return this.course.rings[this.ringIndex] ?? null;
  }

  get ringsDone() {
    return this.ringIndex >= this.course.rings.length;
  }

  /** Current wind in m/s along x, gusty on the dusk leg. */
  windNow() {
    const c = this.course;
    return c.gusty ? c.windX + 5 * Math.sin(this.time * 0.45) : c.windX;
  }

  /**
   * Advance the simulation. ctl: { pitch: -1..1 (nose up +), roll: -1..1
   * (right +), throttleDelta: -1..1, gearToggle: bool }.
   * Returns an array of event objects for the shell to score and announce.
   */
  update(dt, ctl) {
    const events = [];
    if (this.mode === 'done' || this.mode === 'crashed') return events;
    this.time += dt;
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;

    if (ctl.gearToggle && !this.onGround) {
      this.gearDown = !this.gearDown;
      events.push({ type: 'gear', down: this.gearDown });
    }

    // Throttle and engine.
    if (!this.engineOut) {
      this.throttle = clamp(this.throttle + ctl.throttleDelta * dt * 0.7, 0, 1);
      this.fuel -= (0.16 + 0.5 * this.throttle) * dt;
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.engineOut = true;
        this.throttle = 0;
        events.push({ type: 'flameout' });
      }
    }

    const limp = this.damage >= 60 ? 0.8 : 1;
    const targetSpeed = this.engineOut ? 0 : (16 + this.throttle * 64) * limp;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 0.45);
    // Trading height for speed: climbing bleeds speed, diving gains it.
    this.speed -= Math.sin(this.pitch) * 9.8 * dt * 0.55;
    this.speed = Math.max(0, this.speed);

    if (this.onGround) this.updateGround(dt, ctl, events);
    else this.updateAir(dt, ctl, events);

    if (this.mode === 'air') {
      this.checkGateCrossings(events);
    }
    return events;
  }

  updateGround(dt, ctl, events) {
    const groundZ = terrainHeight(this.x, this.y) + GEAR_HEIGHT;
    this.z = groundZ;
    this.vz = 0;
    // Rudder steering fades as speed builds.
    this.heading += ctl.roll * dt * 0.55 * Math.max(0, 1 - this.speed / 90);
    this.roll = ctl.roll * 0.25 * Math.min(1, this.speed / 40);
    this.pitch = 0;
    const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
    this.x += fx * this.speed * dt;
    this.y += fy * this.speed * dt;
    if (ctl.pitch > 0.25 && this.speed >= ROTATE_SPEED) {
      this.onGround = false;
      this.mode = 'air';
      this.pitch = 0.12;
      events.push({ type: 'liftoff' });
    } else if (this.speed > 4 && runwayAt(this.x, this.y) === null && this.speed > 20) {
      // Rolled off the strip at speed: rough ground ends the roll.
      this.crash(events, 'ran off the runway and dug in');
    }
  }

  updateAir(dt, ctl, events) {
    // The elevator works as a trim: push or pull to change the pitch and
    // the aeroplane HOLDS that attitude, so a descent or climb can be set
    // and kept hands-off. The bank, by contrast, eases back toward level
    // when the stick is released.
    this.pitch = clamp(this.pitch + ctl.pitch * 0.62 * dt, -0.52, 0.55);
    const rollTarget = ctl.roll * 1.05;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 2.6);

    // A banked wing turns the nose; the turn tightens as speed falls.
    const turnRate = (9.8 * Math.tan(this.roll)) / Math.max(this.speed, 24) * 0.85;
    this.heading += turnRate * dt;

    this.stalled = this.speed < STALL_SPEED;
    let sink = this.stalled ? (STALL_SPEED - this.speed) * 1.15 : 0;
    if (this.engineOut) sink += 2.2;
    this.vz = this.speed * Math.sin(this.pitch) - sink;

    const fx = Math.sin(this.heading), fy = Math.cos(this.heading);
    const vh = this.speed * Math.cos(this.pitch);
    this.x += fx * vh * dt + this.windNow() * dt;
    this.y += fy * vh * dt;
    this.z += this.vz * dt;
    if (this.z > 470) { this.z = 470; this.vz = Math.min(this.vz, 0); }

    const groundZ = terrainHeight(this.x, this.y) + GEAR_HEIGHT;
    if (this.z <= groundZ) {
      this.z = groundZ;
      this.touchdown(events);
    }
  }

  touchdown(events) {
    const rw = runwayAt(this.x, this.y);
    const vz = this.vz, speed = this.speed;
    if (rw) {
      const alignErr = Math.min(
        angleDiff(this.heading, rw.dir), angleDiff(this.heading, rw.dir + Math.PI));
      if (!this.gearDown) {
        if (vz >= -3.2 && speed <= 46) {
          this.damage += 45;
          this.finishLanding(events, { runway: rw, belly: true, alignErr });
        } else {
          this.crash(events, 'belly-flopped onto the runway too hard');
        }
        return;
      }
      if (vz < -5.2) { this.crash(events, 'slammed into the runway'); return; }
      if (speed > MAX_LANDING_SPEED) { this.crash(events, 'ran out of runway at speed'); return; }
      const hard = vz < -3.8;
      if (hard) this.damage += 18;
      this.finishLanding(events, { runway: rw, belly: false, hard, alignErr });
      return;
    }
    // Off the strip: a gentle arrival on flat ground is a forced landing.
    if (vz >= -2.6 && speed <= MAX_FIELD_SPEED) {
      this.damage += 20;
      this.mode = 'done';
      this.onGround = true;
      this.landing = { forced: true, runway: null };
      events.push({ type: 'forced', damage: this.damage });
    } else {
      this.crash(events, this.z > 120 ? 'flew into the ridge' : 'hit the ground');
    }
  }

  finishLanding(events, info) {
    this.mode = 'done';
    this.onGround = true;
    this.landing = { forced: false, ...info };
    events.push({ type: 'landed', ...info, vz: this.vz, speed: this.speed });
  }

  crash(events, reason) {
    this.mode = 'crashed';
    this.crashReason = reason;
    this.damage = 100;
    events.push({ type: 'crash', reason });
  }

  /** Ring and fuel-gate plane crossings between the last two positions. */
  checkGateCrossings(events) {
    const gate = this.target;
    if (gate && !gate.passed && !gate.missed) {
      const res = this.crossing(gate);
      if (res !== null) {
        if (res <= gate.r) {
          gate.passed = true;
          this.ringsPassed++;
          const centreBonus = Math.round(150 * (1 - res / gate.r));
          const points = 250 + centreBonus;
          this.legScore += points;
          events.push({ type: 'ring', points, centreBonus, index: this.ringIndex });
        } else if (res <= gate.r * 3.2) {
          gate.missed = true;
          this.ringsMissed++;
          events.push({ type: 'ringmiss', index: this.ringIndex });
        }
        if (gate.passed || gate.missed) this.ringIndex++;
      }
    }
    const fg = this.course.fuelGate;
    if (fg && !fg.used) {
      const res = this.crossing(fg);
      if (res !== null && res <= fg.r) {
        fg.used = true;
        this.fuel = Math.min(100, this.fuel + 40);
        this.legScore += 100;
        events.push({ type: 'fuelgate', points: 100 });
      }
    }
  }

  /**
   * If the segment prev->now crosses the gate's plane, return the radial
   * distance from the gate centre at the crossing point, else null.
   */
  crossing(gate) {
    const s0 = (this.prevX - gate.x) * gate.tx + (this.prevY - gate.y) * gate.ty + (this.prevZ - gate.z) * gate.tz;
    const s1 = (this.x - gate.x) * gate.tx + (this.y - gate.y) * gate.ty + (this.z - gate.z) * gate.tz;
    if (s0 > 0 || s1 <= 0) return null; // only count flying through, front to back
    const t = s0 / (s0 - s1);
    const px = this.prevX + (this.x - this.prevX) * t;
    const py = this.prevY + (this.y - this.prevY) * t;
    const pz = this.prevZ + (this.z - this.prevZ) * t;
    const dx = px - gate.x, dy = py - gate.y, dz = pz - gate.z;
    const along = dx * gate.tx + dy * gate.ty + dz * gate.tz;
    return Math.hypot(dx - along * gate.tx, dy - along * gate.ty, dz - along * gate.tz);
  }
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function angleDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}
