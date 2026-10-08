// Static file server + WebSocket multiplayer for DUST PROTOCOL.
// Run: npm start  ->  http://localhost:8137
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, relative, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { BUY_SPOTS, BUY_RADIUS, BUY_Y_TOLERANCE, BOX_POOL } from './src/buyspots.js';
import { BARRICADES, BARRICADE_HP, BARRICADE_RADIUS } from './src/barricades.js';
const BARRICADE_ATTACK = 11, REPAIR_RATE = 55;

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const DEFAULT_PORT = 8137;
const PORT_ENV = process.env.PORT ? Number(process.env.PORT) : null;
const MAX_PORT_TRIES = 10;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
};

const MATCH_TIME = 600;
const FRAG_LIMIT = 30;
const MAX_PLAYERS = 8;
const TICK_MS = 50;
// Grenades (mirrors src/grenades.js)
const FRAG_RADIUS = 270, FRAG_DMG = 160;
const MOLOTOV_RADIUS = 190, MOLOTOV_DUR = 5, MOLOTOV_DPS = 32;
// Zombie Co-op economy + floor loot
const ZOMBIE_HIT_POINTS = 6;   // cash per bullet/melee hit on a zombie
const ZOMBIE_KILL_MUL = 2;     // kill payout = type score * this
const LOOT_CHANCE = 0.22, LOOT_MAX = 12, LOOT_TTL = 22, LOOT_RADIUS = 95;
// Down & revive (co-op)
const BLEEDOUT = 32, REVIVE_TIME = 3.4, REVIVE_RADIUS = 95, REVIVE_HP = 55;

// Spawn points mirror world.js (de_dustette)
const SPAWNS = [
  [-1300, 0, -1000], [0, 0, -1080], [1300, 0, -1000], [-600, 0, -820], [600, 0, -820],
  [-1300, 0, 1000], [0, 0, 1150], [1300, 0, 1000], [-600, 0, 820], [600, 0, 820],
  [-925, 0, 0], [925, 0, 60], [1234, 64, 0], [0, 0, -500],
].map(([x, y, z]) => ({ x, y: y + 1, z }));

// Zombies pour in from every edge of the arena so the horde closes from all sides.
const ZOMBIE_SPAWNS = [
  // north edge
  [-1450, -1100], [-870, -1110], [-300, -1120], [300, -1120], [870, -1110], [1450, -1100],
  // south edge
  [-1450, 1100], [-870, 1110], [-300, 1120], [300, 1120], [870, 1110], [1450, 1100],
  // west alley
  [-1500, -640], [-1500, 0], [-1500, 640],
  // east alley
  [1500, -640], [1500, 0], [1500, 640],
].map(([x, z]) => ({ x, y: 1, z }));

// Major map walls mirrored from world.js so zombies steer around them instead of
// clipping through. yMin/yMax let multi-storey walls only affect zombies on that
// level (a ground-floor zombie ignores the upper parapet, and vice versa).
const BLOCKERS = [
  [-1400, -650, -1050, 650],                          // B tunnel west wall
  [-800, -650, -450, 220], [-800, 340, -450, 650],    // B tunnel east walls
  [450, -650, 700, -618], [900, -650, 1400, -618],    // A courtyard north walls
  [450, 618, 900, 650], [1100, 618, 1400, 650],       // A courtyard south walls
  [450, -650, 482, -80], [450, 80, 482, 650],         // A courtyard west walls
  [1368, -650, 1400, 650],                            // A courtyard east wall
  [1100, -180, 1368, 180],                            // A platform base
  [-450, -16, -90, 16], [90, -16, 450, 16],           // mid double-door walls
  [-220, -348, 220, -316],                            // mid low cover
].map(([x1, z1, x2, z2]) => ({ x1, z1, x2, z2, yMin: 0, yMax: Infinity }));

// South-plaza outpost, mirrored from src/world.js. Ground walls only block zombies
// below the slab; parapet/upper-room walls only block zombies that have climbed up.
(function addOutpostBlockers() {
  const BX1 = -360, BX2 = 360, BZ1 = 600, BZ2 = 1060, WT = 24, GW = 184, UP = 200, PT = 20;
  const ground = [
    [BX1, BZ1, -130, BZ1 + WT], [130, BZ1, BX2, BZ1 + WT], // N wall (entrance gap)
    [BX1, BZ2 - WT, -130, BZ2], [130, BZ2 - WT, BX2, BZ2], // S wall (back-door gap)
    [BX1, BZ1, BX1 + WT, 720], [BX1, 960, BX1 + WT, BZ2],  // W wall (side-door gap)
    [BX2 - WT, BZ1, BX2, 700], [BX2 - WT, 840, BX2, BZ2],  // E wall (side-door gap)
    [BX1, 818, -110, 842],                                 // interior divider (open by the stairs)
  ];
  for (const [x1, z1, x2, z2] of ground) BLOCKERS.push({ x1, z1, x2, z2, yMin: 0, yMax: GW - 1 });
  const upper = [
    [BX1, BZ1, -150, BZ1 + PT], [150, BZ1, BX2, BZ1 + PT], // parapet N (gap)
    [BX1, BZ2 - PT, -150, BZ2], [150, BZ2 - PT, BX2, BZ2], // parapet S (gap)
    [BX1, BZ1, BX1 + PT, 760], [BX1, 900, BX1 + PT, BZ2],  // parapet W (gap)
    [BX2 - PT, BZ1, BX2, 690], [BX2 - PT, 760, BX2, 845],  // parapet E (gap + open stair well)
    [BX1 + PT, BZ1 + PT, -70, BZ1 + PT + WT],              // upper room N
    [BX1 + PT, BZ1 + PT, BX1 + PT + WT, 812],              // upper room W
    [-94, BZ1 + PT, -70, 812],                             // upper room E
    [BX1 + PT, 788, -230, 812], [-170, 788, -70, 812],     // upper room S (door gap)
  ];
  for (const [x1, z1, x2, z2] of upper) BLOCKERS.push({ x1, z1, x2, z2, yMin: UP, yMax: Infinity });
})();

// Walkable surfaces above the ground plane (ground itself is y=0 everywhere).
// Zombies adopt the highest surface at or just below their current height, so they
// climb the staircase ramp and stand on the slab rather than teleporting onto it.
const STAIR = { baseX: 240, baseZ: 1012, topX: 240, topZ: 805, x1: 160, x2: 320, zBot: 1034, zTop: 842, top: 200 };
const FLOORS = [
  { x1: -360, z1: 600, x2: 360, z2: 845, y: 200 },     // slab north
  { x1: -360, z1: 845, x2: 140, z2: 1060, y: 200 },    // slab south-west
];

