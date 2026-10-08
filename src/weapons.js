// Weapon definitions (CS-flavored numbers: damage, RPM, move speed, range falloff,
// deterministic spray patterns) + first-person viewmodels built from primitives,
// and the Arsenal state machine (draw / fire / reload / zoom / inspect).
import * as THREE from 'three';
import { clamp, lerp, mulberry32 } from './utils.js';

// Deterministic spray pattern: climbs vertically for `climbShots`, then snakes
// left/right — same shape every spray, like CS. Values are radians (cumulative).
function genPattern(seed, shots, climb, sway, climbShots) {
  const rng = mulberry32(seed);
  const pts = [];
  let x = 0, y = 0, dir = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < shots; i++) {
    if (i < climbShots) {
      const ramp = i < 2 ? 0.35 : Math.min(1, (i - 1) / 4);
      y += (climb / climbShots) * (0.55 + ramp);
      x += (rng() - 0.5) * sway * 0.2;
    } else {
      y += (rng() - 0.45) * climb * 0.02;
      if ((i - climbShots) % 7 === 0) dir *= -1;
      x += dir * (sway / 6) + (rng() - 0.5) * sway * 0.12;
      x = clamp(x, -sway, sway);
    }
    pts.push([x, y]);
  }
  return pts;
}

const GUNMETAL = 0x2e3136, DARK = 0x202327, WOOD = 0x7a4f28, GLOVE = 0x8a6f4d;

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Knife', slot: 3, melee: true, dmg: 40, heavyDmg: 65, rpm: 150,
    speed: 250, drawT: 0.3, price: 0,
    vm: {
      pos: [7.6, -6.8, -13], rot: [0, -0.45, 0.12],
      parts: [
        { s: [0.5, 2.4, 9.5], p: [0, 0.7, -6.5], c: 0xb9c2c9, metal: 0.9, rough: 0.25 },
        { s: [1.5, 0.6, 0.9], p: [0, 0.2, -1.7], c: DARK },
        { s: [1.3, 2.7, 5], p: [0, -0.2, 1.4], c: 0x2e2a26, rough: 0.8 },
      ],
      muzzle: [0, 0.7, -11],
    },
  },
  usp: {
    id: 'usp', name: 'USP-S', slot: 2, dmg: 35, rpm: 352, mag: 12, reserve: 24,
    reloadT: 2.2, speed: 240, rangeMod: 0.82, drawT: 0.4, price: 200, kick: 0.013,
    inacc: 0.0026, moveInaccMul: 6, sprayInacc: 0.006, armorPen: 0.5, suppressed: true,
    pattern: genPattern(11, 12, 0.05, 0.02, 6),
    vm: {
      pos: [6.6, -6.2, -12], rot: [0, 0, 0],
      parts: [
        { s: [1.8, 2.2, 9], p: [0, 1, -0.5], c: GUNMETAL, metal: 0.7, rough: 0.4 },
        { s: [1.5, 1.5, 6.5], p: [0, 1, -8.2], c: DARK, metal: 0.6, rough: 0.5 },
        { s: [1.7, 1.5, 7], p: [0, -0.5, 0.6], c: 0x35393f },
        { s: [1.7, 3.9, 2.4], p: [0, -2.6, 2.9], r: [0.28, 0, 0], c: 0x2b2e33, rough: 0.75 },
      ],
      muzzle: [0, 1, -11.8], magPart: 3,
    },
  },
  deagle: {
    id: 'deagle', name: 'Desert Eagle', slot: 2, dmg: 53, rpm: 267, mag: 7, reserve: 35,
    reloadT: 2.2, speed: 230, rangeMod: 0.86, drawT: 0.4, price: 700, kick: 0.03,
    inacc: 0.004, moveInaccMul: 9, sprayInacc: 0.022, armorPen: 0.93,
    pattern: genPattern(21, 7, 0.07, 0.025, 5),
    vm: {
      pos: [6.6, -6.2, -12], rot: [0, 0, 0],
      parts: [
        { s: [2.1, 2.7, 10.5], p: [0, 1, -1], c: 0x53585f, metal: 0.85, rough: 0.3 },
        { s: [1.8, 1.7, 8.5], p: [0, -0.6, 0], c: 0x42464c, metal: 0.7, rough: 0.4 },
        { s: [1.8, 4, 2.6], p: [0, -2.9, 3.1], r: [0.25, 0, 0], c: 0x2b2723, rough: 0.8 },
      ],
      muzzle: [0, 1.2, -6.5], magPart: 2,
    },
  },
  ak: {
    id: 'ak', name: 'AK-47', slot: 1, dmg: 36, rpm: 600, mag: 30, reserve: 90, auto: true,
    reloadT: 2.43, speed: 215, rangeMod: 0.98, drawT: 0.45, price: 2700, kick: 0.009,
    inacc: 0.0019, moveInaccMul: 7, sprayInacc: 0.0035, armorPen: 0.775,
    pattern: genPattern(47, 30, 0.115, 0.042, 9),
    vm: {
      pos: [7.2, -6.7, -14], rot: [0, 0, 0],
      parts: [
        { s: [2.6, 3.5, 14.5], p: [0, 0, 0], c: GUNMETAL, metal: 0.7, rough: 0.4 },
        { s: [2.4, 2.7, 8], p: [0, -0.1, -10.5], c: WOOD, rough: 0.85 },
        { s: [1.1, 1.1, 8], p: [0, 0.5, -17.5], c: DARK, metal: 0.8, rough: 0.35 },
        { s: [2, 6.5, 3.2], p: [0, -4.1, -2.6], r: [0.45, 0, 0], c: 0x2c2f33, metal: 0.5, rough: 0.5 },
        { s: [2.2, 3.3, 6.5], p: [0, -0.5, 8.6], c: WOOD, rough: 0.85 },
        { s: [1.8, 3.2, 2], p: [0, -3, 2.9], c: 0x26282c, rough: 0.8 },
        { s: [0.6, 1, 1.6], p: [0, 2.2, 1.5], c: DARK },
        { s: [0.5, 1.6, 0.5], p: [0, 1.7, -20.5], c: DARK },
      ],
      muzzle: [0, 0.5, -22], magPart: 3,
    },
  },
  m4: {
    id: 'm4', name: 'M4A4', slot: 1, dmg: 33, rpm: 666, mag: 30, reserve: 90, auto: true,
    reloadT: 3.1, speed: 225, rangeMod: 0.97, drawT: 0.45, price: 3100, kick: 0.0075,
    inacc: 0.0016, moveInaccMul: 6.5, sprayInacc: 0.003, armorPen: 0.7,
    pattern: genPattern(83, 30, 0.095, 0.034, 9),
    vm: {
      pos: [7.2, -6.7, -14], rot: [0, 0, 0],
      parts: [
        { s: [2.6, 3.3, 13], p: [0, 0, 0.5], c: 0x2a2d31, metal: 0.7, rough: 0.4 },
        { s: [2.3, 2.5, 9.5], p: [0, 0, -10.5], c: 0x35393e, rough: 0.6 },
        { s: [1, 1, 6.5], p: [0, 0.4, -18.5], c: DARK, metal: 0.8 },
        { s: [1.9, 5.5, 2.6], p: [0, -3.7, -1.6], r: [0.18, 0, 0], c: 0x303338, metal: 0.5 },
        { s: [2.2, 3, 6], p: [0, -0.2, 8.5], c: 0x26282c, rough: 0.8 },
        { s: [1.8, 3.2, 2], p: [0, -3, 3], c: 0x26282c, rough: 0.8 },
        { s: [1, 0.9, 11], p: [0, 2.1, -3], c: DARK },
        { s: [0.5, 1.5, 0.5], p: [0, 1.8, -21], c: DARK },
      ],
      muzzle: [0, 0.4, -21.8], magPart: 3,
    },
  },
  nova: {
    id: 'nova', name: 'Nova', slot: 1, dmg: 22, pellets: 9, pelletSpread: 0.038, rpm: 68,
    mag: 8, reserve: 32, reloadT: 3.4, speed: 220, rangeMod: 0.52, drawT: 0.5, price: 1200,
    kick: 0.048, inacc: 0.009, moveInaccMul: 8, sprayInacc: 0, armorPen: 0.5, pumpT: 0.38,
    pattern: genPattern(31, 1, 0, 0, 1),
    vm: {
      pos: [7.4, -6.8, -13], rot: [0, 0, 0],
      parts: [
        { s: [2.4, 3.2, 18], p: [0, 0.2, -2], c: 0x3a3f44, metal: 0.65, rough: 0.45 },
        { s: [2.2, 2.8, 10], p: [0, 0, -14], c: GUNMETAL, metal: 0.75, rough: 0.35 },
        { s: [2.5, 3.8, 7.5], p: [0, -0.5, 9], c: WOOD, rough: 0.88 },
        { s: [1.6, 2.2, 3.5], p: [0, -2.8, 3.2], r: [0.35, 0, 0], c: 0x2a2520, rough: 0.85 },
        { s: [1.4, 1.4, 5], p: [0, 0.5, -20], c: DARK, metal: 0.8, rough: 0.3 },
        { s: [0.9, 1.8, 4], p: [0, -1.2, -6], c: 0x26282c, rough: 0.7 },
        { s: [0.7, 0.7, 2.2], p: [1.8, 0.4, 1.8], r: [0, 0, -0.4], c: DARK, name: 'pump' },
      ],
      muzzle: [0, 0.5, -22.5], magPart: 5,
    },
  },
  awp: {
    id: 'awp', name: 'AWP', slot: 1, dmg: 115, rpm: 41, mag: 10, reserve: 30,
    reloadT: 3.7, speed: 200, scopedSpeed: 100, rangeMod: 0.99, drawT: 1.0, price: 4750,
    kick: 0.07, inacc: 0.0006, noscopeInacc: 0.09, moveInaccMul: 30, sprayInacc: 0,
    armorPen: 0.975, zoom: true, boltT: 1.2,
    pattern: genPattern(5, 10, 0, 0, 1),
    vm: {
      pos: [7.4, -6.9, -15], rot: [0, 0, 0],
      parts: [
        { s: [2.8, 3.5, 17], p: [0, 0, 0], c: 0x4a5440, rough: 0.7 },
        { s: [1.2, 1.2, 13], p: [0, 0.7, -21], c: DARK, metal: 0.8, rough: 0.35 },
        { s: [2.6, 4.2, 7], p: [0, -0.7, 10], c: 0x44503c, rough: 0.75 },
        { s: [1.7, 1.7, 9.5], p: [0, 3.2, -2], c: 0x1c1e20, metal: 0.6, rough: 0.4 },
        { s: [2.1, 2.1, 1.2], p: [0, 3.2, -6.2], c: DARK },
        { s: [2.1, 2.1, 1.2], p: [0, 3.2, 2.2], c: DARK },
        { s: [2, 3.2, 3.4], p: [0, -3.1, -0.5], c: 0x3a4434 },
        { s: [0.7, 0.7, 2.8], p: [1.9, 0.9, 2.5], r: [0, 0, -0.5], c: DARK, name: 'bolt' },
      ],
      muzzle: [0, 0.7, -27.8], magPart: 6,
    },
  },
  mp9: {
    id: 'mp9', name: 'MP9', slot: 1, dmg: 26, rpm: 857, mag: 30, reserve: 120, auto: true,
    reloadT: 2.1, speed: 245, rangeMod: 0.74, drawT: 0.4, price: 1250, kick: 0.006,
    inacc: 0.0024, moveInaccMul: 4.5, sprayInacc: 0.004, armorPen: 0.6,
    pattern: genPattern(61, 30, 0.07, 0.05, 7),
    vm: {
      pos: [6.8, -6.4, -12.5], rot: [0, 0, 0],
      parts: [
        { s: [2.2, 2.8, 11], p: [0, 0.4, -0.5], c: 0x2c2f33, metal: 0.6, rough: 0.4 },
        { s: [1.1, 1.1, 5], p: [0, 0.6, -8], c: DARK, metal: 0.7 },
        { s: [1.9, 4.6, 2.2], p: [0, -3, -1.2], r: [0.1, 0, 0], c: 0x26282c, metal: 0.4 },
        { s: [1.8, 3, 2], p: [0, -2.6, 3], c: 0x222428, rough: 0.8 },
        { s: [0.7, 2.4, 5], p: [0, 2.2, -1], c: DARK },
      ],
      muzzle: [0, 0.6, -7], magPart: 2,
    },
  },
  m249: {
    id: 'm249', name: 'M249', slot: 1, dmg: 32, rpm: 750, mag: 100, reserve: 200, auto: true,
    reloadT: 5.0, speed: 195, rangeMod: 0.97, drawT: 0.65, price: 5200, kick: 0.0085,
    inacc: 0.0022, moveInaccMul: 9, sprayInacc: 0.0035, armorPen: 0.8,
    pattern: genPattern(97, 45, 0.12, 0.045, 10),
    vm: {
      pos: [7.4, -6.9, -15], rot: [0, 0, 0],
      parts: [
        { s: [3, 3.6, 17], p: [0, 0, 0], c: 0x2a2d31, metal: 0.7, rough: 0.4 },
        { s: [1.3, 1.3, 11], p: [0, 0.6, -20], c: DARK, metal: 0.8, rough: 0.3 },
        { s: [4.4, 4.8, 5.5], p: [0, -2.4, 2], c: 0x222428, rough: 0.85 },
        { s: [2, 6, 2.6], p: [0, -4, -1.6], r: [0.2, 0, 0], c: 0x303338, metal: 0.5 },
        { s: [2.2, 3, 6], p: [0, -0.3, 9], c: 0x26282c, rough: 0.8 },
        { s: [1, 1.4, 9], p: [0, 2.4, -3], c: DARK },
        { s: [3, 0.8, 7], p: [0, -2, -6], c: 0x1c1e22 },
      ],
      muzzle: [0, 0.5, -25], magPart: 2,
    },
  },
};

