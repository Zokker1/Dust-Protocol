// Enemy bots: blocky T-side models with separate head hitboxes, waypoint patrol
// (A* over the world nav graph), and combat AI with reaction time, burst fire,
// strafing, and target memory. Bots use the same AABB collide-and-slide as the player.
import * as THREE from 'three';
import { clamp, lerp, gaussian } from './utils.js';
import { WEAPONS } from './weapons.js';

const HW = 16, H = 72, STEP = 18, EPS = 0.03, GRAVITY = 800;

export const BOT_NAMES = [
  'Rush_B_Boris', 'OneTapOleg', 'DustDevil', 'FlickWizard', 'SilentEco',
  'CrouchPeek', 'SmokeMid', 'NadeLord', 'EcoFrog', 'PeekABoo',
];

const DIFFICULTY = {
  easy: { err: 2.3, reaction: 0.7, burstMax: 4 },
  normal: { err: 1.35, reaction: 0.45, burstMax: 6 },
  hard: { err: 0.8, reaction: 0.3, burstMax: 8 },
};

function buildBotModel() {
  const g = new THREE.Group();
  const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 });
  const parts = {};

  const mkLeg = (x) => {
    const geo = new THREE.BoxGeometry(10, 30, 10);
    geo.translate(0, -15, 0); // pivot at hip
    const m = new THREE.Mesh(geo, mat(0x55503f));
    m.position.set(x, 30, 0);
    g.add(m);
    return m;
  };
  parts.legL = mkLeg(-6.5);
  parts.legR = mkLeg(6.5);

  parts.torso = new THREE.Mesh(new THREE.BoxGeometry(26, 28, 15), mat(0x8a7a55));
  parts.torso.position.set(0, 44, 0);
  g.add(parts.torso);
  parts.vest = new THREE.Mesh(new THREE.BoxGeometry(27, 17, 16), mat(0x47412f));
  parts.vest.position.set(0, 46, 0);
  g.add(parts.vest);

  parts.head = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), mat(0xc09368));
  parts.head.position.set(0, 64, 0);
  g.add(parts.head);
  const wrap = new THREE.Mesh(new THREE.BoxGeometry(13, 5, 13), mat(0x3c3a35));
  wrap.position.set(0, 68.5, 0);
  g.add(wrap);

  const mkArm = (x) => {
    const geo = new THREE.BoxGeometry(6, 6, 22);
    geo.translate(0, 0, -9);
    const m = new THREE.Mesh(geo, mat(0x7c6e4c));
    m.position.set(x, 52, 0);
    m.rotation.set(-0.12, x > 0 ? 0.18 : -0.18, 0);
    g.add(m);
    return m;
  };
  parts.armL = mkArm(-9);
  parts.armR = mkArm(9);

  const gunGeo = new THREE.BoxGeometry(3, 4.5, 26);
  gunGeo.translate(0, 0, -13);
  parts.gun = new THREE.Mesh(gunGeo, mat(0x22242a, 0.4));
  parts.gun.position.set(2.5, 50, -4);
  g.add(parts.gun);
  parts.muzzleRef = new THREE.Object3D();
  parts.muzzleRef.position.set(0, 0, -26);
  parts.gun.add(parts.muzzleRef);

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return { group: g, parts };
}

class Bot {
  constructor(name, weaponId, manager) {
    this.name = name;
    this.weaponId = weaponId;
    this.mgr = manager;
    this.world = manager.game.world;
    const { group, parts } = buildBotModel();
    this.group = group;
    this.parts = parts;
    this.hitParts = [
      [parts.head, 4, 'head'],
      [parts.torso, 1, 'torso'], [parts.vest, 1, 'torso'],
      [parts.armL, 1, 'arm'], [parts.armR, 1, 'arm'],
      [parts.legL, 0.75, 'leg'], [parts.legR, 0.75, 'leg'],
    ];
    for (const [mesh, mult, part] of this.hitParts) mesh.userData = { bot: this, mult, part };

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.onGround = false;
    this.hp = 100;
    this.alive = true;
    this.kills = 0;
    this.deaths = 0;
    this.ping = 8 + Math.floor(Math.random() * 55);

    this.state = 'patrol';
    this.path = null;
    this.pathIdx = 0;
    this.repathT = 0;
    this.lastSeenPos = new THREE.Vector3();
    this.lastSeenT = -99;
    this.reactionT = 0;
    this.burstLeft = 0;
    this.burstCd = 0;
    this.shotCd = 0;
    this.strafeDir = 1;
    this.strafeT = 0;
    this.walkCycle = 0;
    this.deadT = 0;
    this.respawnT = 0;
    this.hitFlash = 0;
    this.spottedT = -99;
    this.pingT = -99;
    this.percT = Math.random() * 0.12;
    this.canSee = false;
  }