function outpostFloorY(x, z, curY) {
  // The staircase ramp is the climb path — always adopt its height (no step gate)
  // so zombies walk up it instead of getting stuck at the foot of a tall step.
  if (x > STAIR.x1 && x < STAIR.x2 && z > STAIR.zTop && z < STAIR.zBot) {
    return Math.max(0, Math.min(STAIR.top, (STAIR.zBot - z) / (STAIR.zBot - STAIR.zTop) * STAIR.top));
  }
  // Flat upper slabs: only adopt when already near that height (reached via the ramp),
  // so a ground-floor zombie under the slab stays on the ground.
  let best = 0;
  for (const f of FLOORS) {
    if (x > f.x1 && x < f.x2 && z > f.z1 && z < f.z2 && f.y <= curY + 40 && f.y > best) best = f.y;
  }
  return best;
}

// Push an entity out of one wall rect (slide along the nearest face).
function pushOutOf(ent, b, r) {
  if (ent.y + 60 < b.yMin || ent.y > b.yMax) return;
  if (ent.x > b.x1 - r && ent.x < b.x2 + r && ent.z > b.z1 - r && ent.z < b.z2 + r) {
    const penW = ent.x - (b.x1 - r), penE = (b.x2 + r) - ent.x;
    const penN = ent.z - (b.z1 - r), penS = (b.z2 + r) - ent.z;
    const m = Math.min(penW, penE, penN, penS);
    if (m === penW) ent.x = b.x1 - r;
    else if (m === penE) ent.x = b.x2 + r;
    else if (m === penN) ent.z = b.z1 - r;
    else ent.z = b.z2 + r;
  }
}

// Push an entity out of any wall — or any still-standing barricade — it has entered.
function resolveBlocked(ent, r = 20) {
  for (const b of BLOCKERS) pushOutOf(ent, b, r);
  for (const b of barricades) if (b.hp > 0) pushOutOf(ent, b, r);
  if (mapVariant) for (const b of VARIANT_BLOCKERS) pushOutOf(ent, b, r);
}

const ZOMBIE_TYPES = {
  shambler: { label: 'Shambler', hp: 72, hpRound: 13, speed: 86, damage: 12, attackRange: 62, attackCd: 1.1, score: 10 },
  runner: { label: 'Runner', hp: 52, hpRound: 8, speed: 146, damage: 8, attackRange: 58, attackCd: 0.62, score: 15 },
  brute: { label: 'Brute', hp: 215, hpRound: 30, speed: 58, damage: 25, attackRange: 72, attackCd: 1.45, score: 35 },
  spitter: { label: 'Spitter', hp: 92, hpRound: 12, speed: 74, damage: 15, attackRange: 560, attackCd: 2.35, score: 25 },
  // Special infected
  stalker: { label: 'Stalker', hp: 46, hpRound: 7, speed: 170, damage: 9, attackRange: 56, attackCd: 0.6, score: 20, invisible: true },
  bomber: { label: 'Bomber', hp: 58, hpRound: 9, speed: 128, damage: 0, attackRange: 64, attackCd: 0.9, score: 22, explodes: true },
  summoner: { label: 'Necromancer', hp: 240, hpRound: 34, speed: 66, damage: 16, attackRange: 520, attackCd: 2.4, score: 45, summons: true, ranged: true },
};
const BOMBER_RADIUS = 165, BOMBER_DMG = 65;

const players = new Map();
const fireZones = []; // molotov fire: { x, y, z, radius, ttl, dps, ownerId, acc }
const lootItems = []; // floor loot: { id, x, y, z, ttl }
let nextLootId = 1;
// Repairable barricades over the outpost doorways (block zombies while hp > 0).
const barricades = BARRICADES.map(b => ({ ...b, yMin: 0, yMax: 183, hp: BARRICADE_HP, repairT: 0 }));
// Second-layout shipping containers (mirrors src/world.js CONTAINERS); active only when
// the server picks the variant map for a match.
const VARIANT_BLOCKERS = [
  [380, -1030, 520, -770], [-520, -830, -380, -570],
  [620, -460, 900, -340], [-900, -360, -620, -240],
  [130, 290, 410, 410], [-410, 240, -130, 360],
].map(([x1, z1, x2, z2]) => ({ x1, z1, x2, z2, yMin: 0, yMax: Infinity }));
let mapVariant = false;
let nextId = 1;
let matchTimeLeft = MATCH_TIME;
let matchActive = false;
let matchMode = 'deathmatch';
let tickTimer = null;
const zombies = new Map();
let nextZombieId = 1;
let lastZombieSpawnIdx = -1;
let zombieRound = 0;
let zombiePhase = 'idle';
let zombieIntermissionLeft = 0;
let zombiesToSpawn = 0;
let zombieSpawnAcc = 0;
let zombieTotalThisRound = 0;

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function boundedPosition(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(-20000, Math.min(20000, value));
}

function ensureTickTimer() {
  if (!tickTimer) tickTimer = setInterval(gameTick, TICK_MS);
}

function pickSpawn(excludeId = null) {
  const alive = [...players.values()].filter(p => p.alive && p.id !== excludeId);
  const scored = SPAWNS.map(s => {
    let minD = Infinity;
    for (const p of alive) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      minD = Math.min(minD, d);
    }
    return { s, score: minD + Math.random() * 200 };
  }).sort((a, b) => b.score - a.score);
  return scored[0].s;
}

function publicPlayer(p) {
  return {
    id: p.id,
    name: p.name,
    mode: p.mode,
    x: p.x, y: p.y, z: p.z,
    yaw: p.yaw, pitch: p.pitch,
    hp: p.hp, armor: p.armor,
    alive: p.alive,
    kills: p.kills,
    deaths: p.deaths,
    weapon: p.weapon,
    ping: p.ping,
    points: p.points || 0,
    down: !!p.down,
  };
}

function publicZombie(z) {
  return {
    id: z.id,
    type: z.type,
    name: z.name,
    x: z.x, y: z.y, z: z.z,
    yaw: z.yaw,
    hp: z.hp,
    maxHp: z.maxHp,
    alive: z.alive,
  };
}

function publicZombieState() {
  const alive = [...zombies.values()].filter(z => z.alive).length;
  return {
    round: zombieRound,
    phase: zombiePhase,
    remaining: alive + zombiesToSpawn,
    alive,
    toSpawn: zombiesToSpawn,
    total: zombieTotalThisRound,
    nextRoundIn: Math.max(0, zombieIntermissionLeft),
  };
}

function broadcast(msg, except = null) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === 1 && p !== except) p.ws.send(data);
  }
}

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function joinedPlayers() {
  return [...players.values()].filter(p => p.joined);
}

function resetZombieState() {
  zombies.clear();
  fireZones.length = 0;
  lootItems.length = 0;
  nextLootId = 1;
  nextZombieId = 1;
  for (const b of barricades) { b.hp = BARRICADE_HP; b.repairT = 0; }
  zombieRound = 0;
  zombiePhase = 'idle';
  zombieIntermissionLeft = 0;
  zombiesToSpawn = 0;
  zombieSpawnAcc = 0;
  zombieTotalThisRound = 0;
}