export const BUY_ITEMS = [
  { cat: 'PISTOLS', items: ['usp', 'deagle'] },
  { cat: 'RIFLES', items: ['ak', 'm4'] },
  { cat: 'SHOTGUNS', items: ['nova'] },
  { cat: 'SNIPER', items: ['awp'] },
  { cat: 'GEAR', items: ['armor'] },
];

function buildViewmodel(def) {
  const g = new THREE.Group();
  const vm = def.vm;
  g.position.fromArray(vm.pos);
  if (vm.rot) g.rotation.fromArray(vm.rot);
  const parts = [];
  for (const p of vm.parts) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(...p.s),
      new THREE.MeshStandardMaterial({ color: p.c, roughness: p.rough ?? 0.5, metalness: p.metal ?? 0.1 })
    );
    mesh.position.fromArray(p.p);
    if (p.r) mesh.rotation.fromArray(p.r);
    g.add(mesh);
    parts.push(mesh);
  }
  // gloved forearm
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(2.6, 2.6, 13),
    new THREE.MeshStandardMaterial({ color: GLOVE, roughness: 0.9 })
  );
  arm.position.set(1.4, -5, 4.5);
  arm.rotation.set(0.5, -0.12, 0.1);
  g.add(arm);

  const muzzle = new THREE.Object3D();
  muzzle.position.fromArray(vm.muzzle);
  g.add(muzzle);
  const shellPort = new THREE.Object3D();
  shellPort.position.set(1.4, 0.6, -1);
  g.add(shellPort);

  return { group: g, parts, muzzle, shellPort, mag: vm.magPart != null ? parts[vm.magPart] : null, basePos: vm.pos.slice(), baseRot: vm.rot ? vm.rot.slice() : [0, 0, 0] };
}

