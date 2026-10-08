// DUST PROTOCOL — CS2-style deathmatch vs bots.
// Glues renderer, world, player movement, weapons, bots, HUD and match flow.
import * as THREE from 'three';
import { clamp, rayAABB } from './utils.js';
import { AudioSys } from './audio.js';
import { buildWorld } from './world.js';
import { Effects } from './effects.js';
import { WEAPONS, Arsenal } from './weapons.js';
import { BotManager } from './bots.js';
import { PlayerController } from './player.js';
import { HUD } from './hud.js';
import { RemotePlayerManager } from './remotePlayers.js';
import { NetworkClient } from './network.js';
import { ZombieManager } from './zombies.js';
import { GrenadeManager } from './grenades.js';
import { LootManager } from './loot.js';
import { BUY_SPOTS, BUY_RADIUS, BUY_Y_TOLERANCE } from './buyspots.js';
import { BARRICADES, BARRICADE_HP, BARRICADE_RADIUS } from './barricades.js';

const qs = new URLSearchParams(location.search);
const TEST = qs.has('test');
const FREEZE = qs.has('freeze');

const DEFAULTS = {
  sens: 1.0, vol: 0.7, fov: 75,
  xhColor: '#3aff3a', xhSize: 8, xhGap: 5, xhThick: 2, xhDot: false,
  diff: 'normal', bots: 6,
};
function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('dustproto') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

const MATCH_TIME = 600;
const FRAG_LIMIT = 30;
const MENU_MUSIC = './assets/audio/Hardwired_Combat.mp3';
const ZOMBIE_MENU_MUSIC = './assets/audio/Weight_of_the_Stone.mp3';
const DEFAULT_MENU_SUB = 'A CS2-style browser FPS \u00b7 de_dustette';
const ZOMBIE_MENU_SUB = 'Zombie survival co-op \u00b7 escalating infected waves';
const DEFAULT_MENU_FOOT = [
  'First to 30 kills or best score in 10:00 wins.',
  'Online: up to 8 players on the same server &middot; share the link with friends.',
  'Zombie Co-op: survive escalating rounds with friends against stronger infected.',
  'Fan-made tribute &middot; three.js &middot; every texture, model &amp; sound is generated in code.',
].join('<br>');
const ZOMBIE_MENU_FOOT = [
  'Zombie Co-op: survive escalating rounds with friends on this server.',
  'Each round adds more infected, tougher variants, and less room for mistakes.',
  'Start the mode, invite a friend to the same URL, and hold the line together.',
].join('<br>');

class Game {
  constructor() {
    this.settings = loadSettings();
    this.canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, innerWidth / innerHeight, 1, 30000);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.audio = new AudioSys();
    this.audio.setMenuMusic(MENU_MUSIC);
    this.audio.setVolume(this.settings.vol);
    this.world = buildWorld(this.scene, this.renderer);
    this.effects = new Effects(this.scene);
    this.player = new PlayerController(this);
    this.bots = new BotManager(this);
    this.remotes = new RemotePlayerManager(this);
    this.zombies = new ZombieManager(this);
    this.grenades = new GrenadeManager(this);
    this.loot = new LootManager(this);
    this.net = new NetworkClient(this);
    this.hud = new HUD(this);
    this.online = false;
    this.matchMode = 'deathmatch';
    this.pendingOnlineMode = 'deathmatch';
    this.menuTheme = 'default';
    this.zombieState = null;
    this.arsenal = new Arsenal(this);
    this.hud.applyCrosshair(this.settings);
    this.hud.refreshAmmo();

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = 8192;

    this.state = 'menu'; // menu | playing | paused | dead | end
    this.time = 0;
    this.timeLeft = MATCH_TIME;
    this.score = 0;
    this.deaths = 0;
    this.hp = 100;
    this.armor = 0;
    this.invulnT = 0;
    this.deathT = 0;
    this.zoomScale = 1;
    this.menuYaw = 0;
    this.targetCheckT = 0;
    this.suppressPause = false;
    this.nades = { frag: 2, molotov: 1 };
    this.nadeCd = 0;
    this.points = 0;
    this.activeBuySpot = null;
    this.buyIsAmmo = false;
    this.downed = false;
    this.downBleed = 0;
    this.reviveTarget = null;
    this.reviving = false;
    this.reviveProgById = {};
    this.repairTarget = null;
    this.repairing = false;
    this.buildBuyMarkers();
    this.buildBarricades();

    this.input = {
      keys: new Set(),
      fireHeld: false, fireClicked: false, altClicked: false,
      jumpPressed: false, lookDX: 0, lookDY: 0,
    };

    this.bindInput();
    this.bindMenus();
    this.applySettingsToUI();
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
    window.__game = this; // debug handle

