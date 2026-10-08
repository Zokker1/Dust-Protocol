// Map "de_dustette" — a Dust2-flavored deathmatch arena built from AABBs.
// World units are Source units: player 72u tall, map ~3200x2400u.
// North = -Z. Layout: T plaza (north) / CT plaza (south), connected by:
//   - B tunnels (west block, roofed corridor) + side passage into mid
//   - Mid (double doors wall with central gap, low wall cover)
//   - A courtyard (east, walled yard with platform + steps)
//   - Two outer alleys along the west/east perimeter.
import * as THREE from 'three';
import { rayAABB } from './utils.js';

const T = 32;          // wall thickness
const WALL_H = 256;
const PERIM_H = 320;

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function noise(g, s, n, alpha, light = true, dark = true) {
  for (let i = 0; i < n; i++) {
    const w = 1 + Math.random() * 3;
    g.fillStyle = (dark && (!light || Math.random() < 0.5)) ? `rgba(40,30,15,${alpha})` : `rgba(255,250,235,${alpha})`;
    g.fillRect(Math.random() * s, Math.random() * s, w, w);
  }
}

function makeTextures() {
  const plaster = canvasTex(256, (g, s) => {
    g.fillStyle = '#c9b289'; g.fillRect(0, 0, s, s);
    noise(g, s, 2600, 0.05);
    for (let i = 0; i < 9; i++) { // weathering streaks
      g.fillStyle = `rgba(120,95,55,${0.04 + Math.random() * 0.04})`;
      const x = Math.random() * s;
      g.fillRect(x, 0, 2 + Math.random() * 9, s);
    }
    for (let i = 0; i < 5; i++) {
      g.fillStyle = 'rgba(90,70,40,0.06)';
      g.fillRect(0, Math.random() * s, s, 1 + Math.random() * 2);
    }
  });
  const plasterDark = canvasTex(256, (g, s) => {
    g.fillStyle = '#97876c'; g.fillRect(0, 0, s, s);
    noise(g, s, 3000, 0.06);
    for (let i = 0; i < 8; i++) {
      g.fillStyle = 'rgba(30,25,15,0.07)';
      g.fillRect(Math.random() * s, 0, 3 + Math.random() * 10, s);
    }
  });
  const sand = canvasTex(256, (g, s) => {
    g.fillStyle = '#c0a474'; g.fillRect(0, 0, s, s);
    noise(g, s, 4200, 0.05);
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(${100 + Math.random() * 60 | 0},${80 + Math.random() * 50 | 0},40,0.05)`;
      g.beginPath();
      g.ellipse(Math.random() * s, Math.random() * s, 12 + Math.random() * 42, 8 + Math.random() * 26, Math.random() * 3, 0, 7);
      g.fill();
    }
    for (let i = 0; i < 200; i++) { // pebbles
      g.fillStyle = `rgba(70,58,35,${0.12 + Math.random() * 0.2})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
  });
  const crate = canvasTex(256, (g, s) => {
    g.fillStyle = '#a8803f'; g.fillRect(0, 0, s, s);
    for (let p = 0; p < 4; p++) { // planks
      const y = p * s / 4;
      g.fillStyle = `rgba(${140 + Math.random() * 30 | 0},${100 + Math.random() * 25 | 0},50,0.35)`;
      g.fillRect(0, y + 2, s, s / 4 - 4);
      g.fillStyle = 'rgba(50,32,10,0.55)';
      g.fillRect(0, y, s, 3);
      for (let i = 0; i < 24; i++) { // grain
        g.fillStyle = 'rgba(70,45,15,0.18)';
        g.fillRect(Math.random() * s, y + 4 + Math.random() * (s / 4 - 8), 14 + Math.random() * 40, 1.5);
      }
    }
    g.strokeStyle = '#6f5220'; g.lineWidth = 18; g.strokeRect(0, 0, s, s); // frame
    g.strokeStyle = 'rgba(35,22,5,0.5)'; g.lineWidth = 3; g.strokeRect(11, 11, s - 22, s - 22);
    g.fillStyle = 'rgba(45,30,10,0.6)';
    g.font = 'bold 30px Arial'; g.textAlign = 'center';
    g.fillText('SUPPLY CO.', s / 2, s / 2 + 10);
    g.fillStyle = '#3a2a10';
    for (const [x, y] of [[14, 14], [s - 14, 14], [14, s - 14], [s - 14, s - 14]]) {
      g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    }
  });
  const metal = canvasTex(128, (g, s) => {
    g.fillStyle = '#787e80'; g.fillRect(0, 0, s, s);
    noise(g, s, 900, 0.07);
    for (let i = 0; i < 14; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.04 + Math.random() * 0.05})`;
      g.beginPath();
      const y = Math.random() * s;
      g.moveTo(0, y); g.lineTo(s, y + (Math.random() - 0.5) * 14);
      g.stroke();
    }
  });
  return { plaster, plasterDark, sand, crate, metal };
}

// Scale BoxGeometry UVs so a texture tiles every `t` units regardless of box size.
function scaleBoxUVs(geo, w, h, d, t) {
  const uv = geo.attributes.uv;
  const scales = [[d / t, h / t], [d / t, h / t], [w / t, d / t], [w / t, d / t], [w / t, h / t], [w / t, h / t]];
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = scales[i >> 2];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  uv.needsUpdate = true;
}

export function buildWorld(scene, renderer) {
  const tex = makeTextures();
  const mats = {
    plaster: new THREE.MeshStandardMaterial({ map: tex.plaster, roughness: 0.96, metalness: 0 }),
    plasterDark: new THREE.MeshStandardMaterial({ map: tex.plasterDark, roughness: 0.97, metalness: 0 }),
    sand: new THREE.MeshStandardMaterial({ map: tex.sand, roughness: 1, metalness: 0 }),
    crate: new THREE.MeshStandardMaterial({ map: tex.crate, roughness: 0.85, metalness: 0 }),
    metal: new THREE.MeshStandardMaterial({ map: tex.metal, roughness: 0.55, metalness: 0.45 }),
  };

  const colliders = [];
  const shootables = [];
  const radarRects = [];
  const group = new THREE.Group();
  scene.add(group);

  function addBox(matName, x1, z1, x2, z2, y0, y1, texSize = 160) {
    const w = x2 - x1, d = z2 - z1, h = y1 - y0;
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, texSize);
    const m = new THREE.Mesh(geo, mats[matName]);
    m.position.set((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.static = true;
    group.add(m);
    shootables.push(m);
    colliders.push({ minX: x1, minY: y0, minZ: z1, maxX: x2, maxY: y1, maxZ: z2 });
    if (y0 < 70 && y1 > 40) radarRects.push({ x1, z1, x2, z2 });
    return m;
  }
  const wall = (x1, z1, x2, z2, h = WALL_H, mat = 'plaster') => addBox(mat, x1, z1, x2, z2, 0, h);
  const crate = (cx, cz, s = 56, y0 = 0) => addBox('crate', cx - s / 2, cz - s / 2, cx + s / 2, cz + s / 2, y0, y0 + s, s);

  // ---- floor ----
  addBox('sand', -1632, -1232, 1632, 1232, -32, 0, 128);

  // ---- perimeter ----
  wall(-1632, -1232, 1632, -1200, PERIM_H); // N
  wall(-1632, 1200, 1632, 1232, PERIM_H);   // S
  wall(-1632, -1232, -1600, 1232, PERIM_H); // W
  wall(1600, -1232, 1632, 1232, PERIM_H);   // E

  // ---- west block: B tunnels ----
  wall(-1400, -650, -1050, 650);                       // W1 (west of tunnel)
  wall(-800, -650, -450, 220);                         // W2a (east of tunnel, north of passage)
  wall(-800, 340, -450, 650);                          // W2b (south of passage)
  addBox('plasterDark', -1080, -650, -770, 650, 128, 176); // tunnel roof
  addBox('plasterDark', -800, 220, -450, 340, 128, 176);   // passage roof (tunnel -> mid)
  crate(-980, 100);

  // ---- east block: A courtyard ----
  wall(450, -650, 700, -618);   // N wall, west of gate
  wall(900, -650, 1400, -618);  // N wall, east of gate
  wall(450, 618, 900, 650);     // S wall, west of gate
  wall(1100, 618, 1400, 650);   // S wall, east of gate
  wall(450, -650, 482, -80);    // W wall, north of door
  wall(450, 80, 482, 650);      // W wall, south of door
  wall(1368, -650, 1400, 650);  // E wall
  // gate lintels
  addBox('plasterDark', 700, -650, 900, -618, 160, WALL_H);
  addBox('plasterDark', 900, 618, 1100, 650, 160, WALL_H);
  addBox('plasterDark', 450, -80, 482, 80, 160, WALL_H);
  // platform + steps (site A heaven)
  addBox('plasterDark', 1100, -180, 1368, 180, 0, 64);
  addBox('plasterDark', 1068, -100, 1100, 100, 0, 48);
  addBox('plasterDark', 1036, -100, 1068, 100, 0, 32);
  addBox('plasterDark', 1004, -100, 1036, 100, 0, 16);
  crate(600, -400); crate(584, -416, 56, 56);
  crate(1250, 430, 72);

  // ---- mid ----
  wall(-450, -16, -90, 16);  // mid doors wall, west segment
  wall(90, -16, 450, 16);    // east segment
  addBox('plasterDark', -90, -16, 90, 16, 160, WALL_H); // door lintel
  addBox('plasterDark', -220, -348, 220, -316, 0, 48);  // low cover wall
  crate(380, -560);

  // ---- plazas ----
  crate(-1000, -900); crate(-1016, -884, 56, 56);
  crate(-300, -1050, 80); crate(300, -850);
  crate(1000, -950); crate(984, -966, 56, 56);
  crate(-1000, 900); crate(-984, 884, 56, 56);
  crate(-300, 850);
  crate(1000, 950); crate(1016, 934, 56, 56);

  // ---- barrels ----
  for (const [bx, bz] of [[380, -460], [-380, 540], [700, -80]]) {
    const geo = new THREE.CylinderGeometry(22, 22, 48, 14);
    const m = new THREE.Mesh(geo, mats.metal);
    m.position.set(bx, 24, bz);
    m.castShadow = m.receiveShadow = true;
    m.userData.static = true;
    group.add(m);
    shootables.push(m);
    colliders.push({ minX: bx - 22, minY: 0, minZ: bz - 22, maxX: bx + 22, maxY: 48, maxZ: bz + 22 });
    radarRects.push({ x1: bx - 22, z1: bz - 22, x2: bx + 22, z2: bz + 22 });
  }

  // ---- site letters painted on the ground ----
  function siteMark(letter, x, z) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(214,176,80,0.9)'; g.lineWidth = 10;
    g.strokeRect(18, 18, 220, 220);
    g.fillStyle = 'rgba(214,176,80,0.9)';
    g.font = 'bold 170px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(letter, 128, 140);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.8, z);
    group.add(m);
  }
  siteMark('A', 925, -200);
  siteMark('B', -925, -300);

  // ===== Expansion: two-storey "outpost" in the south plaza =====
  // Ground floor = two rooms joined by a doorway; an open staircase in the SE
  // corner climbs to an upper floor (walkable slab) with a balcony parapet and a
  // small upper room. Heights are tuned so the player's 18u step-climb walks the
  // stairs and stands on the slab; the server mirrors the walls/floors so zombies
  // can navigate and climb too.
  {
    const BX1 = -360, BX2 = 360, BZ1 = 600, BZ2 = 1060;
    const WT = 24, GW = 184, UP = 200;        // wall thickness, slab underside, walk height
    const slab0 = GW, slab1 = UP;             // 16u slab
    const PT = 20, PTOP = UP + 46;            // parapet thickness / top

    // ---- ground perimeter (up to the slab) — a wide doorway on every side ----
    addBox('plaster', BX1, BZ1, -130, BZ1 + WT, 0, GW);  // N wall, left of entrance
    addBox('plaster', 130, BZ1, BX2, BZ1 + WT, 0, GW);   // N wall, right of entrance
    addBox('plaster', BX1, BZ2 - WT, -130, BZ2, 0, GW);  // S wall, left of back door
    addBox('plaster', 130, BZ2 - WT, BX2, BZ2, 0, GW);   // S wall, right of back door
    addBox('plaster', BX1, BZ1, BX1 + WT, 720, 0, GW);   // W wall, north of side door
    addBox('plaster', BX1, 960, BX1 + WT, BZ2, 0, GW);   // W wall, south of side door
    addBox('plaster', BX2 - WT, BZ1, BX2, 700, 0, GW);   // E wall, north of side door
    addBox('plaster', BX2 - WT, 840, BX2, BZ2, 0, GW);   // E wall, south of side door
    addBox('plaster', BX1, 818, -110, 842, 0, GW);       // interior divider, west of door
    // (east of the door is left open — that's where the staircase reaches the slab)

    // ---- upper floor slab (open stair well in the SE corner) ----
    addBox('plasterDark', BX1, BZ1, BX2, 845, slab0, slab1, 160);   // north half (full width)
    addBox('plasterDark', BX1, 845, 140, BZ2, slab0, slab1, 160);   // south-west half

    // ---- staircase: climbs from the south (low) up to the north (slab) ----
    const STEPS = 12, sx1 = 160, sx2 = 320, zBot = 1034, run = 192, rise = UP / STEPS;
    for (let k = 0; k < STEPS; k++) {
      const zf = zBot - k * (run / STEPS);
      addBox('plasterDark', sx1, zf - run / STEPS, sx2, zf, 0, (k + 1) * rise, 64);
    }

    // ---- balcony parapet around the slab edge, with firing gaps ----
    addBox('plaster', BX1, BZ1, -150, BZ1 + PT, UP, PTOP);   // N, gap -90..90
    addBox('plaster', -90, BZ1, 90, BZ1 + PT, UP, PTOP);
    addBox('plaster', 150, BZ1, BX2, BZ1 + PT, UP, PTOP);
    addBox('plaster', BX1, BZ2 - PT, -150, BZ2, UP, PTOP);   // S, gap -90..90
    addBox('plaster', -90, BZ2 - PT, 90, BZ2, UP, PTOP);
    addBox('plaster', 150, BZ2 - PT, BX2, BZ2, UP, PTOP);
    addBox('plaster', BX1, BZ1, BX1 + PT, 760, UP, PTOP);    // W, gap 760..900
    addBox('plaster', BX1, 900, BX1 + PT, BZ2, UP, PTOP);
    addBox('plaster', BX2 - PT, BZ1, BX2, 690, UP, PTOP);    // E, gap 690..760, open over stair well
    addBox('plaster', BX2 - PT, 760, BX2, 845, UP, PTOP);

    // ---- small upper room in the NW corner (doorway on its south side) ----
    const rX1 = BX1 + PT, rX2 = -70, rZ1 = BZ1 + PT, rZ2 = 812, rTop = UP + 168;
    addBox('plaster', rX1, rZ1, rX2, rZ1 + WT, UP, rTop);    // room N
    addBox('plaster', rX1, rZ1, rX1 + WT, rZ2, UP, rTop);    // room W
    addBox('plaster', rX2 - WT, rZ1, rX2, rZ2, UP, rTop);    // room E
    addBox('plaster', rX1, rZ2 - WT, -230, rZ2, UP, rTop);   // room S, west of door
    addBox('plaster', -170, rZ2 - WT, rX2, rZ2, UP, rTop);   // room S, east of door

    // ---- cover crates ----
    crate(250, 690, 56);           // north ground room
    crate(120, 700, 48, UP);       // on the balcony
  }

  // ===== Second layout: a shipping-container maze, toggled by the server per match =====
  // Built into its own hidden group; its colliders/shootables only join the live arrays
  // when the variant is switched on, so the default map A is untouched when it's off.
  const variantColliders = [];
  const variantShootables = [];
  const variantGroup = new THREE.Group();
  group.add(variantGroup);
  variantGroup.visible = false;
  function addVariantBox(matName, x1, z1, x2, z2, y0, y1, texSize = 160) {
    const w = x2 - x1, d = z2 - z1, h = y1 - y0;
    const geo = new THREE.BoxGeometry(w, h, d);
    scaleBoxUVs(geo, w, h, d, texSize);
    const m = new THREE.Mesh(geo, mats[matName]);
    m.position.set((x1 + x2) / 2, (y0 + y1) / 2, (z1 + z2) / 2);
    m.castShadow = m.receiveShadow = true;
    m.userData.static = true;
    variantGroup.add(m);
    variantShootables.push(m);
    variantColliders.push({ minX: x1, minY: y0, minZ: z1, maxX: x2, maxY: y1, maxZ: z2 });
  }
  // Container cluster in the open plazas / mid (mirrors server.mjs VARIANT_BLOCKERS).
  const CONTAINERS = [
    [380, -1030, 520, -770], [-520, -830, -380, -570],
    [620, -460, 900, -340], [-900, -360, -620, -240],
    [130, 290, 410, 410], [-410, 240, -130, 360],
  ];
  for (const [x1, z1, x2, z2] of CONTAINERS) addVariantBox('metal', x1, z1, x2, z2, 0, 112, 110);
  let variantOn = false;
  function setMapVariant(on) {
    on = !!on;
    if (on === variantOn) return;
    variantOn = on;
    variantGroup.visible = on;
    if (on) {
      for (const c of variantColliders) colliders.push(c);
      for (const s of variantShootables) shootables.push(s);
    } else {
      for (const c of variantColliders) { const i = colliders.indexOf(c); if (i >= 0) colliders.splice(i, 1); }
      for (const s of variantShootables) { const i = shootables.indexOf(s); if (i >= 0) shootables.splice(i, 1); }
    }
  }

  // ---- sky, sun, moon, lights, fog (daylight + zombie moods) ----
  const dayTex = canvasTex(512, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#4f86c0');
    gr.addColorStop(0.45, '#8fb4d6');
    gr.addColorStop(0.72, '#d9cda9');
    gr.addColorStop(1, '#e4d6b0');
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  });
  const nightTex = canvasTex(512, (g, s) => { // dusk / blue-hour sky (dim, not black)
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#1c2c44');   // deep dusk blue overhead
    gr.addColorStop(0.5, '#34465e'); // twilight blue-grey
    gr.addColorStop(0.8, '#5b5f6b'); // hazy band
    gr.addColorStop(1, '#7a6f63');   // warm dusk glow on the horizon
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 130; i++) {  // a few faint early stars up high
      g.fillStyle = `rgba(212,224,240,${0.1 + Math.random() * 0.28})`;
      g.fillRect(Math.random() * s, Math.random() * s * 0.45, 1, 1);
    }
  });
  for (const t of [dayTex, nightTex]) t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const skyMat = new THREE.MeshBasicMaterial({ map: dayTex, side: THREE.BackSide, fog: false });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(14000, 24, 18), skyMat);
  scene.add(sky);

  function glowSprite(stops, scale) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    for (const [o, c] of stops) gr.addColorStop(o, c);
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, fog: false, depthWrite: false }));
    sp.scale.set(scale, scale, 1);
    return sp;
  }

  const sunDir = new THREE.Vector3(1400, 2400, 900);
  const moonDir = new THREE.Vector3(-2600, 1500, -4200);
  const sun = glowSprite([[0, 'rgba(255,252,230,1)'], [0.25, 'rgba(255,238,180,0.85)'], [1, 'rgba(255,238,180,0)']], 2600);
  sun.position.copy(sunDir).normalize().multiplyScalar(12500);
  scene.add(sun);
  const moon = glowSprite([[0, 'rgba(226,234,216,1)'], [0.35, 'rgba(150,170,150,0.7)'], [1, 'rgba(80,110,95,0)']], 1700);
  moon.position.copy(moonDir).normalize().multiplyScalar(12500);
  moon.visible = false;
  scene.add(moon);

  const hemi = new THREE.HemisphereLight(0xcfe2f3, 0x9a7f54, 0.85);
  scene.add(hemi);
  const dl = new THREE.DirectionalLight(0xffeccb, 2.1);
  dl.position.copy(sunDir);
  dl.castShadow = true;
  dl.shadow.mapSize.set(2048, 2048);
  dl.shadow.camera.left = -2400; dl.shadow.camera.right = 2400;
  dl.shadow.camera.top = 2000; dl.shadow.camera.bottom = -2000;
  dl.shadow.camera.near = 100; dl.shadow.camera.far = 7000;
  dl.shadow.bias = -0.0004;
  dl.shadow.normalBias = 6;
  dl.shadow.camera.updateProjectionMatrix();
  scene.add(dl);
  scene.add(dl.target);
  scene.fog = new THREE.Fog(0xd8cba6, 3200, 13000);

  // Red emergency lights — dark by default, flickering only in zombie mood.
  const fxLights = [];
  for (const [fx, fy, fz] of [
    [925, 210, -200], [-925, 210, -300], [0, 210, 80], [-1000, 210, 780], [1000, 210, -780],
    [0, 236, 950],                    // outpost balcony
    [-150, 120, 710], [170, 120, 950], // outpost ground rooms (under the slab)
  ]) {
    const pl = new THREE.PointLight(0xff2a14, 0, 1300, 1.7);
    pl.position.set(fx, fy, fz);
    pl.visible = false;
    scene.add(pl);
    fxLights.push({ light: pl, base: 4 + Math.random() * 2.5, phase: Math.random() * 6.28, speed: 7 + Math.random() * 6 });
  }

  const MOODS = {
    day: {
      hemiSky: 0xcfe2f3, hemiGround: 0x9a7f54, hemiInt: 0.85,
      dlColor: 0xffeccb, dlInt: 2.1, dlPos: sunDir,
      fog: 0xd8cba6, near: 3200, far: 13000, exposure: 1.05,
    },
    zombie: {
      hemiSky: 0x6d8196, hemiGround: 0x3d463f, hemiInt: 0.95,
      dlColor: 0xc2ccde, dlInt: 1.6, dlPos: moonDir,
      fog: 0x3c4654, near: 2900, far: 10000, exposure: 1.06,
    },
  };
  let mood = 'day';
  let moodT = 0;
  function setMood(m) {
    const c = MOODS[m] || MOODS.day;
    mood = MOODS[m] ? m : 'day';
    hemi.color.setHex(c.hemiSky);
    hemi.groundColor.setHex(c.hemiGround);
    hemi.intensity = c.hemiInt;
    dl.color.setHex(c.dlColor);
    dl.intensity = c.dlInt;
    dl.position.copy(c.dlPos);
    scene.fog.color.setHex(c.fog);
    scene.fog.near = c.near;
    scene.fog.far = c.far;
    skyMat.map = mood === 'zombie' ? nightTex : dayTex;
    skyMat.needsUpdate = true;
    sun.visible = mood !== 'zombie';
    moon.visible = mood === 'zombie';
    for (const f of fxLights) { f.light.visible = mood === 'zombie'; if (mood !== 'zombie') f.light.intensity = 0; }
    if (renderer) renderer.toneMappingExposure = c.exposure;
  }
  function updateMood(dt) {
    if (mood !== 'zombie') return;
    moodT += dt;
    for (const f of fxLights) {
      const flick = 0.55 + 0.45 * Math.sin(moodT * f.speed + f.phase);
      const dip = Math.random() < 0.05 ? 0.25 : 1;
      f.light.intensity = f.base * Math.max(0.1, flick) * dip;
    }
  }

  // ---- spawns (feet positions) ----
  const spawns = [
    [-1300, 0, -1000], [0, 0, -1080], [1300, 0, -1000], [-600, 0, -820], [600, 0, -820],
    [-1300, 0, 1000], [0, 0, 1150], [1300, 0, 1000], [-600, 0, 820], [600, 0, 820],
    [-925, 0, 0], [925, 0, 60], [1234, 64, 0], [0, 0, -500],
  ].map(p => new THREE.Vector3(p[0], p[1] + 1, p[2]));

  // ---- waypoint graph for bot navigation ----
  const wp = [
    [0, 0, -950], [-1000, 0, -780], [1000, 0, -780],          // 0-2 T plaza
    [0, 0, 950], [-1000, 0, 780], [1000, 0, 780],             // 3-5 CT plaza
    [0, 0, -470], [0, 0, -160], [0, 0, 80], [0, 0, 460],      // 6-9 mid spine
    [-925, 0, -720], [-925, 0, 0], [-925, 0, 720],            // 10-12 tunnels
    [-625, 0, 280], [-360, 0, 280],                           // 13-14 passage
    [800, 0, -720], [800, 0, -450], [925, 0, 60],             // 15-17 courtyard N
    [1000, 0, 720], [1000, 0, 430], [560, 0, 0], [360, 0, 120], // 18-21 courtyard S/door
    [-1500, 0, -700], [-1500, 0, 0], [-1500, 0, 700],         // 22-24 W alley
    [1500, 0, -700], [1500, 0, 0], [1500, 0, 700],            // 25-27 E alley
    [1234, 64, 0],                                            // 28 platform
    [330, 0, -330], [-330, 0, -330],                          // 29-30 around mid low wall
    [-860, 0, 280],                                           // 31 tunnel-side passage mouth
  ].map(p => ({ pos: new THREE.Vector3(p[0], p[1], p[2]), edges: [] }));

  function raycast(ox, oy, oz, dx, dy, dz, maxT) {
    let best = null;
    for (const b of colliders) {
      const h = rayAABB(ox, oy, oz, dx, dy, dz, b, best ? best.t : maxT);
      if (h) best = h;
    }
    return best;
  }

  function losClear(a, b, lift = 34) {
    const ax = a.x, ay = a.y + lift, az = a.z;
    const dx = b.x - ax, dy = b.y + lift - ay, dz = b.z - az;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1) return true;
    return !raycast(ax, ay, az, dx / len, dy / len, dz / len, len - 1);
  }

  for (let i = 0; i < wp.length; i++) {
    for (let j = i + 1; j < wp.length; j++) {
      const d = wp[i].pos.distanceTo(wp[j].pos);
      if (d <= 1000 && losClear(wp[i].pos, wp[j].pos)) {
        wp[i].edges.push(j);
        wp[j].edges.push(i);
      }
    }
  }

  function nearestWp(pos) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < wp.length; i++) {
      const d = wp[i].pos.distanceTo(pos);
      if (d < bestD && losClear(pos, wp[i].pos)) { bestD = d; best = i; }
    }
    if (best < 0) { // fallback: plain nearest
      for (let i = 0; i < wp.length; i++) {
        const d = wp[i].pos.distanceTo(pos);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }

  function navPath(fromPos, toPos) {
    const a = nearestWp(fromPos), b = nearestWp(toPos);
    if (a < 0 || b < 0) return [toPos.clone()];
    // A*
    const open = [a];
    const came = new Map(), g = new Map([[a, 0]]), f = new Map([[a, wp[a].pos.distanceTo(wp[b].pos)]]);
    const closed = new Set();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if ((f.get(open[i]) ?? 1e9) < (f.get(open[bi]) ?? 1e9)) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur === b) {
        const path = [wp[cur].pos.clone()];
        let c = cur;
        while (came.has(c)) { c = came.get(c); path.unshift(wp[c].pos.clone()); }
        path.push(toPos.clone());
        return path;
      }
      closed.add(cur);
      for (const nb of wp[cur].edges) {
        if (closed.has(nb)) continue;
        const ng = g.get(cur) + wp[cur].pos.distanceTo(wp[nb].pos);
        if (ng < (g.get(nb) ?? 1e9)) {
          came.set(nb, cur);
          g.set(nb, ng);
          f.set(nb, ng + wp[nb].pos.distanceTo(wp[b].pos));
          if (!open.includes(nb)) open.push(nb);
        }
      }
    }
    return [toPos.clone()];
  }

  return {
    colliders, shootables, radarRects, spawns, waypoints: wp,
    raycast, losClear, navPath, setMood, updateMood, setMapVariant,
    bounds: { x1: -1600, z1: -1200, x2: 1600, z2: 1200 },
  };
}