export class Arsenal {
  constructor(game) {
    this.game = game;
    this.root = new THREE.Group(); // attached to camera
    game.camera.add(this.root);
    this.models = {};
    for (const id in WEAPONS) {
      const m = buildViewmodel(WEAPONS[id]);
      m.group.visible = false;
      m.group.traverse(o => { o.frustumCulled = false; });
      this.root.add(m.group);
      this.models[id] = m;
    }
    this.owned = {};
    this.currentId = null;
    this.lastId = null;
    this.state = 'idle'; // idle | draw | reload | bolt
    this.stateT = 0;
    this.cooldown = 0;
    this.recoilIndex = 0;
    this.sinceShot = 99;
    this.zoom = 0;
    this.kickZ = 0; this.kickV = 0; this.kickRot = 0; this.kickRotV = 0;
    this.swayX = 0; this.swayY = 0;
    this.inspectT = -1;
    this.reloadSounds = [];
    this.giveDefaultLoadout();
  }

  giveDefaultLoadout() {
    this.owned = {};
    this.give('knife', true);
    this.give('usp', true);
    this.equip('usp', true);
  }

  give(id, silent = false) {
    const def = WEAPONS[id];
    this.owned[id] = def.melee ? {} : { mag: def.mag, reserve: def.reserve };
    // bought weapon replaces same-slot weapon
    for (const oid in this.owned) {
      if (oid !== id && WEAPONS[oid].slot === def.slot) delete this.owned[oid];
    }
    if (!silent) this.equip(id);
  }