function pickZombieSpawn() {
  const humans = joinedPlayers().filter(p => p.alive);
  const scored = ZOMBIE_SPAWNS.map((s, i) => {
    let minD = Infinity;
    for (const p of humans) minD = Math.min(minD, Math.hypot(p.x - s.x, p.z - s.z));
    return { s, i, minD: humans.length ? minD : 700 + Math.random() * 500 };
  });
  // Keep zombies off the players, and avoid reusing the same edge twice in a row so
  // each new spawn tends to come from a different direction.
  let pool = scored.filter(o => o.minD > 520 && o.i !== lastZombieSpawnIdx);
  if (!pool.length) pool = scored.filter(o => o.minD > 360);
  if (!pool.length) pool = scored.slice().sort((a, b) => b.minD - a.minD).slice(0, 4);
  // Weighted random: farther edges are likelier, but the spread keeps the squad
  // surrounded rather than funnelling every zombie through one chokepoint.
  let total = 0;
  for (const o of pool) { o.w = Math.pow(Math.min(1800, o.minD), 1.4); total += o.w; }
  let r = Math.random() * total;
  let pick = pool[pool.length - 1];
  for (const o of pool) { r -= o.w; if (r <= 0) { pick = o; break; } }
  lastZombieSpawnIdx = pick.i;
  return pick.s;
}

function chooseZombieType(round) {
  const roll = Math.random();
  if (round >= 7 && roll > 0.93) return 'summoner';
  if (round >= 5 && roll > 0.84) return 'bomber';
  if (round >= 6 && roll > 0.80) return 'brute';
  if (round >= 4 && roll > 0.70) return 'spitter';
  if (round >= 3 && roll > 0.62) return 'stalker';
  if (round >= 2 && roll > 0.45) return 'runner';
  return 'shambler';
}

function makeZombie(type, x, z, y = 1) {
  const def = ZOMBIE_TYPES[type];
  const standoff = type === 'spitter' || type === 'summoner';
  const maxHp = Math.round(def.hp + def.hpRound * Math.max(0, zombieRound - 1));
  const id = nextZombieId++;
  const zom = {
    id,
    type,
    name: `${def.label} ${id}`,
    x, y, z,
    yaw: Math.random() * Math.PI * 2,
    hp: maxHp,
    maxHp,
    alive: true,
    attackCd: 0.7 + Math.random() * 0.6,
    // AI state
    targetId: null,
    retargetCd: 0,
    // each zombie arcs toward its victim from a slightly different angle so the
    // horde encircles instead of single-filing into one spot
    surroundAngle: (Math.random() * 2 - 1) * (type === 'brute' ? 0.3 : standoff ? 0.4 : 0.95),
    strafePhase: Math.random() * Math.PI * 2,
    strafeDir: Math.random() < 0.5 ? -1 : 1,
    summonCd: 5 + Math.random() * 3,
  };
  zombies.set(id, zom);
  broadcast({ t: 'zombie_spawn', zombie: publicZombie(zom), zombieState: publicZombieState() });
  return zom;
}

function spawnZombie() {
  const sp = pickZombieSpawn();
  makeZombie(chooseZombieType(zombieRound), sp.x, sp.z, sp.y);
}

function prepareHumansForZombieRound() {
  for (const p of joinedPlayers()) {
    p.hp = 100;
    p.armor = 100;
    p.alive = true;
    p.down = false; p.downedT = 0; p.reviverId = null; p.reviveProg = 0;
    p.weapon = p.weapon || 'ak';
    // Carry on from where you ended last round — heal/revive in place, no teleport
    // back to spawn. (Downed players come back where they fell; the intermission is
    // zombie-free so it's safe.)
    send(p.ws, { t: 'respawn', x: p.x, y: p.y, z: p.z, zombie: true });
    broadcast({ t: 'player_respawn', id: p.id, x: p.x, y: p.y, z: p.z }, p);
  }
}

function startZombieRound() {
  zombieRound++;
  zombiePhase = 'spawning';
  zombieIntermissionLeft = 0;
  zombies.clear();
  zombieSpawnAcc = 0.8;
  const humans = Math.max(1, joinedPlayers().length);
  zombieTotalThisRound = Math.min(80, 5 + zombieRound * 4 + humans * 2 + Math.floor(zombieRound * zombieRound * 0.4));
  zombiesToSpawn = zombieTotalThisRound;
  for (const b of barricades) { b.hp = BARRICADE_HP; b.repairT = 0; } // re-fortify each round
  prepareHumansForZombieRound();
  broadcast({
    t: 'zombie_round_start',
    zombieState: publicZombieState(),
    players: joinedPlayers().map(publicPlayer),
    barricades: publicBarricades(),
  });
}

function startZombieMatch() {
  matchActive = true;
  matchMode = 'zombies';
  mapVariant = Math.random() < 0.5;
  ensureTickTimer();
  resetZombieState();
  for (const p of joinedPlayers()) {
    p.kills = 0;
    p.deaths = 0;
    p.points = 500; // starting cash
    p.hp = 100;
    p.armor = 100;
    p.alive = true;
    p.down = false; p.downedT = 0; p.reviverId = null; p.reviveProg = 0;
  }
  zombiePhase = 'intermission';
  zombieIntermissionLeft = 3;
  broadcast({
    t: 'match_start',
    mode: 'zombies',
    mapVariant,
    players: joinedPlayers().map(publicPlayer),
    zombies: [],
    zombieState: publicZombieState(),
  });
}

function endZombieMatch(reason = 'overrun') {
  if (!matchActive || matchMode !== 'zombies') return;
  matchActive = false;
  zombiePhase = 'ended';
  const rows = joinedPlayers()
    .map(publicPlayer)
    .sort((a, b) => b.kills - a.kills);
  broadcast({ t: 'match_end', mode: 'zombies', reason, board: rows, zombieState: publicZombieState() });
}

function startMatchIfNeeded() {
  if (matchActive) return;
  const humans = joinedPlayers();
  if (humans.length < 1) return;
  if (matchMode === 'zombies') {
    startZombieMatch();
    return;
  }
  matchActive = true;
  matchMode = 'deathmatch';
  mapVariant = Math.random() < 0.5;
  fireZones.length = 0;
  ensureTickTimer();
  matchTimeLeft = MATCH_TIME;
  for (const p of humans) {
    p.kills = 0;
    p.deaths = 0;
    p.hp = 100;
    p.armor = 100;
    p.alive = true;
    const sp = pickSpawn(p.id);
    p.x = sp.x; p.y = sp.y; p.z = sp.z;
    p.yaw = Math.PI;
    p.pitch = 0;
    p.weapon = 'ak';
  }
  broadcast({ t: 'match_start', mode: 'deathmatch', mapVariant, timeLeft: matchTimeLeft, players: humans.map(publicPlayer) });
}

function endMatch(reason = 'time') {
  if (!matchActive) return;
  if (matchMode === 'zombies') {
    endZombieMatch(reason);
    return;
  }
  matchActive = false;
  const rows = joinedPlayers()
    .map(publicPlayer)
    .sort((a, b) => b.kills - a.kills);
  broadcast({ t: 'match_end', mode: 'deathmatch', reason, board: rows });
}

