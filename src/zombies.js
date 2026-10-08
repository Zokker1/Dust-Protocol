// Server-driven co-op zombie enemies with local interpolation and hitboxes.
import * as THREE from 'three';
import { clamp } from './utils.js';

const TYPE_STYLE = {
  shambler: { label: 'Shambler', skin: 0x7f9460, cloth: 0x4b5a34, scale: 1.0, glow: 0x294018 },
  runner: { label: 'Runner', skin: 0x9a6d54, cloth: 0x5c3131, scale: 0.86, glow: 0x5a1515 },
  brute: { label: 'Brute', skin: 0x6f7d5b, cloth: 0x3b4431, scale: 1.34, glow: 0x182a12 },
  spitter: { label: 'Spitter', skin: 0x6aa06b, cloth: 0x36553a, scale: 1.05, glow: 0x1b6b2a },
  stalker: { label: 'Stalker', skin: 0x9fb3bb, cloth: 0x55656c, scale: 0.9, glow: 0x2a6a7a },
  bomber: { label: 'Bomber', skin: 0xb56a38, cloth: 0x7a3a18, scale: 1.12, glow: 0xff5a10 },
  summoner: { label: 'Necromancer', skin: 0x7a6a8e, cloth: 0x2a1838, scale: 1.24, glow: 0x9a3aff },
};

function mat(color, emissive = 0x000000) {
  return new THREE.MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: 0.38,
    roughness: 0.92,
    metalness: 0.02,
  });
}

function buildZombieModel(type) {
  const style = TYPE_STYLE[type] || TYPE_STYLE.shambler;
  const g = new THREE.Group();
  g.scale.setScalar(style.scale);
  const parts = {};

  const legGeo = new THREE.BoxGeometry(9, 28, 9);
  legGeo.translate(0, -14, 0);
  parts.legL = new THREE.Mesh(legGeo, mat(style.cloth));
  parts.legL.position.set(-6, 28, 0);
  parts.legR = new THREE.Mesh(legGeo.clone(), mat(style.cloth));
  parts.legR.position.set(6, 28, 0);
  g.add(parts.legL, parts.legR);

  parts.torso = new THREE.Mesh(new THREE.BoxGeometry(25, 31, 15), mat(style.cloth, style.glow));
  parts.torso.position.set(0, 45, 0);
  parts.torso.rotation.x = 0.08;
  g.add(parts.torso);

  parts.head = new THREE.Mesh(new THREE.BoxGeometry(13, 13, 13), mat(style.skin, style.glow));
  parts.head.position.set(0, 66, -2);
  g.add(parts.head);

  // Self-lit glowing eyes — readable and menacing against the dark zombie lighting.
  const eyeCol = { spitter: 0x6dff3a, summoner: 0xc060ff, stalker: 0x6fe6ff, bomber: 0xff8a10 }[type] || 0xff2a10;
  const eyeMat = new THREE.MeshBasicMaterial({ color: eyeCol });
  for (const ex of [-3, 3]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 6), eyeMat);
    eye.position.set(ex, 67, -9);
    g.add(eye);
  }

  const armGeo = new THREE.BoxGeometry(6, 7, 27);
  armGeo.translate(0, 0, -11);
  parts.armL = new THREE.Mesh(armGeo, mat(style.skin));
  parts.armL.position.set(-11, 53, -2);
  parts.armL.rotation.set(-0.85, -0.18, 0.05);
  parts.armR = new THREE.Mesh(armGeo.clone(), mat(style.skin));
  parts.armR.position.set(11, 53, -2);
  parts.armR.rotation.set(-0.85, 0.18, -0.05);
  g.add(parts.armL, parts.armR);

  if (type === 'spitter') {
    const sac = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), mat(0x55cc55, 0x1aff1a));
    sac.position.set(0, 56, -9);
    g.add(sac);
  }
  if (type === 'bomber') {
    const belly = new THREE.Mesh(new THREE.SphereGeometry(12, 12, 10), mat(0xff5a1e, 0xff5a10));
    belly.material.emissiveIntensity = 1.0;
    belly.position.set(0, 44, 4);
    parts.torso.scale.set(1.25, 1.1, 1.25);
    g.add(belly);
  }

  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  if (type === 'stalker') { // barely-there cloaked flesh
    g.traverse(o => { if (o.isMesh && o.material) { o.material.transparent = true; o.material.opacity = 0.34; o.castShadow = false; } });
  }
  return { group: g, parts };
}