  refillAll() {
    for (const id in this.owned) {
      const def = WEAPONS[id];
      if (!def.melee) { this.owned[id].mag = def.mag; this.owned[id].reserve = def.reserve; }
    }
  }

  refillWeapon(id) {
    const def = WEAPONS[id], a = this.owned[id];
    if (!def || def.melee || !a) return false;
    a.reserve = def.reserve;
    if (id === this.currentId) a.mag = def.mag;
    return true;
  }

  get def() { return WEAPONS[this.currentId]; }
  get ammo() { return this.owned[this.currentId]; }
  get model() { return this.models[this.currentId]; }

  slotWeapon(slot) {
    for (const id in this.owned) if (WEAPONS[id].slot === slot) return id;
    return null;
  }

  equip(id, instant = false) {
    if (!this.owned[id] || id === this.currentId) return;
    if (this.currentId) {
      this.lastId = this.currentId;
      this.models[this.currentId].group.visible = false;
    }
    this.currentId = id;
    this.setZoom(0);
    this.model.group.visible = true;
    this.state = instant ? 'idle' : 'draw';
    this.stateT = 0;
    this.cooldown = 0;
    this.recoilIndex = 0;
    this.inspectT = -1;
    if (!instant) this.game.audio.play('draw');
    this.game.hud.refreshAmmo();
  }