function removePlayer(id) {
  const p = players.get(id);
  if (!p) return;
  players.delete(id);
  broadcast({ t: 'player_leave', id });
  if (joinedPlayers().length < 1) {
    matchActive = false;
    matchMode = 'deathmatch';
    resetZombieState();
    if (tickTimer) clearInterval(tickTimer);
    tickTimer = null;
  } else if (matchActive && matchMode === 'zombies' && everyoneIncapacitated()) {
    endZombieMatch('overrun');
  }
}

function applyDamage(victim, dmg, killer, kind = 'body', armorPen = 0.6) {
  if (!victim.alive) return;
  if (victim.down) { if (matchMode === 'zombies') victim.downedT = Math.max(0, victim.downedT - 2.5); return; }
  if (victim.hp <= 0) return;
  let hDmg = dmg;
  if (kind !== 'fall' && victim.armor > 0) {
    hDmg = dmg * armorPen;
    const aDmg = (dmg - hDmg) * 0.5;
    if (aDmg > victim.armor) { hDmg += (aDmg - victim.armor); victim.armor = 0; }
    else victim.armor -= aDmg;
  }
  victim.hp -= hDmg;
  send(victim.ws, { t: 'damage', dmg: hDmg, armor: victim.armor, hp: victim.hp, fromId: killer?.id ?? null, kind });
  broadcast({ t: 'player_hit', id: victim.id, hp: victim.hp, armor: victim.armor }, victim);

  if (victim.hp <= 0) {
    // Environmental kill in co-op → go down if a teammate is up, else final death.
    if (matchMode === 'zombies') {
      if (joinedPlayers().some(p => p !== victim && p.alive && !p.down)) downPlayer(victim, killer?.name ?? 'the infected');
      else killPlayerFinal(victim, killer?.name ?? 'the infected', kind);
      return;
    }
    victim.alive = false;
    victim.deaths++;
    if (killer) killer.kills++;
    const hs = kind === 'head';
    broadcast({
      t: 'kill',
      killerId: killer?.id ?? null,
      killerName: killer?.name ?? 'World',
      victimId: victim.id,
      victimName: victim.name,
      weapon: killer?.lastWeapon ?? 'ak',
      hs,
      kills: killer?.kills ?? 0,
    });
    send(victim.ws, { t: 'you_died', killerId: killer?.id ?? null, killerName: killer?.name ?? 'World', weapon: killer?.lastWeapon ?? null });
    if (killer && killer.kills >= FRAG_LIMIT) endMatch('frag');
    setTimeout(() => {
      if (!players.has(victim.id)) return;
      const sp = pickSpawn(victim.id);
      victim.x = sp.x; victim.y = sp.y; victim.z = sp.z;
      victim.hp = 100; victim.armor = 100; victim.alive = true;
      victim.yaw = Math.PI; victim.pitch = 0;
      send(victim.ws, { t: 'respawn', x: sp.x, y: sp.y, z: sp.z });
      broadcast({ t: 'player_respawn', id: victim.id, x: sp.x, y: sp.y, z: sp.z });
    }, 3200);
  }
}

// In co-op, no one is "up" to revive — match wipes when all are dead or downed.
function everyoneIncapacitated() {
  return joinedPlayers().every(p => !p.alive || p.down);
}

function downPlayer(victim, byName) {
  victim.down = true;
  victim.hp = 1;
  victim.downedT = BLEEDOUT;
  victim.reviverId = null;
  victim.reviveProg = 0;
  broadcast({ t: 'player_down', id: victim.id, name: victim.name });
  send(victim.ws, { t: 'you_downed', bleedout: BLEEDOUT, by: byName });
}

function killPlayerFinal(victim, byName, kind = 'claws') {
  if (!victim.alive) return;
  victim.alive = false;
  victim.down = false;
  victim.reviverId = null;
  victim.deaths++;
  broadcast({ t: 'kill', killerId: null, killerName: byName, victimId: victim.id, victimName: victim.name, weapon: kind === 'acid' ? 'fall' : 'knife', hs: false, kills: 0 });
  send(victim.ws, { t: 'you_died', killerId: null, killerName: byName, weapon: kind === 'acid' ? 'acid' : 'claws' });
  if (everyoneIncapacitated()) endZombieMatch('overrun');
}

// Advance revives in progress and bleed out the unrevived.
function reviveTick(dt) {
  const now = Date.now();
  for (const v of joinedPlayers()) {
    if (!v.alive || !v.down) continue;
    const reviver = v.reviverId != null ? players.get(v.reviverId) : null;
    const active = reviver && reviver.alive && !reviver.down && (now - (v.reviveMsgT || 0) < 450) &&
      Math.hypot(reviver.x - v.x, reviver.z - v.z) < REVIVE_RADIUS + 30 && Math.abs(reviver.y - v.y) < 150;
    if (active) {
      v.reviveProg += dt; // bleed-out pauses while being revived
      if (v.reviveProg >= REVIVE_TIME) {
        v.down = false; v.hp = REVIVE_HP; v.downedT = 0; v.reviverId = null; v.reviveProg = 0;
        broadcast({ t: 'player_revived', id: v.id, hp: v.hp });
        continue;
      }
      broadcast({ t: 'revive_progress', id: v.id, prog: v.reviveProg / REVIVE_TIME });
    } else {
      if (v.reviverId != null) v.reviverId = null;
      if (v.reviveProg > 0) { v.reviveProg = Math.max(0, v.reviveProg - dt * 2); broadcast({ t: 'revive_progress', id: v.id, prog: v.reviveProg / REVIVE_TIME }); }
      v.downedT -= dt;
      if (v.downedT <= 0) killPlayerFinal(v, 'Bleeding out', 'claws');
    }
  }
}

function applyZombieDamage(victim, zombie, dmg, kind = 'claws') {
  if (!victim.alive) return;
  if (victim.down) { victim.downedT = Math.max(0, victim.downedT - 3.5); return; } // extra hits hasten bleed-out
  if (victim.hp <= 0) return;
  let hDmg = dmg;
  if (victim.armor > 0) {
    hDmg = dmg * 0.78;
    const aDmg = (dmg - hDmg) * 0.8;
    if (aDmg > victim.armor) { hDmg += (aDmg - victim.armor); victim.armor = 0; }
    else victim.armor -= aDmg;
  }
  victim.hp -= hDmg;
  send(victim.ws, {
    t: 'damage', dmg: hDmg, armor: victim.armor, hp: victim.hp,
    fromId: null, fromZombie: zombie.id, fromPos: [zombie.x, zombie.y, zombie.z], kind,
  });
  broadcast({ t: 'player_hit', id: victim.id, hp: victim.hp, armor: victim.armor }, victim);

  if (victim.hp <= 0) {
    // Go down (revivable) if a teammate is still up; otherwise it's a real death.
    if (joinedPlayers().some(p => p !== victim && p.alive && !p.down)) downPlayer(victim, zombie.name);
    else killPlayerFinal(victim, zombie.name, kind);
  }
}