  get def() { return WEAPONS[this.weaponId]; }
  eyePos() { return new THREE.Vector3(this.pos.x, this.pos.y + 64, this.pos.z); }

  _overlap() {
    const p = this.pos;
    for (const b of this.world.colliders) {
      if (p.x - HW < b.maxX && p.x + HW > b.minX &&
          p.y < b.maxY && p.y + H > b.minY &&
          p.z - HW < b.maxZ && p.z + HW > b.minZ) return b;
    }
    return null;
  }

  _slideAxis(key, delta) {
    if (Math.abs(delta) < 1e-7) return false;
    this.pos[key] += delta;
    let hit = false;
    for (let i = 0; i < 4; i++) {
      const b = this._overlap();
      if (!b) break;
      hit = true;
      if (key === 'x') this.pos.x = delta > 0 ? b.minX - HW - EPS : b.maxX + HW + EPS;
      else this.pos.z = delta > 0 ? b.minZ - HW - EPS : b.maxZ + HW + EPS;
    }
    return hit;
  }

  _moveY(delta) {
    this.pos.y += delta;
    let hit = false;
    for (let i = 0; i < 4; i++) {
      const b = this._overlap();
      if (!b) break;
      hit = true;
      if (delta <= 0) this.pos.y = b.maxY + EPS;
      else this.pos.y = b.minY - H - EPS;
    }
    return hit;
  }

  _moveHoriz(key, delta) {
    const sx = this.pos.x, sy = this.pos.y, sz = this.pos.z;
    if (!this._slideAxis(key, delta) || !this.onGround) return;
    const slidX = this.pos.x, slidZ = this.pos.z;
    this.pos.set(sx, sy + STEP, sz);
    if (this._overlap()) { this.pos.set(slidX, sy, slidZ); return; }
    this._slideAxis(key, delta);
    if (!this._moveY(-STEP - 1)) this.pos.set(slidX, sy, slidZ);
  }

  physics(dt) {
    this.vel.y -= GRAVITY * dt;
    const wasGround = this.onGround;
    this._moveHoriz('x', this.vel.x * dt);
    this._moveHoriz('z', this.vel.z * dt);
    if (this._moveY(this.vel.y * dt)) {
      if (this.vel.y <= 0) this.onGround = true;
      this.vel.y = 0;
    } else if (wasGround && this.vel.y <= 0 && this._moveY(-STEP - 2)) {
      this.onGround = true;
      this.vel.y = 0;
    } else {
      this.onGround = false;
    }
  }