  switchSlot(slot) {
    const id = this.slotWeapon(slot);
    if (id) this.equip(id);
  }

  quickSwitch() {
    if (this.lastId && this.owned[this.lastId]) this.equip(this.lastId);
  }

  cycle(dir) {
    const order = [1, 2, 3];
    const cur = this.def.slot;
    for (let i = 1; i <= 3; i++) {
      const slot = order[(order.indexOf(cur) + dir * i + 9) % 3];
      const id = this.slotWeapon(slot);
      if (id) { this.equip(id); return; }
    }
  }

  setZoom(z) {
    this.zoom = z;
    const def = this.def;
    const scale = z === 1 ? 0.45 : z === 2 ? 0.14 : 1;
    this.game.setZoom(scale, z > 0 && def?.zoom);
    if (this.model) this.model.group.visible = !(z > 0 && def?.zoom);
  }

  altFire() {
    const def = this.def;
    if (def.zoom) {
      if (this.state === 'reload' || this.state === 'draw') return;
      this.setZoom((this.zoom + 1) % 3);
      this.game.audio.play('click');
    } else if (def.melee) {
      this.tryMelee(true);
    }
  }

  reload() {
    const def = this.def, ammo = this.ammo;
    if (def.melee || this.state !== 'idle' && this.state !== 'bolt') return;
    if (ammo.mag >= def.mag || ammo.reserve <= 0) return;
    this.setZoom(0);
    this.state = 'reload';
    this.stateT = 0;
    this.game.audio.play('magout');
    this.reloadSounds = [[def.reloadT * 0.45, 'magin'], [def.reloadT * 0.78, 'bolt']];
  }

  inaccuracy(player) {
    const def = this.def;
    if (def.melee) return 0;
    let ina = def.inacc;
    if (def.zoom && this.zoom === 0) ina = def.noscopeInacc;
    if (!player.onGround) ina = ina * 5 + 0.02;
    else {
      const sr = player.speedXZ / def.speed;
      if (sr > 0.34) ina *= 1 + (sr - 0.34) * def.moveInaccMul;
      if (player.ducked) ina *= 0.8;
    }
    ina += Math.floor(this.recoilIndex) * (def.sprayInacc ?? 0) * 0.12;
    return ina;
  }