// A bomber detonates when it dies or reaches a player — splash damage to humans.
function bomberExplode(z) {
  broadcast({ t: 'fx_explode', kind: 'frag', pos: [z.x, z.y + 22, z.z] });
  for (const v of joinedPlayers()) {
    if (!v.alive) continue;
    const d = Math.hypot(v.x - z.x, (v.y + 32) - (z.y + 22), v.z - z.z);
    if (d < BOMBER_RADIUS) applyDamage(v, BOMBER_DMG * (1 - d / BOMBER_RADIUS), null, 'fall', 1);
  }
}

function killZombie(z, killer) {
  if (!z.alive) return;
  z.alive = false;
  z.hp = 0;
  zombies.delete(z.id);
  const def = ZOMBIE_TYPES[z.type];
  if (killer) {
    killer.kills += def.score;
    killer.points = (killer.points || 0) + def.score * ZOMBIE_KILL_MUL;
  }
  broadcast({
    t: 'zombie_kill',
    id: z.id,
    killerId: killer?.id ?? null,
    killerName: killer?.name ?? 'World',
    type: z.type,
    name: z.name,
    kills: killer?.kills ?? 0,
    points: killer?.points ?? 0,
    zombieState: publicZombieState(),
  });
  if (z.type === 'bomber') bomberExplode(z);
  if (Math.random() < LOOT_CHANCE) spawnLoot(z.x, z.y, z.z);
}

function applyZombieHit(shooter, targetId, dmg, part = 'body') {
  if (matchMode !== 'zombies' || !shooter?.alive) return;
  const z = zombies.get(targetId);
  if (!z || !z.alive) return;
  const dist = Math.hypot(z.x - shooter.x, (z.y + 38) - (shooter.y + 64), z.z - shooter.z);
  if (dist > 4300) return;
  const mult = part === 'head' ? 1.65 : part === 'leg' ? 0.75 : 1;
  z.hp -= Math.max(1, (dmg ?? 30) * mult);
  shooter.points = (shooter.points || 0) + ZOMBIE_HIT_POINTS; // cash for landing shots
  if (z.hp <= 0) killZombie(z, shooter);
  else broadcast({ t: 'zombie_hit', id: z.id, hp: z.hp, zombieState: publicZombieState() });
}

// Frag grenade splash against the horde.
function fragZombies(pos, shooter) {
  for (const z of [...zombies.values()]) {
    if (!z.alive) continue;
    const d = Math.hypot(z.x - pos.x, (z.y + 38) - pos.y, z.z - pos.z);
    if (d >= FRAG_RADIUS) continue;
    z.hp -= FRAG_DMG * (1 - d / FRAG_RADIUS);
    if (z.hp <= 0) killZombie(z, shooter);
    else broadcast({ t: 'zombie_hit', id: z.id, hp: z.hp, zombieState: publicZombieState() });
  }
}

// Molotov fire: damage zombies (+ players, per mode) standing in a burning zone.
function tickFireZones(dt) {
  for (let i = fireZones.length - 1; i >= 0; i--) {
    const f = fireZones[i];
    f.ttl -= dt;
    if (f.ttl <= 0) { fireZones.splice(i, 1); continue; }
    f.acc += dt;
    if (f.acc < 0.4) continue;
    const dmg = f.dps * f.acc;
    f.acc = 0;
    for (const z of [...zombies.values()]) {
      if (!z.alive) continue;
      if (Math.hypot(z.x - f.x, z.z - f.z) < f.radius && Math.abs(z.y - f.y) < 130) {
        z.hp -= dmg;
        const owner = players.get(f.ownerId);
        if (z.hp <= 0) killZombie(z, owner && owner.alive ? owner : null);
        else broadcast({ t: 'zombie_hit', id: z.id, hp: z.hp, zombieState: publicZombieState() });
      }
    }
    for (const v of joinedPlayers()) {
      if (!v.alive) continue;
      if (matchMode === 'zombies' && v.id !== f.ownerId) continue; // no friendly fire in co-op
      if (Math.hypot(v.x - f.x, v.z - f.z) < f.radius && Math.abs(v.y - f.y) < 140) {
        const owner = players.get(f.ownerId);
        applyDamage(v, dmg, (matchMode !== 'zombies' && owner && owner.id !== v.id) ? owner : null, 'fall', 1);
      }
    }
  }
}

// Floor loot — ammo crates that drop where zombies die and despawn after a while.
function spawnLoot(x, y, z) {
  if (lootItems.length >= LOOT_MAX) return;
  const loot = { id: nextLootId++, x, y, z, ttl: LOOT_TTL };
  lootItems.push(loot);
  broadcast({ t: 'loot_spawn', loot: { id: loot.id, x, y, z } });
}

function tickLoot(dt) {
  for (let i = lootItems.length - 1; i >= 0; i--) {
    const l = lootItems[i];
    l.ttl -= dt;
    if (l.ttl <= 0) { lootItems.splice(i, 1); broadcast({ t: 'loot_taken', id: l.id }); }
  }
}

function publicBarricades() {
  return barricades.map(b => ({ id: b.id, hp: Math.round(b.hp), max: BARRICADE_HP }));
}

// Standing barricades get torn down by adjacent zombies and rebuilt by repairing players.
function tickBarricades(dt) {
  const now = Date.now();
  for (const b of barricades) {
    const cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2;
    const before = b.hp;
    if (b.hp > 0) {
      let attackers = 0;
      for (const z of zombies.values()) {
        if (z.alive && z.y < 150 && Math.hypot(z.x - cx, z.z - cz) < BARRICADE_RADIUS + 14) attackers++;
      }
      if (attackers) b.hp = Math.max(0, b.hp - attackers * BARRICADE_ATTACK * dt);
      if (b.hp <= 0) broadcast({ t: 'barricade_down', id: b.id });
    }
    if (now - b.repairT < 400 && b.hp < BARRICADE_HP) {
      const wasDown = b.hp <= 0;
      b.hp = Math.min(BARRICADE_HP, b.hp + REPAIR_RATE * dt);
      if (wasDown && b.hp > 0) broadcast({ t: 'barricade_up', id: b.id });
    }
    if (Math.abs(b.hp - before) > 0.5) broadcast({ t: 'barricade_hp', id: b.id, hp: Math.round(b.hp) });
  }
}

function validateHit(shooter, targetId, maxDist = 4200) {
  const target = players.get(targetId);
  if (!target || !shooter || shooter.id === targetId) return null;
  if (!target.alive || !shooter.alive) return null;
  const dx = target.x - shooter.x;
  const dy = (target.y + 64) - (shooter.y + 64);
  const dz = target.z - shooter.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist > maxDist) return null;
  return target;
}