class Zombie {
  constructor(data, manager) {
    this.mgr = manager;
    this.id = data.id;
    this.type = data.type || 'shambler';
    this.name = data.name || TYPE_STYLE[this.type]?.label || 'Zombie';
    const { group, parts } = buildZombieModel(this.type);
    this.group = group;
    this.parts = parts;
    this.hitParts = [
      [parts.head, 1.65, 'head'],
      [parts.torso, 1, 'torso'],
      [parts.armL, 0.8, 'arm'],
      [parts.armR, 0.8, 'arm'],
      [parts.legL, 0.72, 'leg'],
      [parts.legR, 0.72, 'leg'],
    ];
    for (const [mesh, mult, part] of this.hitParts) mesh.userData = { zombie: this, mult, part };
    this.pos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.hp = 1;
    this.maxHp = 1;
    this.alive = true;
    this.hitFlash = 0;
    this.walkCycle = Math.random() * 10;
    this.applySnapshot(data, true);
  }

  applySnapshot(data, instant = false) {
    this.name = data.name || this.name;
    this.type = data.type || this.type;
    this.targetPos.set(data.x, data.y, data.z);
    this.targetYaw = data.yaw ?? this.targetYaw;
    this.hp = data.hp ?? this.hp;
    this.maxHp = data.maxHp ?? this.maxHp;
    this.alive = data.alive !== false;
    if (instant) {
      this.pos.copy(this.targetPos);
      this.yaw = this.targetYaw;
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.yaw;
    }
  }

  flashHit() {
    this.hitFlash = 0.16;
  }

  update(dt) {
    const t = clamp(dt * 10, 0, 1);
    this.pos.lerp(this.targetPos, t);
    const dy = ((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += dy * t;
    this.walkCycle += dt * (this.type === 'runner' ? 12 : 7);
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    const sway = Math.sin(this.walkCycle) * (this.type === 'brute' ? 0.22 : 0.36);
    this.parts.legL.rotation.x = sway;
    this.parts.legR.rotation.x = -sway;
    this.parts.armL.rotation.x = -0.85 - sway * 0.55;
    this.parts.armR.rotation.x = -0.85 + sway * 0.55;
    this.group.visible = this.alive;

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const e = Math.max(0, this.hitFlash) * 7;
      for (const [mesh] of this.hitParts) mesh.material.emissive?.setRGB(e, e * 0.15, e * 0.1);
    }
  }
}

export class ZombieManager {
  constructor(game) {
    this.game = game;
    this.zombies = new Map();
  }

  add(data) {
    let z = this.zombies.get(data.id);
    if (!z) {
      z = new Zombie(data, this);
      this.game.scene.add(z.group);
      this.zombies.set(z.id, z);
    } else {
      z.applySnapshot(data);
    }
    return z;
  }

  get(id) { return this.zombies.get(id); }

  remove(id) {
    const z = this.zombies.get(id);
    if (!z) return;
    this.game.scene.remove(z.group);
    this.zombies.delete(id);
  }

  syncAll(list) {
    const seen = new Set();
    for (const data of list || []) {
      seen.add(data.id);
      this.add(data);
    }
    for (const id of [...this.zombies.keys()]) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  update(dt) {
    for (const z of this.zombies.values()) z.update(dt);
  }

  alivePartMeshes() {
    const out = [];
    for (const z of this.zombies.values()) {
      if (!z.alive) continue;
      for (const [mesh] of z.hitParts) out.push(mesh);
    }
    return out;
  }

  flash(id, hp = null) {
    const z = this.zombies.get(id);
    if (!z) return;
    if (hp != null) z.hp = hp;
    z.flashHit();
  }

  clear() {
    for (const id of [...this.zombies.keys()]) this.remove(id);
  }
}