  tryMelee(heavy) {
    if (this.cooldown > 0 || this.state !== 'idle') return;
    const def = this.def;
    this.cooldown = heavy ? 1.0 : 60 / def.rpm * 1.6;
    this.game.audio.play('knife_swing');
    this.kickV -= 26; this.kickRotV += heavy ? 9 : 5;
    this.game.meleeAttack(heavy ? def.heavyDmg : def.dmg);
  }

  tryFire() {
    const def = this.def, player = this.game.player;
    if (this.state === 'draw' && this.stateT > def.drawT * 0.7) this.state = 'idle';
    if (def.melee) { this.tryMelee(false); return; }
    if (this.cooldown > 0 || this.state === 'reload' || this.state === 'draw' || this.state === 'bolt') return;
    const ammo = this.ammo;
    if (ammo.mag <= 0) {
      if (ammo.reserve > 0) this.reload();
      else if (this.sinceShot > 0.3) { this.game.audio.play('click'); this.sinceShot = 0; }
      return;
    }

    ammo.mag--;
    this.cooldown = 60 / def.rpm;
    this.sinceShot = 0;
    this.inspectT = -1;

    // bullet direction: camera aim (without punch) + spray pattern + random spread
    const idx = Math.min(Math.floor(this.recoilIndex), def.pattern.length - 1);
    const [px, py] = def.pattern[idx];
    const prev = idx > 0 ? def.pattern[idx - 1] : [0, 0];
    const ina = this.inaccuracy(player);
    const yaw = player.yaw - px + (Math.random() * 2 - 1) * ina;
    const pitch = clamp(player.pitch + py + (Math.random() * 2 - 1) * ina, -1.55, 1.55);
    const cp = Math.cos(pitch);
    const dir = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);

    const muzzlePos = new THREE.Vector3();
    this.model.muzzle.getWorldPosition(muzzlePos);
    const origin = player.eyePos();
    if (this.game.online) this.game.net.sendFire(def, origin, dir, muzzlePos);

    const pellets = def.pellets || 1;
    const spread = def.pelletSpread ?? 0;
    for (let i = 0; i < pellets; i++) {
      const pelletDir = dir.clone();
      if (spread > 0) {
        pelletDir.x += (Math.random() * 2 - 1) * spread;
        pelletDir.y += (Math.random() * 2 - 1) * spread;
        pelletDir.z += (Math.random() * 2 - 1) * spread;
        pelletDir.normalize();
      }
      this.game.fireBullet(def, origin, pelletDir, muzzlePos, i === 0);
    }

    // recoil
    this.recoilIndex = Math.min(this.recoilIndex + 1, def.pattern.length - 1);
    player.addPunch(def.kick + (py - prev[1]) * 0.45, -(px - prev[0]) * 0.45);
    this.kickV -= def.zoom ? 60 : 34;
    this.kickRotV += def.zoom ? 14 : 7;
    if (!def.suppressed) this.game.effects.muzzleFlash(muzzlePos, def.zoom ? 1.5 : def.pellets ? 1.35 : 1);
    const sp = new THREE.Vector3();
    this.model.shellPort.getWorldPosition(sp);
    this.game.effects.shell(sp, player.rightDir());
    this.game.audio.play('shot_' + def.id);
    this.game.hud.refreshAmmo();