// Pick a victim for one zombie. Favours the nearest human, but spreads the horde
// across multiple players so a co-op squad doesn't get everyone dogpiled on one.
function pickZombieTarget(z) {
  const humans = joinedPlayers().filter(p => p.alive && !p.down);
  if (!humans.length) return null;
  if (humans.length === 1) return humans[0];
  const counts = new Map();
  for (const o of zombies.values()) {
    if (o.alive && o.targetId != null) counts.set(o.targetId, (counts.get(o.targetId) || 0) + 1);
  }
  let best = null, bestScore = Infinity;
  for (const h of humans) {
    const d = Math.hypot(h.x - z.x, h.z - z.z);
    const score = d * (1 + 0.12 * (counts.get(h.id) || 0)) * (0.85 + Math.random() * 0.3);
    if (score < bestScore) { bestScore = score; best = h; }
  }
  return best;
}

function updateZombies(dt) {
  if (zombiePhase === 'intermission') {
    zombieIntermissionLeft -= dt;
    if (zombieIntermissionLeft <= 0) startZombieRound();
    return;
  }
  if (zombiePhase !== 'spawning' && zombiePhase !== 'fighting') return;

  const humans = joinedPlayers();
  if (!humans.length) return;
  if (everyoneIncapacitated()) {
    endZombieMatch('overrun');
    return;
  }

  const maxActive = Math.min(36, 8 + zombieRound * 2 + humans.length * 2);
  zombieSpawnAcc += dt;
  while (zombiesToSpawn > 0 && zombies.size < maxActive && zombieSpawnAcc >= 0.55) {
    zombieSpawnAcc -= 0.55;
    zombiesToSpawn--;
    spawnZombie();
  }
  if (zombiesToSpawn <= 0) zombiePhase = 'fighting';

  const zlist = [...zombies.values()];
  for (const z of zlist) {
    if (!z.alive) continue;
    const def = ZOMBIE_TYPES[z.type];

    // (Re)acquire a target with stickiness so they don't jitter between players.
    z.retargetCd -= dt;
    let target = z.targetId != null ? players.get(z.targetId) : null;
    if (!target || !target.alive || target.down || !target.joined || z.retargetCd <= 0) {
      target = pickZombieTarget(z);
      z.targetId = target ? target.id : null;
      z.retargetCd = 0.7 + Math.random() * 0.8;
    }
    if (!target) continue;

    // Necromancers raise extra shamblers around themselves on a cooldown.
    if (def.summons) {
      z.summonCd -= dt;
      if (z.summonCd <= 0 && zombies.size < maxActive) {
        z.summonCd = 5.5 + Math.random() * 3;
        const n = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let s = 0; s < n && zombies.size < maxActive; s++) {
          const a = Math.random() * Math.PI * 2;
          makeZombie('shambler', z.x + Math.cos(a) * 55, z.z + Math.sin(a) * 55);
        }
      }
    }

    z.attackCd -= dt;
    const rdx = target.x - z.x, rdz = target.z - z.z;
    const rdist = Math.max(1, Math.hypot(rdx, rdz));
    const dy = target.y - z.y;

    // When the target is on another floor, route over the staircase instead of
    // walking straight at them and getting stuck under/over the slab.
    const onRamp = z.x > STAIR.x1 - 24 && z.x < STAIR.x2 + 24 && z.z > STAIR.zTop && z.z < STAIR.zBot + 36;
    const climbUp = dy > 15 && z.y < 190;   // keep routing to the top until fully on the slab
    const climbDown = dy < -15 && z.y > 25;
    const climbing = climbUp || climbDown;
    let gx = target.x, gz = target.z;
    if (climbUp) {
      // Reach the foot of the stairs, then drive to the top — never send a
      // half-climbed zombie back down (that caused it to walk off the side).
      const mounted = z.y > 15 || onRamp || Math.hypot(z.x - STAIR.baseX, z.z - STAIR.baseZ) < 130;
      gx = mounted ? STAIR.topX : STAIR.baseX;
      gz = mounted ? STAIR.topZ : STAIR.baseZ;
    } else if (climbDown) {
      gx = STAIR.baseX; gz = STAIR.baseZ; // walk back down the ramp to ground
    }
    const gdx = gx - z.x, gdz = gz - z.z;
    const gdist = Math.max(1, Math.hypot(gdx, gdz));
    const nx = gdx / gdist, nz = gdz / gdist;

    // Arc the approach so the horde fans out and encircles; the curve straightens
    // out as it closes in.
    const curve = z.surroundAngle * Math.min(1, gdist / 700);
    const cs = Math.cos(curve), sn = Math.sin(curve);
    let mx = nx * cs - nz * sn;
    let mz = nx * sn + nz * cs;

    // Runners weave from side to side; brutes (small angle) march straight.
    if (z.type === 'runner') {
      z.strafePhase += dt * 3.6;
      const s = Math.sin(z.strafePhase) * 0.5 * z.strafeDir;
      mx += -mz * s; mz += nx * s;
      const l = Math.hypot(mx, mz) || 1; mx /= l; mz /= l;
    }

    // Separation: steer away from crowding neighbours so the pack spreads around
    // the target instead of stacking into a single point.
    let sepX = 0, sepZ = 0;
    for (const o of zlist) {
      if (o === z || !o.alive) continue;
      const ox = z.x - o.x, oz = z.z - o.z;
      const d2 = ox * ox + oz * oz;
      if (d2 > 0.01 && d2 < 78 * 78) {
        const d = Math.sqrt(d2);
        const f = (78 - d) / 78 / d; // unit-away * closeness
        sepX += ox * f; sepZ += oz * f;
      }
    }
    const sepW = z.type === 'brute' ? 0.3 : z.type === 'spitter' ? 1.0 : 0.8;
    mx += sepX * sepW; mz += sepZ * sepW;
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;

    // Face the heading while routing to the stairs, else face the victim.
    z.yaw = climbing ? Math.atan2(-mx, -mz) : Math.atan2(-rdx, -rdz);

    // Decide whether to advance. Spitters hold a firing range; while climbing,
    // push toward the stair anchor until reached.
    let move;
    if (climbing) {
      move = gdist > 26 ? 1 : 0;
    } else if (z.type === 'spitter' || z.type === 'summoner') {
      if (rdist > def.attackRange * 0.92) move = 1;
      else if (rdist < def.attackRange * 0.55) move = -0.85;
      else move = 0;
    } else {
      move = rdist > def.attackRange * 0.85 ? 1 : 0;
    }

    const ox = z.x, oz = z.z;
    if (move !== 0) {
      const nearSlow = (move > 0 && !climbing && rdist < 130) ? 0.5 : 1;
      z.x += mx * def.speed * move * nearSlow * dt;
      z.z += mz * def.speed * move * nearSlow * dt;
    } else {
      // Holding (in-range / spitter standoff): still drift apart gently.
      z.x += sepX * 30 * dt;
      z.z += sepZ * 30 * dt;
    }

    z.x = Math.max(-1540, Math.min(1540, z.x));
    z.z = Math.max(-1140, Math.min(1140, z.z));
    resolveBlocked(z);

    // Wall-follow: if a wall cancelled most of our advance, slide along it toward
    // the goal so the horde funnels through doorways instead of pressing the wall.
    if (move > 0) {
      const advance = (z.x - ox) * mx + (z.z - oz) * mz;
      if (advance < def.speed * move * dt * 0.35) {
        const toGx = gx - z.x, toGz = gz - z.z;
        const useLeft = (-mz * toGx + mx * toGz) >= 0;
        const tx = useLeft ? -mz : mz, tz = useLeft ? mx : -mx;
        z.x += tx * def.speed * 0.75 * dt;
        z.z += tz * def.speed * 0.75 * dt;
        z.x = Math.max(-1540, Math.min(1540, z.x));
        z.z = Math.max(-1140, Math.min(1140, z.z));
        resolveBlocked(z);
      }
    }

    // Adopt the floor height beneath us — climb the staircase, stand on the slab.
    // Clamp so a tall step is walked up over a few ticks, never teleported onto.
    const fy = outpostFloorY(z.x, z.z, z.y);
    z.y += Math.max(-32, Math.min(10, fy - z.y));

    // Only bite when actually next to the victim and on the same level.
    if (!climbing && rdist <= def.attackRange && Math.abs(dy) < 90 && z.attackCd <= 0) {
      if (def.explodes) { killZombie(z, null); continue; } // bomber detonates on contact
      z.attackCd = def.attackCd;
      const ranged = z.type === 'spitter' || z.type === 'summoner';
      applyZombieDamage(target, z, def.damage + zombieRound * 1.2, ranged ? 'acid' : 'claws');
      broadcast({ t: 'zombie_attack', id: z.id, targetId: target.id, kind: ranged ? 'acid' : 'claws' });
    }
  }

  if (zombiesToSpawn <= 0 && zombies.size === 0 && zombiePhase !== 'intermission') {
    zombiePhase = 'intermission';
    zombieIntermissionLeft = 7;
    broadcast({ t: 'zombie_round_clear', zombieState: publicZombieState(), players: joinedPlayers().map(publicPlayer) });
  }
}