  update(dt) {
    const game = this.mgr.game;
    if (!this.alive) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.3);
      this.group.rotation.z = this.fallDir * k * Math.PI / 2;
      this.group.position.y = this.pos.y + 2 - k * 0;
      if (this.deadT > 2.2) this.group.visible = false;
      this.respawnT -= dt;
      if (this.respawnT <= 0) this.mgr.respawn(this);
      return;
    }

    const player = game.player;
    const playerAlive = game.playerAlive;
    const eye = this.eyePos();
    const pEye = player.eyePos();
    const toPlayer = pEye.clone().sub(eye);
    const dist = toPlayer.length();

    // perception (staggered ~10Hz)
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = 0.1;
      this.canSee = false;
      if (playerAlive && dist < 3200) {
        const facing = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
        const dirN = toPlayer.clone().normalize();
        const inFov = dist < 280 || facing.dot(new THREE.Vector3(dirN.x, 0, dirN.z).normalize()) > 0.25;
        if (inFov && this.world.losClear({ x: eye.x, y: eye.y, z: eye.z }, { x: pEye.x, y: pEye.y, z: pEye.z }, 0)) {
          this.canSee = true;
        }
      }
      // is the bot on the player's radar?
      if (playerAlive) {
        const lookDot = player.lookDir().dot(toPlayer.clone().normalize().negate());
        if (lookDot > 0.45 && this.world.losClear({ x: pEye.x, y: pEye.y, z: pEye.z }, { x: eye.x, y: eye.y, z: eye.z }, 0)) {
          this.spottedT = game.time;
        }
      }
    }

    if (this.canSee) {
      if (this.state !== 'combat') {
        this.state = 'combat';
        this.reactionT = this.mgr.diff.reaction * (0.8 + Math.random() * 0.6);
        this.burstLeft = 0;
        this.burstCd = 0.1;
      }
      this.lastSeenPos.copy(player.pos);
      this.lastSeenT = game.time;
    } else if (this.state === 'combat' && game.time - this.lastSeenT > 3.5) {
      this.state = 'hunt';
      this.path = null;
    }
    if (!playerAlive && this.state !== 'patrol') { this.state = 'patrol'; this.path = null; }

    const speed = this.def.speed * 0.92;

    if (this.state === 'combat' && this.canSee) {
      // face player
      this.targetYaw = Math.atan2(-toPlayer.x, -toPlayer.z);
      // strafe / spacing
      this.strafeT -= dt;
      if (this.strafeT <= 0) {
        this.strafeT = 0.45 + Math.random() * 0.8;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
      }
      const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      let mx = right.x * this.strafeDir, mz = right.z * this.strafeDir;
      if (this.weaponId === 'awp') { mx = 0; mz = 0; }
      else if (this.weaponId === 'nova') {
        if (dist > 420) { mx += fwd.x; mz += fwd.z; }
        else if (dist < 180) { mx -= fwd.x * 0.5; mz -= fwd.z * 0.5; }
      }
      else if (dist > 950) { mx += fwd.x; mz += fwd.z; }
      else if (dist < 220) { mx -= fwd.x * 0.8; mz -= fwd.z * 0.8; }
      const ml = Math.hypot(mx, mz);
      const cs = (this.weaponId === 'awp' || this.weaponId === 'nova') ? 0 : 0.55;
      this.vel.x = ml > 0 ? mx / ml * speed * cs : 0;
      this.vel.z = ml > 0 ? mz / ml * speed * cs : 0;

      // shooting
      this.reactionT -= dt;
      this.shotCd -= dt;
      this.burstCd -= dt;
      const aimErr = Math.abs(((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      if (this.reactionT <= 0 && aimErr < 0.25) {
        if (this.burstLeft <= 0 && this.burstCd <= 0) {
          const bm = this.mgr.diff.burstMax;
          this.burstLeft = this.def.id === 'awp' ? 1 : this.def.id === 'deagle' ? 2 : this.def.id === 'nova' ? 1 : 3 + Math.floor(Math.random() * (bm - 2));
          this.burstCd = this.def.id === 'awp' ? 1.6 : this.def.id === 'nova' ? 0.85 + Math.random() * 0.35 : 0.4 + Math.random() * 0.5;
        }
        if (this.burstLeft > 0 && this.shotCd <= 0) {
          this.shoot(pEye, dist);
          this.burstLeft--;
          this.shotCd = this.def.id === 'nova' ? 0.95 : (60 / this.def.rpm) * 1.12;
          if (this.burstLeft === 0) this.burstCd = 0.45 + Math.random() * 0.55;
        }
      }
    } else if (this.state === 'combat' || this.state === 'hunt') {
      // move to last known position
      this.followPath(this.lastSeenPos, speed, dt);
      if (this.pos.distanceTo(this.lastSeenPos) < 90 || (this.state === 'hunt' && game.time - this.lastSeenT > 8)) {
        this.state = 'patrol';
        this.path = null;
      }
    } else {
      // patrol to random waypoints
      if (!this.path || this.pathIdx >= this.path.length) {
        const wps = this.world.waypoints;
        const target = wps[Math.floor(Math.random() * wps.length)].pos;
        this.path = this.world.navPath(this.pos, target);
        this.pathIdx = 0;
      }
      this.followPath(null, speed, dt);
    }

    // separation from other bots
    for (const o of this.mgr.bots) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 38 && d > 0.01) {
        this.vel.x += dx / d * 90;
        this.vel.z += dz / d * 90;
      }
    }

    // turn toward target yaw
    let dy = ((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += clamp(dy, -7 * dt, 7 * dt);

    this.physics(dt);

    // animate
    const spd = Math.hypot(this.vel.x, this.vel.z);
    if (this.onGround && spd > 20) {
      this.walkCycle += spd * dt * 0.05;
      // footsteps audible to player
      this.stepAcc = (this.stepAcc || 0) + spd * dt;
      if (this.stepAcc > 100 && dist < 950) {
        this.stepAcc = 0;
        game.audio.play('step', this.pos);
      }
    }
    const sw = Math.min(1, spd / 200) * Math.sin(this.walkCycle);
    this.parts.legL.rotation.x = sw * 0.75;
    this.parts.legR.rotation.x = -sw * 0.75;
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.rotation.z = 0;

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const e = Math.max(0, this.hitFlash) * 6;
      for (const [mesh] of this.hitParts) mesh.material.emissive?.setRGB(e, 0, 0);
    }
  }

  followPath(target, speed, dt) {
    if (target && (!this.path || this.repathT <= 0)) {
      this.path = this.world.navPath(this.pos, target);
      this.pathIdx = 0;
      this.repathT = 1.5;
    }
    this.repathT -= dt;
    if (!this.path || this.pathIdx >= this.path.length) { this.vel.x = this.vel.z = 0; return; }
    const node = this.path[this.pathIdx];
    const dx = node.x - this.pos.x, dz = node.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 45) { this.pathIdx++; return; }
    this.vel.x = dx / d * speed;
    this.vel.z = dz / d * speed;
    this.targetYaw = Math.atan2(-dx, -dz);
  }

  shoot(pEye, dist) {
    const game = this.mgr.game;
    const muzzle = new THREE.Vector3();
    this.parts.muzzleRef.getWorldPosition(muzzle);
    // aim at player eye-ish with gaussian error
    const target = pEye.clone();
    target.y -= 6 + Math.random() * 18; // aim center mass
    const dir = target.sub(muzzle);
    const d = dir.length();
    dir.normalize();
    const err = 0.012 * this.mgr.diff.err * (1 + d / 1500) *
      (game.player.speedXZ > 140 ? 1.35 : 1) *
      (Math.hypot(this.vel.x, this.vel.z) > 50 ? 1.3 : 1);
    dir.x += gaussian() * err;
    dir.y += gaussian() * err * 0.7;
    dir.z += gaussian() * err;
    dir.normalize();
    game.botShoot(this, muzzle, dir);
    this.pingT = game.time;
  }
}