    if (def.zoom) { // bolt cycle, drop scope
      const wasZoom = this.zoom;
      this.setZoom(0);
      this.state = 'bolt';
      this.stateT = 0;
      this.rezoom = wasZoom > 0 ? 1 : 0;
      this.game.audio.play('bolt');
    } else if (def.pumpT) {
      this.state = 'bolt';
      this.stateT = 0;
      this.rezoom = 0;
      this.game.audio.play('pump');
    }
    if (ammo.mag === 0 && ammo.reserve > 0 && !def.zoom) {
      setTimeout(() => { if (this.ammo === ammo && ammo.mag === 0) this.reload(); }, 250);
    }
  }

  update(dt, input) {
    const def = this.def;
    if (!def) return;
    this.cooldown -= dt;
    this.sinceShot += dt;
    this.stateT += dt;

    // recoil index recovery
    if (this.sinceShot > (def.auto ? 0.13 : 0.2)) {
      this.recoilIndex = Math.max(0, this.recoilIndex - dt * 16);
    }

    if (this.state === 'draw' && this.stateT >= def.drawT) this.state = 'idle';
    if (this.state === 'bolt') {
      const boltDur = def.boltT ?? def.pumpT ?? 0.5;
      if (this.stateT >= boltDur) {
        this.state = 'idle';
        if (this.rezoom) this.setZoom(1);
      }
    }
    if (this.state === 'reload') {
      while (this.reloadSounds.length && this.stateT >= this.reloadSounds[0][0]) {
        this.game.audio.play(this.reloadSounds.shift()[1]);
      }
      if (this.stateT >= def.reloadT) {
        const a = this.ammo;
        const need = def.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take; a.reserve -= take;
        this.state = 'idle';
        this.game.hud.refreshAmmo();
      }
    }

    // firing input
    if (input.fireHeld && (def.auto || input.fireClicked) || (!def.auto && input.fireClicked)) {
      this.tryFire();
      input.fireClicked = false;
    }
    if (input.altClicked) { this.altFire(); input.altClicked = false; }

    this.animate(dt, input);
  }

  animate(dt, input) {
    const player = this.game.player;
    const m = this.model;
    if (!m) return;

    // kick springs
    this.kickV += (-this.kickZ * 320 - this.kickV * 16) * dt;
    this.kickZ = Math.max(-4, this.kickZ + this.kickV * dt);
    this.kickRotV += (-this.kickRot * 320 - this.kickRotV * 16) * dt;
    this.kickRot += this.kickRotV * dt;

    // mouse sway (lag)
    this.swayX = lerp(this.swayX, clamp(-input.lookDX * 0.012, -1, 1), Math.min(1, dt * 12));
    this.swayY = lerp(this.swayY, clamp(input.lookDY * 0.012, -1, 1), Math.min(1, dt * 12));

    // movement bob
    const bobAmp = Math.min(1, player.speedXZ / 220) * (player.onGround ? 1 : 0.15);
    const c = player.bobCycle;
    const bobX = Math.sin(c) * 0.5 * bobAmp;
    const bobY = -Math.abs(Math.cos(c)) * 0.55 * bobAmp;

    const g = m.group;
    g.position.set(
      m.basePos[0] + bobX + this.swayX,
      m.basePos[1] + bobY + this.swayY - (player.ducked ? 0.4 : 0),
      m.basePos[2] - this.kickZ
    );
    g.rotation.set(m.baseRot[0] - this.kickRot * 0.012, m.baseRot[1], m.baseRot[2]);

    const def = this.def;
    if (this.state === 'draw') {
      const k = 1 - Math.min(1, this.stateT / def.drawT);
      g.position.y -= k * 7;
      g.rotation.x -= k * 1.1;
    } else if (this.state === 'reload') {
      const k = Math.sin(Math.PI * Math.min(1, this.stateT / def.reloadT));
      g.rotation.x -= k * 0.55;
      g.rotation.z += k * 0.35;
      if (m.mag) {
        const ph = this.stateT / def.reloadT;
        const drop = ph < 0.45 ? Math.min(1, ph / 0.18) : Math.max(0, 1 - (ph - 0.45) / 0.18);
        m.mag.position.y = m.mag.userData.baseY ?? (m.mag.userData.baseY = m.mag.position.y);
        m.mag.position.y = m.mag.userData.baseY - drop * 5;
      }
    } else if (this.state === 'bolt') {
      const boltDur = def.boltT ?? def.pumpT ?? 0.5;
      const k = Math.sin(Math.PI * Math.min(1, this.stateT / boltDur));
      g.rotation.x -= k * 0.25;
      g.position.y -= k * 1.5;
    } else if (this.inspectT >= 0) {
      this.inspectT += dt;
      const k = Math.min(1, this.inspectT / 1.4);
      g.rotation.y += Math.sin(k * Math.PI) * 1.4;
      g.rotation.z += Math.sin(k * Math.PI * 2) * 0.18;
      if (k >= 1) this.inspectT = -1;
    }
  }

  inspect() {
    if (this.state === 'idle' && this.inspectT < 0) this.inspectT = 0;
  }

  moveSpeed() {
    const def = this.def;
    if (!def) return 250;
    if (def.zoom && this.zoom > 0) return def.scopedSpeed;
    return def.speed;
  }
}
