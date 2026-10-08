// Pooled visual effects: tracers, impact puffs/decals, blood, muzzle flashes, shell casings.
import * as THREE from 'three';

function radialTex(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tracers = [];
    this.particles = [];
    this.shells = [];
    this.decals = [];
    this.maxDecals = 64;
    this.lights = [];

    this.puffTex = radialTex('rgba(214,195,160,0.65)', 'rgba(214,195,160,0)');
    this.bloodTex = radialTex('rgba(150,16,16,0.9)', 'rgba(120,10,10,0)');
    this.flashTex = radialTex('rgba(255,250,220,1)', 'rgba(255,180,60,0)');
    this.fireTex = radialTex('rgba(255,232,150,1)', 'rgba(255,70,18,0)');
    this.smokeTex = radialTex('rgba(64,58,52,0.7)', 'rgba(40,38,35,0)');

    const dc = document.createElement('canvas');
    dc.width = dc.height = 64;
    const g = dc.getContext('2d');
    let gr = g.createRadialGradient(32, 32, 1, 32, 32, 14);
    gr.addColorStop(0, 'rgba(10,8,6,0.95)');
    gr.addColorStop(0.6, 'rgba(25,20,14,0.7)');
    gr.addColorStop(1, 'rgba(30,24,16,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(60,50,35,0.35)';
    for (let i = 0; i < 7; i++) { // cracks
      g.beginPath();
      const a = Math.random() * 7;
      g.moveTo(32, 32);
      g.lineTo(32 + Math.cos(a) * (12 + Math.random() * 12), 32 + Math.sin(a) * (12 + Math.random() * 12));
      g.stroke();
    }
    this.decalTex = new THREE.CanvasTexture(dc);

    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.tracerGeo = new THREE.BoxGeometry(1.4, 1.4, 1);
  }

  tracer(from, to) {
    const dir = to.clone().sub(from);
    const len = dir.length();
    if (len < 30) return;
    const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    const segLen = Math.min(140, len * 0.4);
    m.scale.z = segLen;
    m.position.copy(from);
    m.lookAt(to);
    this.scene.add(m);
    this.tracers.push({ mesh: m, from: from.clone(), dir: dir.normalize(), t: 0, len, speed: 9000, segLen });
  }

  muzzleFlash(pos, scale = 1) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.position.copy(pos);
    s.scale.setScalar((10 + Math.random() * 6) * scale);
    this.scene.add(s);
    const l = new THREE.PointLight(0xffc66e, 900 * scale, 320, 1.6);
    l.position.copy(pos);
    this.scene.add(l);
    this.lights.push({ sprite: s, light: l, t: 0, life: 0.05, decay: 0.55 });
  }

  // Grenade / bomber explosion: fireball + smoke + scorch puff + a bright flash light.
  explosion(pos, scale = 1) {
    const up = new THREE.Vector3(0, 1, 0);
    this._spawnParticles(pos, null, this.fireTex, 16, { speed: 150 * scale, size: 14 * scale, life: 0.4, grow: 2.2, grav: 60, opacity: 1 });
    this._spawnParticles(pos, up, this.smokeTex, 9, { speed: 70 * scale, size: 16 * scale, life: 0.95, grow: 2.6, grav: 22, opacity: 0.6 });
    this._spawnParticles(pos.clone().add(up.clone().multiplyScalar(2)), up, this.puffTex, 6, { speed: 95 * scale, size: 12 * scale, life: 0.5, grow: 2.4, grav: -60 });
    const l = new THREE.PointLight(0xff8a3a, 2600 * scale, 950 * scale, 1.6);
    l.position.copy(pos);
    this.scene.add(l);
    this.lights.push({ sprite: null, light: l, t: 0, life: 0.34, decay: 0.82 });
  }

  // One flame puff — molotov fire zones call this repeatedly while burning.
  flame(pos, scale = 1) {
    this._spawnParticles(pos, new THREE.Vector3(0, 1, 0), this.fireTex, 1, { speed: 42 * scale, size: 11 * scale, life: 0.5, grow: 1.7, grav: 55, opacity: 0.9 });
  }

  _spawnParticles(pos, dirN, tex, count, opts) {
    for (let i = 0; i < count; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity ?? 0.8 }));
      s.position.copy(pos);
      const v = new THREE.Vector3(
        (Math.random() - 0.5) * 2, Math.random() * 0.9 + 0.1, (Math.random() - 0.5) * 2
      ).normalize().multiplyScalar(opts.speed * (0.4 + Math.random() * 0.9));
      if (dirN) v.addScaledVector(dirN, opts.speed * 0.7);
      s.scale.setScalar(opts.size * (0.7 + Math.random() * 0.6));
      this.scene.add(s);
      this.particles.push({ sprite: s, vel: v, t: 0, life: opts.life, grow: opts.grow ?? 1, grav: opts.grav ?? 0 });
    }
  }

  impact(point, normal) {
    const n = new THREE.Vector3(normal.x, normal.y, normal.z);
    this._spawnParticles(point.clone().addScaledVector(n, 2), n, this.puffTex, 4, { speed: 70, size: 7, life: 0.45, grow: 2.4, grav: -40 });
    // decal
    let d;
    if (this.decals.length >= this.maxDecals) {
      d = this.decals.shift();
    } else {
      d = new THREE.Mesh(
        new THREE.PlaneGeometry(7, 7),
        new THREE.MeshBasicMaterial({ map: this.decalTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
      );
    }
    d.position.copy(point).addScaledVector(n, 0.5);
    d.lookAt(point.clone().add(n));
    d.rotateZ(Math.random() * 6.28);
    d.material.opacity = 1;
    this.scene.add(d);
    this.decals.push(d);
  }

  blood(point, dirN) {
    this._spawnParticles(point, dirN ? dirN.clone().multiplyScalar(-0.4) : null, this.bloodTex, 6, { speed: 90, size: 6, life: 0.4, grow: 1.8, grav: -300, opacity: 0.9 });
  }

  shell(pos, rightDir) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 2),
      new THREE.MeshStandardMaterial({ color: 0xc8a23c, roughness: 0.4, metalness: 0.8 })
    );
    m.position.copy(pos);
    this.scene.add(m);
    this.shells.push({
      mesh: m, t: 0,
      vel: rightDir.clone().multiplyScalar(60 + Math.random() * 40).add(new THREE.Vector3(0, 90 + Math.random() * 40, 0)),
      rot: new THREE.Vector3(Math.random() * 12, Math.random() * 12, Math.random() * 12),
    });
  }

  update(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.t += dt * t.speed;
      if (t.t >= t.len) {
        this.scene.remove(t.mesh);
        this.tracers.splice(i, 1);
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, Math.min(t.t + t.segLen / 2, t.len - t.segLen / 2));
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.life) {
        this.scene.remove(p.sprite);
        p.sprite.material.dispose();
        this.particles.splice(i, 1);
        continue;
      }
      p.vel.y += p.grav * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.t / p.life;
      p.sprite.material.opacity = (1 - k) * 0.85;
      p.sprite.scale.multiplyScalar(1 + (p.grow - 1) * dt * 2);
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.t += dt;
      if (s.t > 0.9) {
        this.scene.remove(s.mesh);
        this.shells.splice(i, 1);
        continue;
      }
      s.vel.y -= 800 * dt;
      s.mesh.position.addScaledVector(s.vel, dt);
      s.mesh.rotation.x += s.rot.x * dt;
      s.mesh.rotation.y += s.rot.y * dt;
      s.mesh.rotation.z += s.rot.z * dt;
    }
    for (let i = this.lights.length - 1; i >= 0; i--) {
      const f = this.lights[i];
      f.t += dt;
      if (f.t > (f.life ?? 0.05)) {
        if (f.sprite) { this.scene.remove(f.sprite); f.sprite.material.dispose(); }
        this.scene.remove(f.light);
        this.lights.splice(i, 1);
        continue;
      }
      f.light.intensity *= (f.decay ?? 0.55);
    }
  }
}
