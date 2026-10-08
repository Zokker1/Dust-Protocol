// Source-engine style movement: ground friction + acceleration (counter-strafing
// works), air-acceleration with the 30u/s wish cap (air-strafing works), 18u step
// climbing, crouching, jump buffering. All constants are CS values in Source units.
import * as THREE from 'three';
import { clamp } from './utils.js';

const GRAVITY = 800, JUMP_VEL = 301.99;
const FRICTION = 5.2, STOPSPEED = 80, ACCEL = 5.5;
const AIR_ACCEL = 12, AIR_CAP = 30;
const STEP = 18, HW = 16, EPS = 0.03;
const H_STAND = 72, H_DUCK = 54, EYE_STAND = 64, EYE_DUCK = 46;
const DUCK_MOD = 0.34, WALK_MOD = 0.52;

export class PlayerController {
  constructor(game) {
    this.game = game;
    this.pos = new THREE.Vector3(0, 1, -1080); // feet
    this.vel = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = 0;
    this.punchPitch = 0;
    this.punchYaw = 0;
    this.onGround = false;
    this.ducked = false;
    this.height = H_STAND;
    this.eyeH = EYE_STAND;
    this.speedXZ = 0;
    this.bobCycle = 0;
    this.stepDist = 0;
    this.jumpBuffer = 0;
    this.dead = false;
  }

  look(dx, dy, sens) {
    this.yaw -= dx * sens;
    this.pitch = clamp(this.pitch - dy * sens, -1.55, 1.55);
  }

  addPunch(p, y) {
    this.punchPitch = clamp(this.punchPitch + p, -0.35, 0.35);
    this.punchYaw = clamp(this.punchYaw + y, -0.2, 0.2);
  }

