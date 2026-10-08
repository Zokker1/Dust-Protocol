// Floor loot — server-spawned ammo crates that the player walks over to resupply.
// The server owns them (spawn/expire/grant); the client renders + auto-grabs on touch.
import * as THREE from 'three';

const PICKUP_RADIUS = 72;

export class LootManager {
  constructor(game) {
    this.game = game;
    this.items = new Map(); // id -> { mesh, x, y, z, requested }
    this.geo = new THREE.BoxGeometry(18, 13, 14);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xffd24a, emissive: 0xffae20, emissiveIntensity: 0.65, roughness: 0.5, metalness: 0.3 });
    this.t = 0;
  }

  add(d) {
    if (!d || this.items.has(d.id)) return;
    const mesh = new THREE.Mesh(this.geo, this.mat);
    mesh.position.set(d.x, d.y + 13, d.z);
    this.game.scene.add(mesh);
    this.items.set(d.id, { mesh, x: d.x, y: d.y, z: d.z, requested: false });
  }

  remove(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.game.scene.remove(it.mesh);
    this.items.delete(id);
  }

  clear() {
    for (const id of [...this.items.keys()]) this.remove(id);
  }

  syncAll(list) {
    this.clear();
    for (const d of list || []) this.add(d);
  }

  update(dt) {
    this.t += dt;
    const g = this.game;
    const p = g.player.pos;
    const canGrab = g.online && g.matchMode === 'zombies' && g.state === 'playing';
    for (const [id, it] of this.items) {
      it.mesh.rotation.y += dt * 2.2;
      it.mesh.position.y = it.y + 13 + Math.sin(this.t * 3 + id) * 2.5;
      if (canGrab && !it.requested &&
          Math.hypot(p.x - it.x, p.z - it.z) < PICKUP_RADIUS && Math.abs(p.y - it.y) < 100) {
        it.requested = true; // ask once; server removes it and broadcasts loot_taken
        g.net.send({ t: 'loot_get', id });
      }
    }
  }
}
