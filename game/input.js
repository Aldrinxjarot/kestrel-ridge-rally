// input.js — keyboard and mouse control state. Arrow keys (or the stick
// directions they imply) pitch and bank, W/S work the throttle, and single
// key presses (gear, pause, confirm, mute) are queued as edge events the
// shell consumes once. Holding the mouse button and dragging also steers.

export class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.edges = [];
    this.mouseHeld = false;
    this.mouseNX = 0;
    this.mouseNY = 0;
    window.addEventListener('keydown', (e) => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat) {
        this.keys.add(e.code);
        this.edges.push(e.code);
      } else {
        this.keys.add(e.code);
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('pointerdown', (e) => {
      this.mouseHeld = true;
      this.edges.push('PointerDown');
      this.setMouse(e, canvas);
    });
    window.addEventListener('pointerup', () => { this.mouseHeld = false; });
    canvas.addEventListener('pointermove', (e) => { if (this.mouseHeld) this.setMouse(e, canvas); });
  }

  setMouse(e, canvas) {
    const r = canvas.getBoundingClientRect();
    this.mouseNX = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouseNY = ((e.clientY - r.top) / r.height) * 2 - 1;
  }

  /** Continuous control axes for the flight model. */
  axes() {
    let pitch = 0, roll = 0, throttleDelta = 0;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyI')) pitch += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyK')) pitch -= 1;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyJ')) roll -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyL')) roll += 1;
    if (this.keys.has('KeyW') || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) throttleDelta += 1;
    if (this.keys.has('KeyS') || this.keys.has('ControlLeft')) throttleDelta -= 1;
    if (this.mouseHeld) {
      roll = clampN(this.mouseNX * 1.3);
      pitch = clampN(-this.mouseNY * 1.2);
    }
    return { pitch, roll, throttleDelta };
  }

  /** Consume one queued edge press of the given code, if present. */
  pressed(code) {
    const i = this.edges.indexOf(code);
    if (i === -1) return false;
    this.edges.splice(i, 1);
    return true;
  }

  /** Any confirm-style press: Enter, Space or a pointer tap. */
  confirmPressed() {
    return this.pressed('Enter') || this.pressed('Space') || this.pressed('PointerDown');
  }

  clearEdges() {
    this.edges.length = 0;
  }
}

function clampN(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}