function handleMessage(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }
  const p = [...players.values()].find(x => x.ws === ws);
  if (!p) return;

  switch (msg.t) {
    case 'join': {
      const name = String(msg.name || 'Player').slice(0, 20).trim() || 'Player';
      const requestedMode = msg.mode === 'zombies' ? 'zombies' : 'deathmatch';
      const activePlayers = joinedPlayers();
      if (matchActive && activePlayers.length > 0 && matchMode !== requestedMode) {
        send(ws, { t: 'error', msg: `Server is running ${matchMode}. Try again when that match ends.` });
        ws.close();
        return;
      }
      if (!matchActive && activePlayers.length === 0) {
        matchMode = requestedMode;
        if (requestedMode === 'zombies') resetZombieState();
      } else {
        matchMode = activePlayers[0]?.mode || requestedMode;
      }
      p.name = name;
      p.mode = matchMode;
      p.joined = true;
      p.ping = 0;
      const sp = pickSpawn(p.id);
      p.x = sp.x; p.y = sp.y; p.z = sp.z;
      send(ws, {
        t: 'welcome',
        id: p.id,
        mode: matchMode,
        you: publicPlayer(p),
        players: [...players.values()].filter(x => x.joined && x.id !== p.id).map(publicPlayer),
        matchActive,
        timeLeft: matchTimeLeft,
        zombies: matchMode === 'zombies' ? [...zombies.values()].map(publicZombie) : [],
        zombieState: matchMode === 'zombies' ? publicZombieState() : null,
        loot: matchMode === 'zombies' ? lootItems.map(l => ({ id: l.id, x: l.x, y: l.y, z: l.z })) : [],
        barricades: matchMode === 'zombies' ? publicBarricades() : [],
        mapVariant,
      });
      broadcast({ t: 'player_join', mode: matchMode, player: publicPlayer(p) }, p);
      startMatchIfNeeded();
      break;
    }
    case 'state': {
      if (p.alive) {
        p.x = boundedPosition(msg.x, p.x);
        p.y = boundedPosition(msg.y, p.y);
        p.z = boundedPosition(msg.z, p.z);
      }
      p.yaw = finiteOr(msg.yaw, p.yaw);
      p.pitch = finiteOr(msg.pitch, p.pitch);
      p.weapon = String(msg.weapon || p.weapon).slice(0, 24);
      p.lastWeapon = p.weapon;
      if (msg.ping != null) p.ping = Math.max(0, Math.min(999, finiteOr(msg.ping, p.ping)));
      break;
    }
    case 'fire': {
      p.lastWeapon = msg.weapon ?? p.weapon;
      broadcast({ t: 'fire', fromId: p.id, origin: msg.origin, dir: msg.dir, weapon: msg.weapon, muzzle: msg.muzzle }, p);
      break;
    }
    case 'hit': {
      if (matchMode === 'zombies') return;
      const target = validateHit(p, msg.targetId);
      if (!target) return;
      applyDamage(target, msg.dmg ?? 30, p, msg.part === 'head' ? 'head' : 'body', msg.armorPen ?? 0.6);
      break;
    }
    case 'zombie_hit': {
      applyZombieHit(p, msg.targetId, msg.dmg ?? 30, msg.part);
      break;
    }
    case 'melee': {
      if (matchMode === 'zombies') {
        applyZombieHit(p, msg.targetId, msg.dmg ?? 40, msg.part);
        return;
      }
      const target = validateHit(p, msg.targetId, 120);
      if (!target) return;
      const hs = msg.part === 'head';
      applyDamage(target, (msg.dmg ?? 40) * (hs ? 1.5 : 1), p, hs ? 'head' : 'body', 1);
      break;
    }
    case 'grenade': {
      if (!p.alive) return;
      const px = boundedPosition(msg.pos?.[0], p.x);
      const py = finiteOr(msg.pos?.[1], p.y + 40);
      const pz = boundedPosition(msg.pos?.[2], p.z);
      if (Math.hypot(px - p.x, pz - p.z) > 3000) return; // sanity: near the thrower
      if (msg.kind === 'molotov') {
        fireZones.push({ x: px, y: py, z: pz, radius: MOLOTOV_RADIUS, ttl: MOLOTOV_DUR, dps: MOLOTOV_DPS, ownerId: p.id, acc: 0 });
        broadcast({ t: 'fx_fire', pos: [px, py, pz], dur: MOLOTOV_DUR }, p);
      } else {
        if (matchMode === 'zombies') {
          fragZombies({ x: px, y: py, z: pz }, p);
          const ds = Math.hypot(px - p.x, (p.y + 32) - py, pz - p.z);
          if (ds < FRAG_RADIUS) applyDamage(p, FRAG_DMG * (1 - ds / FRAG_RADIUS) * 0.7, null, 'fall', 1);
        } else {
          for (const v of joinedPlayers()) {
            if (!v.alive) continue;
            const d = Math.hypot(v.x - px, (v.y + 32) - py, v.z - pz);
            if (d < FRAG_RADIUS) applyDamage(v, FRAG_DMG * (1 - d / FRAG_RADIUS), v.id === p.id ? null : p, 'body', 0.5);
          }
        }
        broadcast({ t: 'fx_explode', kind: 'frag', pos: [px, py, pz] }, p);
      }
      break;
    }
    case 'buy': {
      if (matchMode !== 'zombies' || !p.alive || p.down) return;
      const spot = BUY_SPOTS.find(s => s.id === msg.spot);
      if (!spot) return;
      if (Math.hypot(p.x - spot.x, p.z - spot.z) > BUY_RADIUS + 35 || Math.abs(p.y - spot.y) > BUY_Y_TOLERANCE + 35) return;
      const ammoBuy = !!msg.ammo && spot.kind === 'wall' && spot.refill;
      const cost = ammoBuy ? spot.refill : spot.price;
      if ((p.points || 0) < cost) { send(ws, { t: 'buy_fail', points: p.points || 0 }); break; }
      p.points -= cost;
      if (ammoBuy) {
        send(ws, { t: 'buy_ok', item: spot.item, points: p.points, spot: spot.id, label: spot.label, ammoOnly: true });
      } else {
        let item = spot.item;
        if (item === 'box') item = BOX_POOL[Math.floor(Math.random() * BOX_POOL.length)];
        send(ws, { t: 'buy_ok', item, points: p.points, spot: spot.id, label: spot.label });
      }
      break;
    }
    case 'repair': {
      if (matchMode !== 'zombies' || !p.alive || p.down) return;
      const b = barricades.find(x => x.id === msg.id);
      if (!b || b.hp >= BARRICADE_HP) return;
      const cx = (b.x1 + b.x2) / 2, cz = (b.z1 + b.z2) / 2;
      if (Math.hypot(p.x - cx, p.z - cz) > BARRICADE_RADIUS + 55 || p.y > 150) return;
      b.repairT = Date.now();
      break;
    }
    case 'revive': {
      if (matchMode !== 'zombies' || !p.alive || p.down) return; // downed players can't revive
      const target = players.get(msg.id);
      if (!target || !target.down || !target.alive) return;
      if (Math.hypot(p.x - target.x, p.z - target.z) > REVIVE_RADIUS + 25 || Math.abs(p.y - target.y) > 140) return;
      target.reviverId = p.id;
      target.reviveMsgT = Date.now();
      break;
    }
    case 'loot_get': {
      if (matchMode !== 'zombies' || !p.alive) return;
      const idx = lootItems.findIndex(l => l.id === msg.id);
      if (idx < 0) return;
      const l = lootItems[idx];
      if (Math.hypot(p.x - l.x, p.z - l.z) > LOOT_RADIUS + 30 || Math.abs(p.y - l.y) > 140) return;
      lootItems.splice(idx, 1);
      broadcast({ t: 'loot_taken', id: l.id });
      send(ws, { t: 'loot_grant', kind: 'ammo' });
      break;
    }
    case 'ping': {
      send(ws, { t: 'pong', ts: msg.ts });
      break;
    }
    default:
      break;
  }
}

