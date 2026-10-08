// Throwable grenades: frag (timed AoE burst) and molotov (impact → lingering fire zone).
// The client simulates the projectile arc/bounce against world geometry and renders it;
// damage is server-authoritative online (sent on detonation) and client-side offline.
import * as THREE from 'three';

export const FRAG = { radius: 270, dmg: 160, fuse: 1.45 };
export const MOLOTOV = { radius: 190, dur: 5, dps: 32, fuse: 4 };
const FRAG_LIMIT = 30;

export class GrenadeManager {
  constructor(game) {
    this.game = game;
    this.projectiles = [];
    this.fires = [];
    this.fragGeo = new THREE.SphereGeometry(3.4, 10, 8);
    this.fragMat = new THREE.MeshStandardMaterial({ color: 0x2f4a2c, roughness: 0.6, metalness: 0.3, emissive: 0x123012, emissiveIntensity: 0.25 });
    this.mollyMat = new THREE.MeshStandardMaterial({ color: 0x6b4a22, roughness: 0.5, metalness: 0.2, emissive: 0xaa4400, emissiveIntensity: 0.35 });
  }

  clear() {
    for (const pr of this.projectiles) this.game.scene.remove(pr.mesh);
    this.projectiles.length = 0;
    this.fires.length = 0;
  }

  throw(kind) {
    const g = this.game;
    if (!g.playerAlive) return false;
    if ((g.nades?.[kind] ?? 0) <= 0) return false;
    g.nades[kind]--;
    g.hud.refreshNades();
    const p = g.player;
    const dir = p.lookDir();
    const origin = p.eyePos().addScaledVector(dir, 18);
    const vel = dir.clone().multiplyScalar(1180).add(new THREE.Vector3(0, 175, 0));
    vel.x += p.vel.x * 0.4; vel.z += p.vel.z * 0.4;
    const mesh = new THREE.Mesh(this.fragGeo, kind === 'molotov' ? this.mollyMat : this.fragMat);
    mesh.position.copy(origin);
    g.scene.add(mesh);
    this.projectiles.push({
      kind, mesh, pos: origin.clone(), vel, t: 0,
      fuse: kind === 'molotov' ? MOLOTOV.fuse : FRAG.fuse,
    });
    g.audio.play('nade_throw');
    return true;
  }

  update(dt) {
    const g = this.game;
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      pr.vel.y -= 800 * dt;
      const step = pr.vel.clone().multiplyScalar(dt);
      const len = step.length();
      if (len > 1e-3) {
        const inv = 1 / len;
        const dx = step.x * inv, dy = step.y * inv, dz = step.z * inv;
        const hit = g.world.raycast(pr.pos.x, pr.pos.y, pr.pos.z, dx, dy, dz, len + 4);
        if (hit) {
          pr.pos.x += dx * Math.max(0, hit.t - 4);
          pr.pos.y += dy * Math.max(0, hit.t - 4);
          pr.pos.z += dz * Math.max(0, hit.t - 4);
          if (pr.kind === 'molotov') { this.detonate(pr); g.scene.remove(pr.mesh); this.projectiles.splice(i, 1); continue; }
          const n = new THREE.Vector3(hit.nx, hit.ny, hit.nz);
          const vn = pr.vel.dot(n);
          pr.vel.addScaledVector(n, -1.45 * vn);   // reflect (≈0.45 restitution)
          pr.vel.multiplyScalar(0.6);              // surface friction
          if (pr.vel.length() > 60) g.audio.play('nade_bounce', pr.pos);
        } else {
          pr.pos.add(step);
        }
      }
      pr.mesh.position.copy(pr.pos);
      pr.mesh.rotation.x += dt * 9; pr.mesh.rotation.y += dt * 6;
      if (pr.t >= pr.fuse) { this.detonate(pr); g.scene.remove(pr.mesh); this.projectiles.splice(i, 1); }
    }

    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t >= f.dur) { this.fires.splice(i, 1); continue; }
      const flames = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < flames; k++) {
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * f.radius;
        g.effects.flame(new THREE.Vector3(f.pos.x + Math.cos(a) * r, f.pos.y + 2, f.pos.z + Math.sin(a) * r));
      }
      f.crackle -= dt;
      if (f.crackle <= 0) { f.crackle = 0.28 + Math.random() * 0.3; g.audio.play('fire', f.pos); }
      if (f.offline) {
        f.tick -= dt;
        if (f.tick <= 0) { f.tick = 0.4; this._fireTickOffline(f); }
      }
    }
  }

  detonate(pr) {
    const g = this.game;
    g.audio.play('explosion', pr.pos);
    if (pr.kind === 'frag') {
      g.effects.explosion(pr.pos, 1.35);
      g.hud.kick?.(0.5);
      if (g.online) g.net.send({ t: 'grenade', kind: 'frag', pos: [pr.pos.x, pr.pos.y, pr.pos.z] });
      else this._fragOffline(pr.pos);
    } else {
      g.effects.explosion(pr.pos, 0.85);
      if (g.online) { g.net.send({ t: 'grenade', kind: 'molotov', pos: [pr.pos.x, pr.pos.y, pr.pos.z] }); this.addFire(pr.pos, MOLOTOV.dur, false); }
      else this.addFire(pr.pos, MOLOTOV.dur, true);
    }
  }

  addFire(pos, dur, offline) {
    this.fires.push({ pos: pos.clone(), dur, t: 0, radius: MOLOTOV.radius, offline, crackle: 0, tick: 0.4 });
  }

  _fragOffline(pos) {
    const g = this.game;
    for (const bot of g.bots.bots) {
      if (!bot.alive) continue;
      const d = bot.pos.distanceTo(pos);
      if (d >= FRAG.radius) continue;
      const dmg = FRAG.dmg * (1 - d / FRAG.radius);
      g.effects.blood(bot.pos.clone().add(new THREE.Vector3(0, 40, 0)), null);
      if (g.bots.applyDamage(bot, dmg, 'body', 'frag')) {
        g.score++; g.audio.play('kill');
        g.hud.addKill('YOU', 'frag', bot.name, false, true);
        g.hud.setScores(g.score, g.topOpponentScore());
        if (g.score >= FRAG_LIMIT) { g.endMatch(); return; }
      }
    }
    const ds = g.player.pos.distanceTo(pos);
    if (ds < FRAG.radius && g.playerAlive) g.damagePlayer(FRAG.dmg * (1 - ds / FRAG.radius) * 0.8, pos, null, 'fall');
  }

  _fireTickOffline(f) {
    const g = this.game;
    for (const bot of g.bots.bots) {
      if (!bot.alive) continue;
      if (bot.pos.distanceTo(f.pos) < f.radius) g.bots.applyDamage(bot, MOLOTOV.dps * 0.4, 'body', 'frag');
    }
    if (g.playerAlive && g.player.pos.distanceTo(f.pos) < f.radius) g.damagePlayer(MOLOTOV.dps * 0.4, f.pos, null, 'fall');
  }
}