  eyePos() {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.eyeH, this.pos.z);
  }

  lookDir() {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  rightDir() {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  respawn(pos) {
    this.pos.copy(pos);
    this.vel.set(0, 0, 0);
    this.dead = false;
    this.punchPitch = this.punchYaw = 0;
  }

  _overlap(x = this.pos.x, y = this.pos.y, z = this.pos.z, h = this.height) {
    for (const b of this.game.world.colliders) {
      if (x - HW < b.maxX && x + HW > b.minX &&
          y < b.maxY && y + h > b.minY &&
          z - HW < b.maxZ && z + HW > b.minZ) return b;
    }
    return null;
  }

  _slideAxis(key, delta) {
    if (Math.abs(delta) < 1e-7) return false;
    const p = this.pos;
    p[key] += delta;
    let hit = false;
    for (let i = 0; i < 4; i++) {
      const b = this._overlap();
      if (!b) break;
      hit = true;
      if (key === 'x') p.x = delta > 0 ? b.minX - HW - EPS : b.maxX + HW + EPS;
      else p.z = delta > 0 ? b.minZ - HW - EPS : b.maxZ + HW + EPS;
    }
    return hit;
  }

  _moveY(delta) {
    const p = this.pos;
    p.y += delta;
    let hit = false;
    for (let i = 0; i < 4; i++) {
      const b = this._overlap();
      if (!b) break;
      hit = true;
      if (delta <= 0) p.y = b.maxY + EPS;
      else p.y = b.minY - this.height - EPS;
    }
    return hit;
  }

  _moveHoriz(key, delta) {
    const sx = this.pos.x, sy = this.pos.y, sz = this.pos.z;
    const blocked = this._slideAxis(key, delta);
    if (!blocked || !this.onGround) return blocked;
    const slidX = this.pos.x, slidZ = this.pos.z;
    // retry from the start position, lifted by STEP, then settle back down
    this.pos.set(sx, sy + STEP, sz);
    if (this._overlap()) {
      this.pos.set(slidX, sy, slidZ);
      return blocked;
    }
    this._slideAxis(key, delta);
    const landed = this._moveY(-STEP - 1);
    const prog0 = key === 'x' ? Math.abs(slidX - sx) : Math.abs(slidZ - sz);
    const prog1 = key === 'x' ? Math.abs(this.pos.x - sx) : Math.abs(this.pos.z - sz);
    if (!landed || prog1 <= prog0 + 0.01) {
      this.pos.set(slidX, sy, slidZ);
      return blocked;
    }
    return false;
  }

  update(dt, input, maxSpeed) {
    const v = this.vel;
    if (input.jumpPressed) { this.jumpBuffer = 0.1; input.jumpPressed = false; }
    this.jumpBuffer -= dt;

    // wish direction from keys, relative to yaw
    let fx = 0, fz = 0;
    if (!this.dead) {
      if (input.keys.has('KeyW')) fz += 1;
      if (input.keys.has('KeyS')) fz -= 1;
      if (input.keys.has('KeyD')) fx += 1;
      if (input.keys.has('KeyA')) fx -= 1;
    }
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fz + cy * fx;
    let wz = -cy * fz - sy * fx;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    this.ducked = !this.dead && (input.keys.has('ControlLeft') || input.keys.has('KeyC'));
    const walking = !this.dead && input.keys.has('ShiftLeft') && !this.ducked;
    let wishspeed = maxSpeed * (this.ducked ? DUCK_MOD : 1) * (walking ? WALK_MOD : 1);

    if (this.onGround) {
      // friction
      const speed = Math.hypot(v.x, v.z);
      if (speed < 0.5) { v.x = 0; v.z = 0; }
      else {
        const drop = Math.max(speed, STOPSPEED) * FRICTION * dt;
        const ns = Math.max(speed - drop, 0) / speed;
        v.x *= ns; v.z *= ns;
      }
      // accelerate
      if (wl > 0) {
        const cur = v.x * wx + v.z * wz;
        const add = wishspeed - cur;
        if (add > 0) {
          const acc = Math.min(ACCEL * wishspeed * dt, add);
          v.x += acc * wx; v.z += acc * wz;
        }
      }
      // jump
      if (this.jumpBuffer > 0 && !this.dead) {
        v.y = JUMP_VEL;
        this.onGround = false;
        this.jumpBuffer = 0;
        this.game.audio.play('step');
      }
    } else if (wl > 0) {
      // air strafe
      const ws = Math.min(wishspeed, AIR_CAP);
      const cur = v.x * wx + v.z * wz;
      const add = ws - cur;
      if (add > 0) {
        const acc = Math.min(AIR_ACCEL * wishspeed * dt, add);
        v.x += acc * wx; v.z += acc * wz;
      }
    }

    v.y -= GRAVITY * dt;
    const wasGround = this.onGround;
    const vyBefore = v.y;

    this._moveHoriz('x', v.x * dt);
    this._moveHoriz('z', v.z * dt);

    const hitY = this._moveY(v.y * dt);
    if (hitY) {
      if (v.y <= 0) {
        if (!wasGround) {
          this.game.audio.play('land');
          if (vyBefore < -560 && !this.dead) {
            this.game.damagePlayer(Math.round((-vyBefore - 560) * 0.16), this.pos, null, 'fall');
          }
        }
        this.onGround = true;
      }
      v.y = 0;
    } else if (wasGround && v.y <= 0) {
      // snap down stairs
      const y0 = this.pos.y;
      if (this._moveY(-STEP - 2)) { this.onGround = true; v.y = 0; }
      else { this.pos.y = y0; this.onGround = false; }
    } else {
      this.onGround = false;
    }

    // crouch height
    const targetH = this.ducked ? H_DUCK : H_STAND;
    if (targetH > this.height && this._overlap(this.pos.x, this.pos.y, this.pos.z, targetH)) {
      this.ducked = true; // no headroom
    } else {
      this.height = targetH;
    }
    const targetEye = this.ducked ? EYE_DUCK : EYE_STAND;
    const de = targetEye - this.eyeH;
    this.eyeH += clamp(de, -160 * dt, 160 * dt);

    // derived
    this.speedXZ = Math.hypot(v.x, v.z);
    if (this.onGround && this.speedXZ > 30) this.bobCycle += this.speedXZ * dt * 0.055;

    // footsteps
    if (this.onGround && !walking && this.speedXZ > 120) {
      this.stepDist += this.speedXZ * dt;
      if (this.stepDist > 95) {
        this.stepDist = 0;
        this.game.audio.play('step');
      }
    } else this.stepDist = 60;

    // view punch recovery
    const decay = Math.exp(-dt * 7);
    this.punchPitch *= decay;
    this.punchYaw *= decay;
  }
}
