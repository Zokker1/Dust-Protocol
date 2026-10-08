// Remote human players: CT-colored models with hitboxes, position interpolation.
import * as THREE from 'three';
import { clamp, lerp } from './utils.js';

function buildRemoteModel() {
  const g = new THREE.Group();
  const mat = (c, r = 0.85) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 });
  const parts = {};

  const mkLeg = (x) => {
    const geo = new THREE.BoxGeometry(10, 30, 10);
    geo.translate(0, -15, 0);
    const m = new THREE.Mesh(geo, mat(0x3a4a5c));
    m.position.set(x, 30, 0);
    g.add(m);
    return m;
  };
  parts.legL = mkLeg(-6.5);
  parts.legR = mkLeg(6.5);

  parts.torso = new THREE.Mesh(new THREE.BoxGeometry(26, 28, 15), mat(0x4a6a8a));
  parts.torso.position.set(0, 44, 0);
  g.add(parts.torso);
  parts.vest = new THREE.Mesh(new THREE.BoxGeometry(27, 17, 16), mat(0x2e4a62));
  parts.vest.position.set(0, 46, 0);
  g.add(parts.vest);

  parts.head = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), mat(0xc8b090));
  parts.head.position.set(0, 64, 0);
  g.add(parts.head);
  const helmet = new THREE.Mesh(new THREE.BoxGeometry(13, 5, 13), mat(0x5a7a9a));
  helmet.position.set(0, 68.5, 0);
  g.add(helmet);

  const mkArm = (x) => {
    const geo = new THREE.BoxGeometry(6, 6, 22);
    geo.translate(0, 0, -9);
    const m = new THREE.Mesh(geo, mat(0x3d5a72));
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

class RemotePlayer {
  constructor(id, name, manager) {
    this.id = id;
    this.name = name;
    this.mgr = manager;
    const { group, parts } = buildRemoteModel();
    this.group = group;
    this.parts = parts;
    this.hitParts = [
      [parts.head, 4, 'head'],
      [parts.torso, 1, 'torso'], [parts.vest, 1, 'torso'],
      [parts.armL, 1, 'arm'], [parts.armR, 1, 'arm'],
      [parts.legL, 0.75, 'leg'], [parts.legR, 0.75, 'leg'],
    ];
    for (const [mesh, mult, part] of this.hitParts) {
      mesh.userData = { remote: this, mult, part };
    }

    this.pos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.pitch = 0;
    this.hp = 100;
    this.armor = 100;
    this.alive = true;
    this.down = false;
    this.kills = 0;
    this.deaths = 0;
    this.ping = 0;
    this.weaponId = 'ak';
    this.hitFlash = 0;
    this.deadT = 0;
    this.fallDir = 1;
    this.spottedT = -99;
    this.lastUpdate = 0;
  }

  applySnapshot(data) {
    this.targetPos.set(data.x, data.y, data.z);
    this.targetYaw = data.yaw;
    this.pitch = data.pitch;
    this.hp = data.hp;
    this.armor = data.armor;
    this.kills = data.kills;
    this.deaths = data.deaths;
    this.ping = data.ping;
    this.weaponId = data.weapon || 'ak';
    this.lastUpdate = performance.now();
    const wasDown = this.down;
    this.down = !!data.down;
    if (this.down && !wasDown) this.fallDir = Math.random() < 0.5 ? -1 : 1;

    if (data.alive && !this.alive) {
      this.alive = true;
      this.deadT = 0;
      this.group.visible = true;
      this.group.rotation.z = 0;
      this.pos.copy(this.targetPos);
    } else if (!data.alive && this.alive) {
      this.alive = false;
      this.deadT = 0;
      this.fallDir = Math.random() < 0.5 ? -1 : 1;
    }
    this.alive = data.alive;
  }

  flashHit() {
    this.hitFlash = 0.18;
  }

  update(dt) {
    if (!this.alive) {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.3);
      this.group.rotation.z = this.fallDir * k * Math.PI / 2;
      this.group.position.copy(this.pos);
      if (this.deadT > 2.2) this.group.visible = false;
      return;
    }

    const t = clamp(dt * 14, 0, 1);
    this.pos.lerp(this.targetPos, t);
    let dy = ((this.targetYaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    this.yaw += dy * t;

    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.rotation.z = this.down ? this.fallDir * 1.35 : 0; // lie flat when downed
    this.group.visible = true;

    if (this.hitFlash > 0) {
      this.hitFlash -= dt;
      const e = Math.max(0, this.hitFlash) * 6;
      for (const [mesh] of this.hitParts) mesh.material.emissive?.setRGB(e * 0.3, e * 0.5, e);
    }

    // spotted on radar when visible
    const game = this.mgr.game;
    if (game.playerAlive) {
      const eye = game.player.eyePos();
      const rEye = new THREE.Vector3(this.pos.x, this.pos.y + 64, this.pos.z);
      const toR = rEye.clone().sub(eye);
      if (game.player.lookDir().dot(toR.normalize()) > 0.4 &&
          game.world.losClear({ x: eye.x, y: eye.y, z: eye.z }, { x: rEye.x, y: rEye.y, z: rEye.z }, 0)) {
        this.spottedT = game.time;
      }
    }
  }
}

export class RemotePlayerManager {
  constructor(game) {
    this.game = game;
    this.remotes = new Map();
  }

  add(id, name, data) {
    let r = this.remotes.get(id);
    if (!r) {
      r = new RemotePlayer(id, name, this);
      this.game.scene.add(r.group);
      this.remotes.set(id, r);
    }
    r.name = name;
    if (data) r.applySnapshot(data);
    return r;
  }

  remove(id) {
    const r = this.remotes.get(id);
    if (!r) return;
    this.game.scene.remove(r.group);
    this.remotes.delete(id);
  }

  get(id) { return this.remotes.get(id); }

  syncAll(list) {
    const seen = new Set();
    for (const data of list) {
      seen.add(data.id);
      this.add(data.id, data.name, data);
    }
    for (const id of [...this.remotes.keys()]) {
      if (!seen.has(id)) this.remove(id);
    }
  }

  update(dt) {
    for (const r of this.remotes.values()) r.update(dt);
  }

  alivePartMeshes() {
    const out = [];
    for (const r of this.remotes.values()) {
      if (!r.alive) continue;
      for (const [mesh] of r.hitParts) out.push(mesh);
    }
    return out;
  }

  applyDamage(remote, dmg, part) {
    if (!remote.alive) return false;
    remote.flashHit();
    return false; // server is authoritative; local prediction only
  }

  clear() {
    for (const id of [...this.remotes.keys()]) this.remove(id);
  }

  topScore() {
    let m = 0;
    for (const r of this.remotes.values()) m = Math.max(m, r.kills);
    return m;
  }
}