function gameTick() {
  if (!matchActive) return;
  tickFireZones(TICK_MS / 1000);
  tickLoot(TICK_MS / 1000);
  if (matchMode === 'zombies') {
    reviveTick(TICK_MS / 1000);
    tickBarricades(TICK_MS / 1000);
    updateZombies(TICK_MS / 1000);
    broadcast({
      t: 'snapshot',
      mode: 'zombies',
      timeLeft: 0,
      players: joinedPlayers().map(publicPlayer),
      zombies: [...zombies.values()].map(publicZombie),
      zombieState: publicZombieState(),
    });
    return;
  }
  matchTimeLeft -= TICK_MS / 1000;
  if (matchTimeLeft <= 0) {
    endMatch('time');
    return;
  }
  broadcast({
    t: 'snapshot',
    mode: 'deathmatch',
    timeLeft: matchTimeLeft,
    players: joinedPlayers().map(publicPlayer),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      res.end('method not allowed');
      return;
    }
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/') path = '/index.html';
    // Only public game assets are served; project files stay private.
    if (path.includes('\\') || path.includes('\0')) throw new Error('forbidden');
    const segments = path.split('/').filter(Boolean);
    if (segments.some(part => part.startsWith('.'))) throw new Error('forbidden');
    const publicAsset = path === '/index.html'
      || (/^\/src\/.+\.js$/.test(path))
      || path === '/lib/three.module.min.js'
      || (/^\/assets\/audio\/.+\.mp3$/.test(path));
    if (!publicAsset) throw new Error('forbidden');
    const file = resolve(ROOT, '.' + path);
    const withinRoot = relative(ROOT, file);
    if (isAbsolute(withinRoot) || withinRoot === '..' || withinRoot.startsWith('..' + sep)) {
      throw new Error('forbidden');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  if (players.size >= MAX_PLAYERS) {
    send(ws, { t: 'error', msg: 'Server full (max 8 players)' });
    ws.close();
    return;
  }
  const id = nextId++;
  const player = {
    id, name: 'Connecting…', ws, joined: false, mode: 'deathmatch',
    x: 0, y: 1, z: 0, yaw: 0, pitch: 0,
    hp: 100, armor: 100, alive: true,
    kills: 0, deaths: 0, weapon: 'ak', lastWeapon: 'ak', ping: 0, points: 0,
    down: false, downedT: 0, reviverId: null, reviveProg: 0, reviveMsgT: 0,
  };
  players.set(id, player);

  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('close', () => removePlayer(id));
  ws.on('error', () => removePlayer(id));
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function start() {
  const startPort = PORT_ENV || DEFAULT_PORT;
  let port = startPort;

  for (let attempt = 0; attempt < MAX_PORT_TRIES; attempt++) {
    try {
      port = await listen(startPort + attempt);
      break;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') throw err;

      const tried = startPort + attempt;
      if (PORT_ENV) {
        console.error(`\nPort ${tried} is already in use.`);
        console.error('Another DUST PROTOCOL server may already be running.');
        console.error(`Open http://localhost:${tried} or stop the other process:\n`);
        console.error(`  netstat -ano | findstr :${tried}`);
        console.error(`  taskkill /PID <PID> /F\n`);
        process.exit(1);
      }

      if (attempt === 0) {
        console.warn(`Port ${tried} is already in use — trying the next port…`);
        console.warn(`(If the game is already running, open http://localhost:${tried})\n`);
      }

      if (attempt === MAX_PORT_TRIES - 1) {
        console.error(`No free port found between ${startPort} and ${startPort + MAX_PORT_TRIES - 1}.`);
        process.exit(1);
      }
    }
  }

  if (port !== startPort) {
    console.log(`Started on port ${port} instead of ${startPort}.`);
  }
  console.log(`DUST PROTOCOL running at http://localhost:${port}`);
  console.log(`Multiplayer WebSocket on ws://localhost:${port}`);
  ensureTickTimer();
}

start().catch((err) => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