export class BotManager {
  constructor(game) {
    this.game = game;
    this.bots = [];
    this.diff = DIFFICULTY.normal;
  }

  spawnAll(count, difficulty) {
    this.diff = DIFFICULTY[difficulty] || DIFFICULTY.normal;
    for (const b of this.bots) this.game.scene.remove(b.group);
    this.bots = [];
    const loadouts = ['ak', 'm4', 'ak', 'awp', 'deagle', 'nova', 'ak', 'm4', 'nova', 'ak'];
    const names = [...BOT_NAMES].sort(() => Math.random() - 0.5);
    for (let i = 0; i < count; i++) {
      const bot = new Bot(names[i % names.length], loadouts[i % loadouts.length], this);
      this.game.scene.add(bot.group);
      this.respawn(bot, true);
      this.bots.push(bot);
    }
  }

  respawn(bot, initial = false) {
    const game = this.game;
    // farthest spawn from player without LOS
    const spawns = [...game.world.spawns].sort((a, b) =>
      b.distanceTo(game.player.pos) - a.distanceTo(game.player.pos));
    let pick = spawns[0];
    for (const s of spawns.slice(0, 8)) {
      const taken = this.bots.some(o => o !== bot && o.alive && o.pos.distanceTo(s) < 80);
      if (!taken && !game.world.losClear(
        { x: s.x, y: s.y, z: s.z },
        { x: game.player.pos.x, y: game.player.pos.y, z: game.player.pos.z }, 60)) { pick = s; break; }
    }
    bot.pos.copy(pick);
    bot.vel.set(0, 0, 0);
    bot.hp = 100;
    bot.alive = true;
    bot.state = 'patrol';
    bot.path = null;
    bot.deadT = 0;
    bot.yaw = bot.targetYaw = Math.random() * Math.PI * 2;
    bot.group.visible = true;
    bot.group.rotation.set(0, bot.yaw, 0);
    bot.group.position.copy(bot.pos);
    if (!initial) bot.hitFlash = 0;
    for (const [mesh] of bot.hitParts) mesh.material.emissive?.setRGB(0, 0, 0);
  }

  update(dt) {
    for (const b of this.bots) b.update(dt);
  }

  alivePartMeshes() {
    const out = [];
    for (const b of this.bots) {
      if (!b.alive) continue;
      for (const [mesh] of b.hitParts) out.push(mesh);
    }
    return out;
  }

  applyDamage(bot, dmg, part, weaponId) {
    if (!bot.alive) return false;
    bot.hp -= dmg;
    bot.hitFlash = 0.18;
    // getting shot reveals the player
    bot.lastSeenPos.copy(this.game.player.pos);
    bot.lastSeenT = this.game.time;
    if (bot.state === 'patrol') { bot.state = 'hunt'; bot.path = null; }
    if (bot.hp <= 0) {
      bot.alive = false;
      bot.deaths++;
      bot.deadT = 0;
      bot.respawnT = 3.5;
      bot.fallDir = Math.random() < 0.5 ? -1 : 1;
      this.game.audio.play('death', bot.pos);
      return true;
    }
    return false;
  }
}