    if (TEST) {
      this.audio.init = () => {}; // no gesture in test mode
      this.audio.play = () => {};
      this.startMatch();
    }
  }

  get playerAlive() { return this.state === 'playing' || this.state === 'paused'; }

  // ---------------- input ----------------
  get lookSens() {
    return 0.0022 * this.settings.sens * (this.zoomScale < 1 ? this.zoomScale * 1.15 : 1);
  }

  bindInput() {
    document.addEventListener('contextmenu', e => e.preventDefault());

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.repeat) return;
      const inGame = this.state === 'playing';

      if (this.hud.buyOpen) {
        if (e.code === 'KeyB' || e.code === 'Escape') this.closeBuy();
        else if (/^Digit[1-9]$/.test(e.code)) this.hud.buyKey(e.code.slice(5));
        return;
      }
      if (!inGame) return;

      this.input.keys.add(e.code);
      switch (e.code) {
        case 'Space': this.input.jumpPressed = true; break;
        case 'KeyR': this.arsenal.reload(); break;
        case 'KeyB': this.openBuy(); break;
        case 'KeyQ': this.arsenal.quickSwitch(); break;
        case 'KeyF': this.arsenal.inspect(); break;
        case 'KeyG': this.throwNade('frag'); break;
        case 'KeyH': this.throwNade('molotov'); break;
        case 'KeyE': this.tryBuy(); break;
        case 'Digit1': this.arsenal.switchSlot(1); break;
        case 'Digit2': this.arsenal.switchSlot(2); break;
        case 'Digit3': this.arsenal.switchSlot(3); break;
        case 'Tab': this.hud.showScoreboard(true); break;
      }
    });
    document.addEventListener('keyup', (e) => {
      this.input.keys.delete(e.code);
      if (e.code === 'Tab') this.hud.showScoreboard(false);
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state === 'playing' && (document.pointerLockElement || TEST)) {
        if (e.button === 0) { this.input.fireHeld = true; this.input.fireClicked = true; }
        if (e.button === 2) this.input.altClicked = true;
      }
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0) this.input.fireHeld = false;
    });
    addEventListener('wheel', (e) => {
      if (this.state === 'playing' && document.pointerLockElement) {
        this.arsenal.cycle(e.deltaY > 0 ? 1 : -1);
      }
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
      const locked = document.pointerLockElement === this.canvas;
      if ((locked || TEST) && (this.state === 'playing')) {
        this.player.look(e.movementX, e.movementY, this.lookSens);
        this.input.lookDX += e.movementX;
        this.input.lookDY += e.movementY;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      if (!locked && this.state === 'playing' && !this.hud.buyOpen && !this.suppressPause && !TEST) {
        this.pause();
      }
    });
    addEventListener('blur', () => {
      this.input.keys.clear();
      this.input.fireHeld = false;
      if (this.state === 'playing' && !TEST) this.pause();
    });
  }

  lockPointer() {
    if (TEST) return;
    this.canvas.requestPointerLock()?.catch?.(() => {});
  }

  // ---------------- menus ----------------
  bindMenus() {
    const $ = (id) => document.getElementById(id);
    const startMenuMusic = () => {
      if (this.state === 'menu') this.audio.startMenuMusic();
    };
    document.addEventListener('pointerdown', startMenuMusic);
    document.addEventListener('keydown', startMenuMusic);

    $('btnPlay').onclick = () => { this.audio.init(); this.audio.setVolume(this.settings.vol); this.startMatch(); };
    $('btnOnline').onclick = () => this.promptOnline('deathmatch');
    $('btnZombies').onclick = () => this.showZombieMenu();
    $('btnZombieStart').onclick = () => this.promptOnline('zombies');
    $('btnZombieBack').onclick = () => this.showDefaultMenu();
    $('btnOnlineCancel').onclick = () => $('onlinePanel').classList.add('hidden');
    $('btnOnlineJoin').onclick = () => this.joinOnline();
    $('onlineName').addEventListener('keydown', (e) => {
      if (e.code === 'Enter') this.joinOnline();
    });
    $('btnHow').onclick = () => $('howPanel').classList.toggle('hidden');
    $('btnSettings').onclick = () => { this.settingsReturn = 'menu'; this.showOverlay('settings'); };
    $('btnSettingsBack').onclick = () => this.showOverlay(this.settingsReturn || 'menu');
    $('btnResume').onclick = () => this.resume();
    $('btnPauseSettings').onclick = () => { this.settingsReturn = 'pause'; this.showOverlay('settings'); };
    $('btnQuit').onclick = () => this.toMenu();
    $('btnAgain').onclick = () => {
      this.audio.init();
      if (this.lastMatchWasOnline) {
        $('onlineName').value = localStorage.getItem('dustproto_name') || $('onlineName').value || 'Player';
        this.pendingOnlineMode = this.matchMode === 'zombies' ? 'zombies' : 'deathmatch';
        this.joinOnline();
      } else {
        this.startMatch();
      }
    };
    $('btnEndMenu').onclick = () => this.toMenu();
  }

  showZombieMenu() {
    this.menuTheme = 'zombies';
    this.world.setMood('zombie');
    document.getElementById('menu').classList.add('zombie-theme');
    document.getElementById('menuSub').textContent = ZOMBIE_MENU_SUB;
    document.getElementById('menuFoot').innerHTML = ZOMBIE_MENU_FOOT;
    document.getElementById('howPanel').classList.add('hidden');
    this.audio.setMenuMusic(ZOMBIE_MENU_MUSIC);
    this.audio.startMenuMusic();
  }

  showDefaultMenu(playMusic = true) {
    this.menuTheme = 'default';
    this.world.setMood('day');
    document.getElementById('menu').classList.remove('zombie-theme');
    document.getElementById('menuSub').textContent = DEFAULT_MENU_SUB;
    document.getElementById('menuFoot').innerHTML = DEFAULT_MENU_FOOT;
    document.getElementById('howPanel').classList.add('hidden');
    this.audio.setMenuMusic(MENU_MUSIC);
    if (playMusic) this.audio.startMenuMusic();
  }

  showOverlay(name) {
    for (const id of ['menu', 'pause', 'settings', 'end']) {
      document.getElementById(id).classList.toggle('hidden', id !== name);
    }
    if (name === 'pause') this.state = 'paused';
  }

  hideOverlays() {
    for (const id of ['menu', 'pause', 'settings', 'end']) {
      document.getElementById(id).classList.add('hidden');
    }
  }

  applySettingsToUI() {
    const s = this.settings, $ = (id) => document.getElementById(id);
    $('sensRange').value = s.sens; $('sensVal').textContent = s.sens.toFixed(2);
    $('volRange').value = s.vol;
    $('fovRange').value = s.fov; $('fovVal').textContent = s.fov;
    $('diffSel').value = s.diff;
    $('botsRange').value = s.bots; $('botsVal').textContent = s.bots;
    $('xhColor').value = s.xhColor;
    $('xhSize').value = s.xhSize; $('xhGap').value = s.xhGap;
    $('xhThick').value = s.xhThick; $('xhDot').checked = s.xhDot;

    const save = () => {
      localStorage.setItem('dustproto', JSON.stringify(s));
      this.hud.applyCrosshair(s);
      this.audio.setVolume(s.vol);
      this.camera.fov = s.fov * this.zoomScale;
      this.camera.updateProjectionMatrix();
    };
    $('sensRange').oninput = () => { s.sens = +$('sensRange').value; $('sensVal').textContent = s.sens.toFixed(2); save(); };
    $('volRange').oninput = () => { s.vol = +$('volRange').value; save(); };
    $('fovRange').oninput = () => { s.fov = +$('fovRange').value; $('fovVal').textContent = s.fov; save(); };
    $('diffSel').onchange = () => { s.diff = $('diffSel').value; save(); };
    $('botsRange').oninput = () => { s.bots = +$('botsRange').value; $('botsVal').textContent = s.bots; save(); };
    $('xhColor').oninput = () => { s.xhColor = $('xhColor').value; save(); };
    $('xhSize').oninput = () => { s.xhSize = +$('xhSize').value; save(); };
    $('xhGap').oninput = () => { s.xhGap = +$('xhGap').value; save(); };
    $('xhThick').oninput = () => { s.xhThick = +$('xhThick').value; save(); };
    $('xhDot').onchange = () => { s.xhDot = $('xhDot').checked; save(); };
  }

  // ---------------- multiplayer ----------------
  promptOnline(mode = 'deathmatch') {
    this.pendingOnlineMode = mode;
    const panel = document.getElementById('onlinePanel');
    const nameEl = document.getElementById('onlineName');
    const title = panel.querySelector('h2');
    const desc = panel.querySelector('p');
    if (title) title.textContent = mode === 'zombies' ? 'ZOMBIE CO-OP' : 'ONLINE DEATHMATCH';
    if (desc) desc.textContent = mode === 'zombies'
      ? 'Survive escalating zombie rounds with friends on this server.'
      : 'Join the shared server. Open the same URL in another browser tab or send the link to a friend.';
    nameEl.value = localStorage.getItem('dustproto_name') || 'Player';
    panel.classList.remove('hidden');
    nameEl.focus();
    nameEl.select();
  }

  async joinOnline() {
    const name = document.getElementById('onlineName').value.trim().slice(0, 20) || 'Player';
    localStorage.setItem('dustproto_name', name);
    document.getElementById('onlineError').textContent = '';
    document.getElementById('onlinePanel').classList.add('hidden');
    document.getElementById('onlineStatus').classList.remove('hidden');
    this.net.onStatus = (t) => { document.getElementById('onlineStatusText').textContent = t; };
    try {
      this.audio.stopMenuMusic();
      this.audio.init();
      this.audio.setVolume(this.settings.vol);
      await this.net.connect(name, this.pendingOnlineMode || 'deathmatch');
      document.getElementById('onlineStatus').classList.add('hidden');
      this.startOnlineMatch();
    } catch (e) {
      document.getElementById('onlineStatus').classList.add('hidden');
      document.getElementById('onlineError').textContent = e.message || 'Could not connect';
      document.getElementById('onlinePanel').classList.remove('hidden');
      this.audio.startMenuMusic();
    }
  }

  disconnectOnline(msg) {
    this.online = false;
    this.matchMode = 'deathmatch';
    this.net.disconnect();
    this.remotes.clear();
    this.zombies.clear();
    this.toMenu();
    if (msg) this.hud.centerMsg(msg, 3);
  }

  startOnlineMatch() {
    if (this.net.mode === 'zombies') {
      this.startZombieOnlineMatch();
      return;
    }
    this.online = true;
    this.lastMatchWasOnline = true;
    this.matchMode = 'deathmatch';
    this.world.setMood('day');
    this.audio.stopMenuMusic();
    this.hideOverlays();
    this.state = 'playing';
    this.score = 0;
    this.deaths = 0;
    this.timeLeft = MATCH_TIME;
    this.hp = 100;
    this.armor = 100;
    this.arsenal.giveDefaultLoadout();
    if (this.net.selfState) {
      this.applyServerPlayerState(this.net.selfState);
    } else {
      this.player.respawn(this.world.spawns[1].clone());
      this.player.yaw = Math.PI;
      this.player.pitch = 0;
    }
    this.bots.spawnAll(0, this.settings.diff);
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
    this.hud.refreshAmmo();
    this.hud.setTimer(this.timeLeft);
    this.hud.setScores(0, 0);
    this.hud.setOnlineMode(true);
    this.hud.hideDeath();
    this.hud.setBuyOpen(false);
    this.refillNades();
    this.setBuyMarkers(false);
    document.getElementById('hud').classList.remove('hidden');
    this.hud.centerMsg('ONLINE DEATHMATCH', 2);
    this.lockPointer();
  }

  startZombieOnlineMatch() {
    this.online = true;
    this.lastMatchWasOnline = true;
    this.matchMode = 'zombies';
    this.world.setMood('zombie');
    this.audio.stopMenuMusic();
    this.hideOverlays();
    this.state = 'playing';
    this.score = this.net.selfState?.kills ?? 0;
    this.deaths = this.net.selfState?.deaths ?? 0;
    this.timeLeft = 0;
    this.hp = 100;
    this.armor = 100;
    this.arsenal.giveDefaultLoadout();
    this.arsenal.give('ak', true);
    this.arsenal.equip('ak', true);
    if (this.net.selfState) {
      this.applyServerPlayerState(this.net.selfState);
    } else {
      this.player.respawn(this.world.spawns[1].clone());
      this.player.yaw = Math.PI;
      this.player.pitch = 0;
    }
    this.bots.spawnAll(0, this.settings.diff);
    this.zombies.syncAll([]);
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
    this.hud.refreshAmmo();
    this.hud.setOnlineMode(true, 'zombies');
    this.updateZombieHud();
    this.hud.hideDeath();
    this.hud.setBuyOpen(false);
    this.refillNades();
    this.setBuyMarkers(true);
    document.getElementById('hud').classList.remove('hidden');
    this.hud.centerMsg('ZOMBIE CO-OP', 2);
    this.lockPointer();
  }

  updateZombieHud() {
    if (this.matchMode !== 'zombies') return;
    const zs = this.zombieState || { round: 0, phase: 'joining', remaining: 0, nextRoundIn: 0 };
    const roundLabel = zs.phase === 'intermission'
      ? `NEXT ${Math.ceil(zs.nextRoundIn || 0)}`
      : `R${zs.round || 1}`;
    this.hud.setTimer(roundLabel);
    this.hud.setScores(this.score, zs.remaining ?? this.zombies.zombies.size);
  }

  applyServerPlayerState(data) {
    if (!data) return;
    const x = Number.isFinite(data.x) ? data.x : this.player.pos.x;
    const y = Number.isFinite(data.y) ? data.y : this.player.pos.y;
    const z = Number.isFinite(data.z) ? data.z : this.player.pos.z;
    this.player.respawn(new THREE.Vector3(x, y, z));
    if (Number.isFinite(data.yaw)) this.player.yaw = data.yaw;
    if (Number.isFinite(data.pitch)) this.player.pitch = data.pitch;
    if (Number.isFinite(data.hp)) this.hp = data.hp;
    if (Number.isFinite(data.armor)) this.armor = data.armor;
    this.player.dead = data.alive === false;
    if (this.player.dead) this.state = 'dead';
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
  }

  endOnlineMatch(board) {
    this.state = 'end';
    this.suppressPause = true;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => { this.suppressPause = false; }, 100);
    const me = board.find(r => r.id === this.net.id) || { kills: this.score, deaths: this.deaths };
    const top = board[0];
    if (this.net.mode === 'zombies' || this.matchMode === 'zombies') {
      document.getElementById('endTitle').textContent = 'OVERRUN';
      document.getElementById('endSub').textContent =
        `Squad reached round ${this.zombieState?.round ?? 0}. Your score: ${me.kills}.`;
    } else {
      const won = me.kills >= (top?.kills ?? 0) && (top?.id === this.net.id || me.kills > (top?.kills ?? 0));
      document.getElementById('endTitle').textContent = won ? 'VICTORY' : 'MATCH OVER';
      document.getElementById('endSub').textContent = won
        ? `You topped the board with ${me.kills} kills.`
        : `${top?.name ?? 'Someone'} finished with ${top?.kills ?? 0} kills — you had ${me.kills}.`;
    }
    document.getElementById('endBoard').innerHTML = board.map(r =>
      `<div class="sb-row${r.id === this.net.id ? ' you' : ''}"><span class="n">${r.name}</span><span>${r.kills}</span><span>${r.deaths}</span><span>${r.ping ?? '—'}</span></div>`
    ).join('');
    this.grenades.clear();
    this.loot.clear();
    this.downed = false;
    this.hud.hideDowned();
    document.getElementById('hud').classList.add('hidden');
    this.showOverlay('end');
    this.online = false;
    this.net.disconnect();
    this.remotes.clear();
    this.zombies.clear();
  }

  killPlayerRemote(killerName, weaponId) {
    this.downed = false;
    this.hud.hideDowned();
    this.deaths++;
    this.state = 'dead';
    this.deathT = this.matchMode === 'zombies' ? 999 : 3.2;
    this.audio.play('death');
    this.input.fireHeld = false;
    this.hud.addKill(killerName, weaponId || 'ak', 'YOU', false, true);
    this.hud.showDeath(killerName, weaponId);
    if (this.matchMode === 'zombies') this.hud.setDeathTimer('Respawning next round...');
    this.hud.setScores(this.score, this.topOpponentScore());
    this.player.dead = true;
  }

  // Co-op down state: you crawl and can still fire, bleeding out until a teammate revives you.
  goDown(bleedout, by) {
    this.downed = true;
    this.downBleed = bleedout || 32;
    this.state = 'playing';
    this.player.dead = false;
    this.input.fireHeld = false;
    this.hp = Math.max(1, this.hp);
    this.audio.play('hit');
    this.hud.hideDeath();
    this.hud.showDowned(by);
  }

  reviveSelf(hp) {
    this.downed = false;
    this.downBleed = 0;
    this.hp = hp || 55;
    this.invulnT = 1.0;
    this.hud.setHealth(this.hp);
    this.hud.hideDowned();
    this.hud.centerMsg('REVIVED', 1.4);
    this.audio.play('buy');
  }

  respawnFromServer(x, y, z) {
    this.downed = false;
    this.hud.hideDowned();
    this.player.respawn(new THREE.Vector3(x, y, z));
    this.hp = 100;
    this.armor = 100;
    this.invulnT = 0.8;
    this.arsenal.refillAll();
    this.refillNades();
    this.arsenal.equip(this.arsenal.slotWeapon(1) || this.arsenal.slotWeapon(2), true);
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
    this.hud.refreshAmmo();
    this.hud.hideDeath();
    this.state = 'playing';
    this.deathT = 0;
  }

  topOpponentScore() {
    if (this.matchMode === 'zombies') return this.zombieState?.remaining ?? this.zombies.zombies.size;
    if (this.online) {
      return Math.max(this.remotes.topScore(), this.bots.bots.reduce((m, b) => Math.max(m, b.kills), 0));
    }
    return this.bots.bots.reduce((m, b) => Math.max(m, b.kills), 0);
  }

  // ---------------- match flow ----------------
  startMatch() {
    this.online = false;
    this.lastMatchWasOnline = false;
    this.matchMode = 'deathmatch';
    this.world.setMood('day');
    this.world.setMapVariant(Math.random() < 0.5);
    this.audio.stopMenuMusic();
    this.remotes.clear();
    this.zombies.clear();
    this.hud.setOnlineMode(false);
    this.hideOverlays();
    this.state = 'playing';
    this.score = 0;
    this.deaths = 0;
    this.timeLeft = MATCH_TIME;
    this.hp = 100;
    this.armor = 100;
    this.arsenal.giveDefaultLoadout();
    this.player.respawn(this.world.spawns[1].clone());
    this.player.yaw = Math.PI;
    this.player.pitch = 0;
    this.bots.spawnAll(this.settings.bots, this.settings.diff);
    if (FREEZE) {
      // deterministic layout for screenshots
      const b0 = this.bots.bots[0];
      if (b0) { b0.pos.set(70, 1, -700); b0.yaw = b0.targetYaw = 0; }
      const b1 = this.bots.bots[1];
      if (b1) { b1.pos.set(-220, 1, -560); b1.yaw = b1.targetYaw = 0.6; }
      for (const b of this.bots.bots) {
        b.group.position.copy(b.pos);
        b.group.rotation.y = b.yaw;
      }
    }
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
    this.hud.refreshAmmo();
    this.hud.setTimer(this.timeLeft);
    this.hud.setScores(0, 0);
    this.hud.hideDeath();
    this.hud.setBuyOpen(false);
    this.refillNades();
    this.setBuyMarkers(false);
    document.getElementById('hud').classList.remove('hidden');
    this.hud.centerMsg('GO GO GO!', 2);
    this.audio.play('go');
    this.lockPointer();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.showOverlay('pause');
  }

  resume() {
    this.hideOverlays();
    this.state = 'playing';
    this.lockPointer();
  }

  toMenu() {
    if (this.online) {
      this.online = false;
      this.net.disconnect();
      this.remotes.clear();
      this.zombies.clear();
    }
    this.matchMode = 'deathmatch';
    this.grenades.clear();
    this.loot.clear();
    this.downed = false;
    this.reviveTarget = null;
    this.repairTarget = null;
    this.repairing = false;
    this.hud.hideDowned();
    this.world.setMapVariant(false);
    this.setBuyMarkers(false);
    this.hud.setBuyPrompt(null);
    this.hud.setOnlineMode(false);
    this.state = 'menu';
    this.hud.setBuyOpen(false);
    document.getElementById('hud').classList.add('hidden');
    this.showDefaultMenu(false);
    this.showOverlay('menu');
    this.audio.startMenuMusic();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  endMatch() {
    this.state = 'end';
    this.suppressPause = true;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => { this.suppressPause = false; }, 100);
    const topBot = this.bots.bots.reduce((m, b) => Math.max(m, b.kills), 0);
    const won = this.score >= topBot;
    document.getElementById('endTitle').textContent = won ? 'VICTORY' : 'MATCH OVER';
    document.getElementById('endSub').textContent = won
      ? `You topped the board with ${this.score} kills.`
      : `Top bot finished with ${topBot} kills — you had ${this.score}.`;
    const rows = [
      { name: 'YOU', k: this.score, d: this.deaths, you: true },
      ...this.bots.bots.map(b => ({ name: b.name, k: b.kills, d: b.deaths })),
    ].sort((a, b) => b.k - a.k);
    document.getElementById('endBoard').innerHTML = rows.map(r =>
      `<div class="sb-row${r.you ? ' you' : ''}"><span class="n">${r.name}</span><span>${r.k}</span><span>${r.d}</span><span>—</span></div>`
    ).join('');
    this.grenades.clear();
    this.loot.clear();
    this.downed = false;
    this.hud.hideDowned();
    document.getElementById('hud').classList.add('hidden');
    this.showOverlay('end');
  }

  // ---------------- buy ----------------
  openBuy() {
    if (this.state !== 'playing' || this.matchMode === 'zombies') return; // zombie mode buys at stations
    this.hud.setBuyOpen(true);
    this.suppressPause = true;
    if (document.pointerLockElement) document.exitPointerLock();
    setTimeout(() => { this.suppressPause = false; }, 100);
  }

  closeBuy() {
    this.hud.setBuyOpen(false);
    this.lockPointer();
  }

  buyItem(id) {
    this.audio.play('buy');
    if (id === 'armor') {
      this.armor = 100;
      this.hud.setArmor(this.armor);
    } else {
      this.arsenal.give(id);
    }
    this.closeBuy();
  }

  // ---------------- grenades ----------------
  throwNade(kind) {
    if (this.state !== 'playing' || this.nadeCd > 0) return;
    if (this.grenades.throw(kind)) this.nadeCd = 0.7;
  }

  refillNades() {
    this.nades = { frag: 2, molotov: 1 };
    this.hud.refreshNades();
  }

  // ---------------- buy stations (Zombie Co-op) ----------------
  buildBuyMarkers() {
    this.buyMarkers = [];
    for (const s of BUY_SPOTS) {
      const col = s.kind === 'box' ? 0xb060ff : s.kind === 'armor' ? 0x3aa0ff : 0xffc83a;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(11, 48, 11),
        new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7, roughness: 0.5, metalness: 0.2 })
      );
      m.position.set(s.x, s.y + 27, s.z);
      m.visible = false;
      this.scene.add(m);
      this.buyMarkers.push(m);
    }
  }

  setBuyMarkers(v) {
    for (const m of this.buyMarkers) m.visible = v;
    this.setBarricadesVisible(v);
  }

  buildBarricades() {
    this.barricades = new Map();
    for (const b of BARRICADES) {
      const w = Math.max(14, b.x2 - b.x1), d = Math.max(14, b.z2 - b.z1);
      const geo = new THREE.BoxGeometry(w, 130, d);
      geo.translate(0, 65, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x6e4a24, roughness: 0.92, metalness: 0, emissive: 0x140a02, emissiveIntensity: 0.25 }));
      mesh.position.set((b.x1 + b.x2) / 2, 0, (b.z1 + b.z2) / 2);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.visible = false;
      this.scene.add(mesh);
      this.barricades.set(b.id, { mesh, hp: BARRICADE_HP, max: BARRICADE_HP, cx: (b.x1 + b.x2) / 2, cz: (b.z1 + b.z2) / 2 });
    }
  }

  setBarricadeHp(id, hp) {
    const b = this.barricades.get(id);
    if (!b) return;
    b.hp = hp;
    const k = Math.max(0, hp / b.max);
    b.mesh.scale.y = Math.max(0.04, k);
    b.mesh.visible = this.online && this.matchMode === 'zombies' && hp > 0;
    b.mesh.material.color.setHex(k > 0.45 ? 0x6e4a24 : 0x803018);
  }

  syncBarricades(list) {
    for (const x of list || []) this.setBarricadeHp(x.id, x.hp);
  }

  setBarricadesVisible(v) {
    for (const b of this.barricades.values()) b.mesh.visible = v && b.hp > 0;
  }

  updateBuyStations() {
    // Reviving a downed teammate takes priority over buy stations.
    this.reviveTarget = null;
    if (this.online && this.matchMode === 'zombies' && this.state === 'playing' && !this.downed) {
      const p = this.player.pos;
      let best = null, bestD = 112;
      for (const r of this.remotes.remotes.values()) {
        if (!r.alive || !r.down) continue;
        if (Math.abs(p.y - r.pos.y) > 130) continue;
        const d = Math.hypot(p.x - r.pos.x, p.z - r.pos.z);
        if (d < bestD) { bestD = d; best = r; }
      }
      this.reviveTarget = best;
    }
    if (this.reviveTarget) {
      this.reviving = this.input.keys.has('KeyE');
      this.activeBuySpot = null;
      const prog = Math.round((this.reviveProgById[this.reviveTarget.id] || 0) * 100);
      this.hud.setBuyPrompt(`Hold [E] to revive ${this.reviveTarget.name}${this.reviving ? `  ${prog}%` : ''}`, true);
      return;
    }
    this.reviving = false;
    if (!this.online || this.matchMode !== 'zombies' || this.state !== 'playing' || this.downed) {
      this.repairTarget = null; this.repairing = false;
      if (this.activeBuySpot) { this.activeBuySpot = null; this.hud.setBuyPrompt(null); }
      return;
    }
    const p = this.player.pos;
    // Repair a damaged barricade (priority over buying).
    let rbId = null, rbB = null, rbD = BARRICADE_RADIUS + 35;
    if (Math.abs(p.y) < 150) {
      for (const [id, b] of this.barricades) {
        if (b.hp >= b.max) continue;
        const d = Math.hypot(p.x - b.cx, p.z - b.cz);
        if (d < rbD) { rbD = d; rbId = id; rbB = b; }
      }
    }
    if (rbB) {
      this.repairTarget = rbId;
      this.repairing = this.input.keys.has('KeyE');
      this.activeBuySpot = null;
      this.hud.setBuyPrompt(`Hold [E] to repair barricade — ${Math.round((rbB.hp / rbB.max) * 100)}%`, true);
      return;
    }
    this.repairTarget = null;
    this.repairing = false;
    let best = null, bestD = BUY_RADIUS;
    for (const s of BUY_SPOTS) {
      if (Math.abs(p.y - s.y) > BUY_Y_TOLERANCE) continue;
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < bestD) { bestD = d; best = s; }
    }
    this.activeBuySpot = best;
    if (best) {
      const owns = best.kind === 'wall' && best.refill && this.arsenal.owned[best.item];
      this.buyIsAmmo = !!owns;
      const price = owns ? best.refill : best.price;
      const label = owns ? `Refill ${best.label} ammo` : best.label;
      this.hud.setBuyPrompt(`[E] ${label} — $${price}`, this.points >= price);
    } else {
      this.buyIsAmmo = false;
      this.hud.setBuyPrompt(null);
    }
  }

  tryBuy() {
    if (this.reviveTarget || this.repairTarget != null) return; // E is reviving/repairing
    if (this.state !== 'playing' || !this.online || this.matchMode !== 'zombies' || this.downed) return;
    if (this.activeBuySpot) this.net.send({ t: 'buy', spot: this.activeBuySpot.id, ammo: !!this.buyIsAmmo });
  }

  // ---------------- zoom ----------------
  setZoom(scale, scoped) {
    this.zoomScale = scale;
    this.camera.fov = this.settings.fov * scale;
    this.camera.updateProjectionMatrix();
    this.hud.setScope(!!scoped && scale < 1);
    document.getElementById('xhair').style.opacity = (scoped && scale < 1) ? 0 : 1;
  }

  // ---------------- combat ----------------
  shootCandidates() {
    const targets = this.world.shootables.concat(this.bots.alivePartMeshes());
    if (this.online && this.matchMode !== 'zombies') targets.push(...this.remotes.alivePartMeshes());
    if (this.online && this.matchMode === 'zombies') targets.push(...this.zombies.alivePartMeshes());
    return targets;
  }

  fireBullet(def, origin, dir, muzzlePos, showTracer = true) {
    this.raycaster.set(origin, dir);
    const hits = this.raycaster.intersectObjects(this.shootCandidates(), false);
    const hit = hits[0];
    const end = hit ? hit.point : origin.clone().addScaledVector(dir, def.pellets ? 900 : 4000);
    if (showTracer) this.effects.tracer(muzzlePos || origin, end);

    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.bot) {
      const bot = ud.bot;
      const falloff = Math.pow(def.rangeMod, hit.distance / 500);
      const dmg = def.dmg * ud.mult * falloff;
      const hs = ud.part === 'head';
      this.effects.blood(hit.point, dir);
      this.audio.play(hs ? 'dink' : 'hit');
      const killed = this.bots.applyDamage(bot, dmg, ud.part, def.id);
      if (killed) {
        this.score++;
        bot.spottedT = -99;
        this.audio.play('kill');
        this.hud.addKill('YOU', def.id, bot.name, hs, true);
        this.hud.setScores(this.score, this.topOpponentScore());
        if (!this.online && this.score >= FRAG_LIMIT) this.endMatch();
      }
    } else if (ud.remote) {
      if (this.matchMode === 'zombies') return;
      const remote = ud.remote;
      const falloff = Math.pow(def.rangeMod, hit.distance / 500);
      const dmg = def.dmg * ud.mult * falloff;
      const hs = ud.part === 'head';
      this.effects.blood(hit.point, dir);
      this.audio.play(hs ? 'dink' : 'hit');
      remote.flashHit();
      if (this.online) this.net.sendHit(remote.id, dmg, ud.part, def.armorPen ?? 0.6);
    } else if (ud.zombie) {
      const zombie = ud.zombie;
      const falloff = Math.pow(def.rangeMod, hit.distance / 500);
      const dmg = def.dmg * ud.mult * falloff;
      const hs = ud.part === 'head';
      this.effects.blood(hit.point, dir);
      this.audio.play(hs ? 'dink' : 'hit');
      zombie.flashHit();
      if (this.online) this.net.sendZombieHit(zombie.id, dmg, ud.part);
    } else {
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      this.effects.impact(hit.point, n);
      this.audio.play('impact', hit.point);
    }
  }

  meleeAttack(dmg) {
    const origin = this.player.eyePos();
    const dir = this.player.lookDir();
    this.raycaster.set(origin, dir);
    const prevFar = this.raycaster.far;
    this.raycaster.far = 90;
    const hit = this.raycaster.intersectObjects(this.shootCandidates(), false)[0];
    this.raycaster.far = prevFar;
    if (!hit) return;
    const ud = hit.object.userData;
    if (ud.bot) {
      this.effects.blood(hit.point, dir);
      this.audio.play('knife_hit');
      const killed = this.bots.applyDamage(ud.bot, dmg * (ud.part === 'head' ? 1.5 : 1), ud.part, 'knife');
      if (killed) {
        this.score++;
        this.audio.play('kill');
        this.hud.addKill('YOU', 'knife', ud.bot.name, false, true);
        this.hud.setScores(this.score, this.topOpponentScore());
        if (!this.online && this.score >= FRAG_LIMIT) this.endMatch();
      }
    } else if (ud.remote) {
      if (this.matchMode === 'zombies') return;
      this.effects.blood(hit.point, dir);
      this.audio.play('knife_hit');
      ud.remote.flashHit();
      if (this.online) {
        this.net.sendMelee(ud.remote.id, dmg, ud.part);
      }
    } else if (ud.zombie) {
      this.effects.blood(hit.point, dir);
      this.audio.play('knife_hit');
      ud.zombie.flashHit();
      if (this.online) this.net.sendZombieHit(ud.zombie.id, dmg, ud.part);
    } else {
      this.audio.play('knife_wall');
      const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
      this.effects.impact(hit.point, n);
    }
  }

  botShoot(bot, origin, dirN) {
    const def = bot.def;
    this.audio.play('shot_' + def.id, origin);
    this.effects.muzzleFlash(origin, def.pellets ? 1.2 : 0.8);

    const pellets = def.pellets || 1;
    const spread = def.pelletSpread ?? 0;
    const maxRange = pellets > 1 ? 900 : 4096;
    let totalDmg = 0;
    let hitKind = 'body';
    let hitPoint = null;
    let hitDir = null;
    let wallEnd = null;
    let wallHit = null;
    let nearMiss = false;

    for (let i = 0; i < pellets; i++) {
      const dir = dirN.clone();
      if (spread > 0) {
        dir.x += (Math.random() * 2 - 1) * spread;
        dir.y += (Math.random() * 2 - 1) * spread;
        dir.z += (Math.random() * 2 - 1) * spread;
        dir.normalize();
      }

      const wall = this.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, maxRange);
      const tWall = wall ? wall.t : maxRange;

      if (this.playerAlive && this.invulnT <= 0) {
        const p = this.player;
        const pb = {
          minX: p.pos.x - 16, minY: p.pos.y, minZ: p.pos.z - 16,
          maxX: p.pos.x + 16, maxY: p.pos.y + p.height, maxZ: p.pos.z + 16,
        };
        const hitP = rayAABB(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, pb, tWall);
        if (hitP) {
          const falloff = Math.pow(def.rangeMod, hitP.t / 500);
          const hs = Math.random() < (pellets > 1 ? 0.04 : 0.10);
          totalDmg += def.dmg * falloff * (hs ? 2.1 : 1);
          if (hs) hitKind = 'head';
          hitPoint = origin.clone().addScaledVector(dir, hitP.t);
          hitDir = dir;
        }
      }

      if (i === 0) {
        const end = origin.clone().addScaledVector(dir, tWall);
        this.effects.tracer(origin, end);
        if (wall) {
          wallEnd = end;
          wallHit = wall;
        }
        const toP = this.player.eyePos().sub(origin);
        const along = toP.dot(dir);
        if (along > 0 && along < tWall && toP.addScaledVector(dir, -along).length() < 70) nearMiss = true;
      }
    }

    if (totalDmg > 0) {
      if (hitPoint) {
        this.effects.blood(hitPoint, hitDir);
      }
      this.damagePlayer(totalDmg, bot.pos, bot, hitKind, def.armorPen ?? 0.6);
    } else if (wallEnd && wallHit) {
      this.effects.impact(wallEnd, { x: wallHit.nx, y: wallHit.ny, z: wallHit.nz });
      this.audio.play('impact', wallEnd);
      if (nearMiss) this.audio.play('whiz');
    }
  }

  damagePlayer(dmg, fromPos, attacker, kind = 'body', armorPen = 0.6) {
    if (!this.playerAlive || this.invulnT > 0) return;
    let hDmg = dmg;
    if (kind !== 'fall' && this.armor > 0) {
      hDmg = dmg * armorPen;
      const aDmg = (dmg - hDmg) * 0.5;
      if (aDmg > this.armor) { hDmg += (aDmg - this.armor); this.armor = 0; }
      else this.armor -= aDmg;
      if (kind === 'head') this.audio.play('dink');
    }
    this.hp -= hDmg;
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
    this.audio.play('hit');
    if (fromPos && attacker) {
      const yawA = Math.atan2(-(fromPos.x - this.player.pos.x), -(fromPos.z - this.player.pos.z));
      this.hud.showDamageFrom(this.player.yaw - yawA);
    } else {
      this.hud.showDamageFrom(Math.PI); // fall: from below/behind
    }
    if (this.hp <= 0) this.killPlayer(attacker, kind);
  }

  killPlayer(attacker, kind) {
    this.deaths++;
    this.state = 'dead';
    this.deathT = 3.2;
    this.audio.play('death');
    this.input.fireHeld = false;
    if (attacker) {
      attacker.kills++;
      this.hud.addKill(attacker.name, attacker.weaponId, 'YOU', kind === 'head', true);
      this.hud.showDeath(attacker.name, attacker.weaponId);
      this.hud.setScores(this.score, this.topOpponentScore());
      if (!this.online && attacker.kills >= FRAG_LIMIT) { this.endMatch(); return; }
    } else {
      this.hud.addKill('Gravity', 'fall', 'YOU', false, true);
      this.hud.showDeath('gravity', null);
    }
    this.player.dead = true;
  }

  respawnPlayer() {
    // farthest spawn from living bots, no line of sight if possible
    const alive = this.bots.bots.filter(b => b.alive);
    const scored = this.world.spawns.map(s => {
      let minD = Infinity, seen = false;
      for (const b of alive) {
        minD = Math.min(minD, b.pos.distanceTo(s));
        if (this.world.losClear({ x: s.x, y: s.y, z: s.z }, { x: b.pos.x, y: b.pos.y, z: b.pos.z }, 60)) seen = true;
      }
      return { s, score: minD + (seen ? 0 : 1500) };
    }).sort((a, b) => b.score - a.score);
    this.player.respawn(scored[0].s.clone());
    this.hp = 100;
    this.armor = 100;
    this.invulnT = 0.8;
    this.arsenal.refillAll();
    this.refillNades();
    this.arsenal.equip(this.arsenal.slotWeapon(1) || this.arsenal.slotWeapon(2), true);
    this.hud.setHealth(this.hp);
    this.hud.setArmor(this.armor);
    this.hud.refreshAmmo();
    this.hud.hideDeath();
    this.state = 'playing';
  }

  // ---------------- per-frame ----------------
  frame() {
    const now = performance.now();
    const dt = clamp((now - this.last) / 1000, 0, 0.05);
    this.last = now;
    this.world.updateMood(dt);

    if (this.state === 'menu' || this.state === 'end') {
      this.menuYaw += dt * 0.07;
      const r = 1050;
      this.camera.position.set(Math.sin(this.menuYaw) * r, 420, Math.cos(this.menuYaw) * r * 0.8 - 100);
      this.camera.lookAt(0, 40, -150);
      this.effects.update(dt);
      this.renderer.render(this.scene, this.camera);
      return;
    }

    if (this.state === 'paused') {
      this.renderer.render(this.scene, this.camera);
      return;
    }

    // playing or dead
    this.time += dt;
    this.invulnT -= dt;
    this.nadeCd -= dt;
    if (!this.online) this.timeLeft -= dt;
    if (this.timeLeft <= 0 && !this.online) { this.endMatch(); return; }
    this.hud.setTimer(this.timeLeft);

    if (this.state === 'dead') {
      if (this.online && this.matchMode === 'zombies') {
        this.hud.setDeathTimer('Respawning next round...');
      } else {
        this.deathT -= dt;
        this.hud.setDeathTimer(this.deathT);
      }
      if (!this.online && this.deathT <= 0) this.respawnPlayer();
    }

    if (this.downed) {
      this.downBleed -= dt;
      this.input.jumpPressed = false;
      this.hud.setDownedBleed(Math.max(0, this.downBleed), 32);
    }

    this.player.update(dt, this.input, this.downed ? 80 : this.arsenal.moveSpeed());
    if (this.state === 'playing') {
      this.arsenal.update(dt, this.input);
    }
    if (!FREEZE) this.bots.update(dt);
    if (this.online) {
      this.remotes.update(dt);
      if (this.matchMode === 'zombies') {
        this.zombies.update(dt);
        this.updateZombieHud();
      }
      this.net.update(dt);
    }
    this.effects.update(dt);
    this.grenades.update(dt);
    this.loot.update(dt);

    // camera from player (+ death roll)
    const eye = this.player.eyePos();
    this.camera.position.copy(eye);
    const roll = this.state === 'dead' ? Math.min(1, (3.2 - this.deathT) * 3) * 0.55 : (this.downed ? 0.13 : 0);
    if (this.state === 'dead') this.camera.position.y -= Math.min(1, (3.2 - this.deathT) * 3) * 22;
    else if (this.downed) this.camera.position.y -= 32; // crawling low
    this.camera.rotation.set(
      this.player.pitch + this.player.punchPitch,
      this.player.yaw + this.player.punchYaw,
      roll
    );

    // audio listener
    this.audio.updateListener(eye, this.player.rightDir());

    // enemy name under crosshair
    this.targetCheckT -= dt;
    if (this.targetCheckT <= 0 && this.state === 'playing') {
      this.targetCheckT = 0.12;
      this.raycaster.set(eye, this.player.lookDir());
      const hit = this.raycaster.intersectObjects(this.shootCandidates(), false)[0];
      const ud = hit?.object?.userData;
      this.hud.setTarget(ud?.bot?.name || ud?.remote?.name || ud?.zombie?.name || null);
    }

    this.updateBuyStations();
    this.hud.update(dt);

    // consume per-frame input
    this.input.lookDX = 0;
    this.input.lookDY = 0;
    this.input.fireClicked = false;
    this.input.altClicked = false;

    this.renderer.render(this.scene, this.camera);
  }

  renderGameToText() {
    const remotes = [...this.remotes.remotes.values()].map(r => ({
      id: r.id,
      name: r.name,
      x: Math.round(r.pos.x),
      y: Math.round(r.pos.y),
      z: Math.round(r.pos.z),
      hp: Math.ceil(r.hp),
      alive: r.alive,
      kills: r.kills,
      deaths: r.deaths,
    }));
    const bots = this.bots.bots.filter(b => b.alive).map(b => ({
      name: b.name,
      x: Math.round(b.pos.x),
      y: Math.round(b.pos.y),
      z: Math.round(b.pos.z),
      hp: Math.ceil(b.hp),
      kills: b.kills,
      deaths: b.deaths,
    }));
    const zombies = [...this.zombies.zombies.values()].map(z => ({
      id: z.id,
      type: z.type,
      name: z.name,
      x: Math.round(z.pos.x),
      y: Math.round(z.pos.y),
      z: Math.round(z.pos.z),
      hp: Math.ceil(z.hp),
      maxHp: Math.ceil(z.maxHp),
    }));
    return JSON.stringify({
      coordinateSystem: 'feet position, x right, y up, z forward/back in Source-style world units',
      state: this.state,
      online: this.online,
      matchMode: this.matchMode,
      player: {
        x: Math.round(this.player.pos.x),
        y: Math.round(this.player.pos.y),
        z: Math.round(this.player.pos.z),
        yaw: +this.player.yaw.toFixed(3),
        pitch: +this.player.pitch.toFixed(3),
        hp: Math.ceil(this.hp),
        armor: Math.ceil(this.armor),
        alive: this.state !== 'dead',
      },
      weapon: this.arsenal.def?.id ?? null,
      score: this.score,
      deaths: this.deaths,
      timeLeft: Math.ceil(this.timeLeft),
      remotes,
      bots,
      zombies,
      zombieState: this.zombieState,
      network: {
        connected: this.net.connected,
        joined: this.net.joined,
        id: this.net.id,
        ping: this.net.ping,
      },
    });
  }

  advanceTime(ms = 1000 / 60) {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i++) {
      this.last -= 1000 / 60;
      this.frame();
    }
  }
}

const game = new Game();
window.render_game_to_text = () => game.renderGameToText();
window.advanceTime = (ms) => game.advanceTime(ms);
