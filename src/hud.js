// In-game UI: crosshair, health/armor/ammo, radar (with CS-style spotting),
// killfeed, buy menu, scoreboard, damage direction indicators, scope overlay.
import { clamp, fmtTime } from './utils.js';
import { WEAPONS } from './weapons.js';

const ICONS = {
  ak: '<rect x="2" y="9" width="8" height="5" transform="skewY(8)"/><rect x="8" y="9" width="32" height="5"/><rect x="40" y="10" width="17" height="2.6"/><rect x="44" y="6.5" width="1.6" height="4"/><polygon points="18,14 25,14 21,22 14,22"/><rect x="27" y="14" width="3.4" height="5"/>',
  m4: '<rect x="2" y="10" width="9" height="4"/><rect x="11" y="9" width="26" height="5"/><rect x="13" y="6.8" width="20" height="1.8"/><polygon points="19,14 25,14 23.6,21 17.6,21"/><rect x="27" y="14" width="3.4" height="5"/><rect x="37" y="10.4" width="15" height="2.2"/><rect x="48" y="6.8" width="1.6" height="4"/>',
  awp: '<polygon points="2,9 10,9 10,17 2,19"/><rect x="10" y="10" width="31" height="4.4"/><rect x="17" y="4.6" width="15" height="3.2"/><rect x="18.5" y="7.8" width="2.4" height="2.4"/><rect x="28" y="7.8" width="2.4" height="2.4"/><rect x="41" y="10.8" width="21" height="2"/><polygon points="22,14.4 27,14.4 25.4,20 20.4,20"/><rect x="13" y="14.4" width="3.4" height="5"/>',
  deagle: '<rect x="18" y="6" width="28" height="5.2"/><rect x="44" y="7" width="4" height="3"/><polygon points="36,11 43,11 40,22 33,22"/><rect x="26" y="11" width="9" height="2.4"/>',
  usp: '<rect x="24" y="6.5" width="20" height="4.6"/><rect x="44" y="7.2" width="14" height="3.4"/><polygon points="36,11 43,11 40,21 33,21"/><rect x="28" y="11" width="7" height="2.2"/>',
  knife: '<polygon points="8,14 30,6 34,9.4 12,17"/><polygon points="31,6.8 43,3.4 45.4,6.4 35.4,10.4"/>',
  nova: '<rect x="4" y="10" width="14" height="4.5" rx="0.5"/><rect x="16" y="9.5" width="28" height="5"/><rect x="18" y="14.5" width="4" height="5"/><rect x="44" y="10.5" width="16" height="3"/><rect x="6" y="7" width="8" height="2.5"/>',
  fall: '<polygon points="26,2 38,2 32,14 42,14 22,30 28,16 20,16"/>',
  mp9: '<rect x="10" y="9" width="22" height="6"/><rect x="32" y="10.5" width="11" height="2.6"/><polygon points="16,15 22,15 20,22 14,22"/><rect x="24" y="15" width="3.4" height="6"/><rect x="5" y="9.5" width="6" height="2.4"/>',
  m249: '<rect x="4" y="8.5" width="40" height="6"/><rect x="44" y="10" width="16" height="2.6"/><rect x="18" y="14.5" width="13" height="8"/><polygon points="13,14.5 19,14.5 17,21 11,21"/><rect x="2" y="11" width="6" height="6"/>',
};
const HS_ICON = '<svg viewBox="0 0 24 24" class="hs"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="1.8"/><path d="M12 1v5M12 18v5M1 12h5M18 12h5" stroke="currentColor" stroke-width="2.2"/></svg>';

export function weaponIcon(id, cls = '') {
  return `<svg viewBox="0 0 64 24" class="wicon ${cls}">${ICONS[id] || ICONS.ak}</svg>`;
}

const DEATH_TIPS = [
  'Counter-strafe: tap the opposite key to stop instantly and shoot accurately.',
  'Aim at head height around corners — one less flick to make.',
  'The first 4-5 bullets are accurate. Burst, reset, burst again.',
  'Pull DOWN (and slightly sideways) while spraying to control the recoil pattern.',
  'Crouching tightens your spray — but makes you an easy header.',
  'Hold SHIFT to walk silently. They hear your steps like you hear theirs.',
  'The AWP is a one-shot kill to the body. Hold angles, not corridors.',
  'Standing still = laser accuracy. Moving = praying.',
];

export class HUD {
  constructor(game) {
    this.game = game;
    this.el = (id) => document.getElementById(id);
    this.root = this.el('hud');
    this.nadeEl = document.createElement('div');
    this.nadeEl.id = 'nadeHud';
    this.nadeEl.style.cssText = 'position:fixed;left:16px;bottom:66px;display:flex;gap:16px;font-weight:800;font-size:14px;letter-spacing:0.5px;text-shadow:0 1px 3px rgba(0,0,0,0.85);';
    this.root.appendChild(this.nadeEl);
    this.pointsEl = document.createElement('div');
    this.pointsEl.id = 'pointsHud';
    this.pointsEl.style.cssText = 'position:fixed;left:16px;bottom:92px;font-weight:800;font-size:16px;color:#ffd24a;letter-spacing:0.5px;text-shadow:0 1px 3px rgba(0,0,0,0.85);display:none;';
    this.root.appendChild(this.pointsEl);
    this.buyPromptEl = document.createElement('div');
    this.buyPromptEl.id = 'buyPrompt';
    this.buyPromptEl.style.cssText = 'position:fixed;left:50%;top:calc(50% + 66px);transform:translateX(-50%);font-weight:700;font-size:15px;padding:5px 12px;border-radius:5px;background:rgba(13,17,21,0.72);text-shadow:0 1px 3px rgba(0,0,0,0.85);display:none;white-space:nowrap;';
    this.root.appendChild(this.buyPromptEl);
    this.downEl = document.createElement('div');
    this.downEl.id = 'downHud';
    this.downEl.style.cssText = 'position:fixed;left:50%;top:36%;transform:translateX(-50%);text-align:center;display:none;width:340px;';
    this.downEl.innerHTML =
      '<div style="font-weight:900;font-size:27px;color:#ff5a5a;letter-spacing:2px;text-shadow:0 2px 6px #000;">DOWNED</div>' +
      '<div id="downSub" style="font-size:13px;color:#e8edf2;margin:2px 0 8px;text-shadow:0 1px 3px #000;">Bleeding out — a teammate must revive you</div>' +
      '<div style="height:7px;background:rgba(0,0,0,0.5);border-radius:4px;overflow:hidden;"><div id="downBleed" style="height:100%;width:100%;background:#d04030;"></div></div>' +
      '<div id="downReviveWrap" style="height:7px;background:rgba(0,0,0,0.5);border-radius:4px;overflow:hidden;margin-top:5px;display:none;"><div id="downRevive" style="height:100%;width:0%;background:#5ad06a;"></div></div>';
    this.root.appendChild(this.downEl);
    this.killfeedEl = this.el('killfeed');
    this.feed = [];
    this.hitDirs = [];
    this.dmgFlashV = 0;
    this.buyOpen = false;
    this.buildCrosshair();
    this.buildBuyMenu();
    this.buildRadarBase();
    this.lastTipIdx = -1;
    this.onlineMode = false;
  }

  setOnlineMode(on, mode = 'deathmatch') {
    this.onlineMode = on;
    this.pointsEl.style.display = (on && mode === 'zombies') ? 'block' : 'none';
    const youAfter = mode === 'zombies' ? 'KILLS' : 'YOU';
    const topAfter = mode === 'zombies' ? 'ZEDS' : on ? 'TOP' : 'TOP BOT';
    const style = document.getElementById('scoreTopStyle');
    if (!style) {
      const s = document.createElement('style');
      s.id = 'scoreTopStyle';
      document.head.appendChild(s);
    }
    document.getElementById('scoreTopStyle').textContent =
      `#scoreYou::after { content: "${youAfter}"; } #scoreTop::after { content: "${topAfter}"; }`;
  }

  // ---------- crosshair ----------
  buildCrosshair() {
    const x = this.el('xhair');
    x.innerHTML = '<div class="xh xh-t"></div><div class="xh xh-b"></div><div class="xh xh-l"></div><div class="xh xh-r"></div><div class="xh-dot"></div>';
  }
  applyCrosshair(s) {
    const r = document.documentElement.style;
    r.setProperty('--xh-color', s.xhColor);
    r.setProperty('--xh-len', s.xhSize + 'px');
    r.setProperty('--xh-gap', s.xhGap + 'px');
    r.setProperty('--xh-th', s.xhThick + 'px');
    this.el('xhair').classList.toggle('show-dot', !!s.xhDot);
  }

  // ---------- vitals ----------
  setHealth(hp) {
    const n = this.el('hpNum');
    n.textContent = Math.max(0, Math.ceil(hp));
    n.parentElement.classList.toggle('low', hp <= 30);
    this.el('vignette').style.opacity = clamp((45 - hp) / 45, 0, 0.8);
  }
  setArmor(a) { this.el('armNum').textContent = Math.max(0, Math.ceil(a)); }

  refreshAmmo() {
    const ars = this.game.arsenal;
    const def = ars?.def;
    if (!def) return;
    const magEl = this.el('ammoMag');
    if (def.melee) {
      magEl.textContent = '—';
      this.el('ammoReserve').textContent = '';
      magEl.classList.remove('low');
    } else {
      magEl.textContent = ars.ammo.mag;
      this.el('ammoReserve').textContent = '/ ' + ars.ammo.reserve;
      magEl.classList.toggle('low', ars.ammo.mag <= def.mag * 0.25);
    }
    this.el('weaponLabel').innerHTML = `${weaponIcon(def.id)}<span>${def.name}</span>`;
  }

  setTimer(t) { this.el('timer').textContent = typeof t === 'string' ? t : fmtTime(t); }
  refreshNades() {
    const n = this.game.nades || { frag: 0, molotov: 0 };
    this.nadeEl.innerHTML =
      `<span style="color:${n.frag > 0 ? '#9fe080' : '#566b4d'}">FRAG ${n.frag}</span>` +
      `<span style="color:${n.molotov > 0 ? '#ff9d4a' : '#6b5240'}">MOLO ${n.molotov}</span>`;
  }
  setPoints(n) { this.pointsEl.textContent = `$ ${n}`; }
  setBuyPrompt(text, afford = true) {
    if (!text) { this.buyPromptEl.style.display = 'none'; return; }
    this.buyPromptEl.style.display = 'block';
    this.buyPromptEl.textContent = text;
    this.buyPromptEl.style.color = afford ? '#cfe9b0' : '#ff8a8a';
  }
  showDowned() { this.downEl.style.display = 'block'; }
  hideDowned() {
    this.downEl.style.display = 'none';
    const rw = this.el('downReviveWrap'); if (rw) rw.style.display = 'none';
  }
  setDownedBleed(t, max) {
    const b = this.el('downBleed'); if (b) b.style.width = `${Math.max(0, Math.min(1, t / max)) * 100}%`;
  }
  setReviveSelf(prog) {
    const rw = this.el('downReviveWrap'), r = this.el('downRevive');
    if (!rw || !r) return;
    if (prog > 0.01) { rw.style.display = 'block'; r.style.width = `${Math.round(prog * 100)}%`; }
    else rw.style.display = 'none';
  }
  setScores(you, top) {
    this.el('scoreYou').textContent = you;
    this.el('scoreTop').textContent = top;
  }

  // ---------- killfeed ----------
  addKill(killer, weaponId, victim, hs, involved) {
    const div = document.createElement('div');
    div.className = 'kf' + (involved ? ' me' : '');
    div.innerHTML = `<span class="k">${killer}</span>${weaponIcon(weaponId)}${hs ? HS_ICON : ''}<span class="v">${victim}</span>`;
    this.killfeedEl.appendChild(div);
    this.feed.push({ div, t: 0 });
    if (this.feed.length > 6) {
      const old = this.feed.shift();
      old.div.remove();
    }
  }

  // ---------- radar ----------
  buildRadarBase() {
    const w = this.game.world;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 1024;
    const g = c.getContext('2d');
    const k = 1024 / 3400;
    g.translate(512, 512);
    g.scale(k, k);
    g.fillStyle = 'rgba(170,185,195,0.16)';
    g.fillRect(-1600, -1200, 3200, 2400);
    g.fillStyle = 'rgba(205,218,228,0.6)';
    for (const r of w.radarRects) g.fillRect(r.x1, r.z1, r.x2 - r.x1, r.z2 - r.z1);
    this.radarBase = c;
    this.radarK = k;
  }

  drawRadar() {
    const game = this.game;
    const cv = this.el('radar');
    const ctx = cv.getContext('2d');
    const C = cv.width / 2;
    const p = game.player;
    const s = 0.13; // world units -> radar px
    const theta = -Math.PI / 2 - Math.atan2(-Math.cos(p.yaw), -Math.sin(p.yaw));

    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(0, 0, cv.width, cv.height, 6);
    ctx.fillStyle = 'rgba(8,12,15,0.72)';
    ctx.fill();
    ctx.clip();

    ctx.translate(C, C);
    ctx.rotate(theta);
    ctx.scale(s, s);
    ctx.translate(-p.pos.x, -p.pos.z);
    ctx.drawImage(this.radarBase, -1700, -1700, 3400, 3400);
    ctx.restore();

    const proj = (wx, wz) => {
      const dx = wx - p.pos.x, dz = wz - p.pos.z;
      return [
        C + (dx * Math.cos(theta) - dz * Math.sin(theta)) * s,
        C + (dx * Math.sin(theta) + dz * Math.cos(theta)) * s,
      ];
    };

    // site letters (kept upright)
    ctx.font = 'bold 15px Segoe UI, Arial';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(220,185,90,0.95)';
    for (const [letter, wx, wz] of [['A', 925, -200], ['B', -925, -300]]) {
      const [x, y] = proj(wx, wz);
      if (x > 8 && x < cv.width - 8 && y > 8 && y < cv.height - 8) ctx.fillText(letter, x, y);
    }

    const drawBlip = (wx, wz, since, color) => {
      if (since > 2.2) return;
      const [x, y] = proj(wx, wz);
      if (x < 4 || x > cv.width - 4 || y < 4 || y > cv.height - 4) return;
      ctx.globalAlpha = clamp(1.3 - since / 2, 0, 1);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, 7);
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    // spotted enemies (bots)
    for (const b of game.bots.bots) {
      if (!b.alive) continue;
      drawBlip(b.pos.x, b.pos.z, game.time - Math.max(b.spottedT, b.pingT), '#e03c3c');
    }
    // remote players
    if (game.online) {
      for (const r of game.remotes.remotes.values()) {
        if (!r.alive) continue;
        drawBlip(r.pos.x, r.pos.z, game.time - r.spottedT, '#5ca8ff');
      }
    }
    // zombies — shown so the squad can read the horde closing from every side
    // (stalkers stay off radar — you have to spot them).
    if (game.matchMode === 'zombies') {
      for (const z of game.zombies.zombies.values()) {
        if (!z.alive || z.type === 'stalker') continue;
        const col = z.type === 'brute' ? '#d14a2a' : z.type === 'bomber' ? '#ff7a10' : z.type === 'summoner' ? '#b060ff' : '#7bd64a';
        drawBlip(z.pos.x, z.pos.z, 0, col);
      }
    }

    // view cone + player arrow
    ctx.save();
    ctx.translate(C, C);
    const cone = ctx.createRadialGradient(0, 0, 2, 0, 0, 46);
    cone.addColorStop(0, 'rgba(255,255,255,0.22)');
    cone.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cone;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 46, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -6); ctx.lineTo(4.4, 5); ctx.lineTo(0, 2.4); ctx.lineTo(-4.4, 5);
    ctx.fill();
    ctx.restore();
  }

  // ---------- damage indicators ----------
  showDamageFrom(angle) { // angle relative to view: 0 = ahead, + = right
    const d = document.createElement('div');
    d.className = 'hitdir';
    d.style.transform = `rotate(${angle}rad)`;
    this.el('hitRing').appendChild(d);
    this.hitDirs.push({ d, t: 0 });
    this.dmgFlashV = Math.min(1, this.dmgFlashV + 0.55);
  }

  // ---------- center messages ----------
  centerMsg(text, dur = 2.2) {
    const el = this.el('centerMsg');
    el.textContent = text;
    el.style.opacity = 1;
    clearTimeout(this._cmT);
    this._cmT = setTimeout(() => { el.style.opacity = 0; }, dur * 1000);
  }

  setTarget(name) {
    const el = this.el('targetName');
    el.textContent = name || '';
  }

  // ---------- buy menu ----------
  buildBuyMenu() {
    const cats = [
      ['PISTOLS', ['usp', 'deagle']],
      ['SMG', ['mp9']],
      ['RIFLES', ['ak', 'm4']],
      ['HEAVY', ['nova', 'm249']],
      ['SNIPER', ['awp']],
      ['GEAR', ['armor']],
    ];
    let key = 1;
    const cols = cats.map(([cat, items]) => {
      const cards = items.map(id => {
        const isArmor = id === 'armor';
        const name = isArmor ? 'Kevlar + Helmet' : WEAPONS[id].name;
        const price = isArmor ? 1000 : WEAPONS[id].price;
        const icon = isArmor
          ? '<svg viewBox="0 0 64 24" class="wicon"><path d="M32 2l12 4v7c0 6-5 9-12 11-7-2-12-5-12-11V6z"/></svg>'
          : weaponIcon(id);
        return `<button class="buy-item" data-id="${id}" data-key="${key}">
          <span class="bkey">${key++}</span>${icon}
          <span class="bname">${name}</span>
          <span class="bprice">$${price}</span>
        </button>`;
      }).join('');
      return `<div class="buy-col"><h3>${cat}</h3>${cards}</div>`;
    }).join('');
    this.el('buyCols').innerHTML = cols;
    this.el('buy').addEventListener('click', (e) => {
      const btn = e.target.closest('.buy-item');
      if (btn) this.game.buyItem(btn.dataset.id);
    });
  }

  buyKey(digit) {
    const btn = document.querySelector(`.buy-item[data-key="${digit}"]`);
    if (btn) this.game.buyItem(btn.dataset.id);
  }

  setBuyOpen(open) {
    this.buyOpen = open;
    this.el('buy').classList.toggle('hidden', !open);
  }

  // ---------- scoreboard ----------
  showScoreboard(show) {
    const sb = this.el('scoreboard');
    sb.classList.toggle('hidden', !show);
    if (!show) return;
    const game = this.game;
    const rows = [
      { name: 'YOU', k: game.score, d: game.deaths, ping: game.online ? game.net.ping : 7, you: true },
      ...(game.online
        ? [...game.remotes.remotes.values()].map(r => ({ name: r.name, k: r.kills, d: r.deaths, ping: r.ping }))
        : []),
      ...game.bots.bots.map(b => ({ name: b.name, k: b.kills, d: b.deaths, ping: b.ping })),
    ].sort((a, b) => b.k - a.k);
    this.el('sbRows').innerHTML = rows.map(r =>
      `<div class="sb-row${r.you ? ' you' : ''}"><span class="n">${r.name}</span><span>${r.k}</span><span>${r.d}</span><span>${r.ping}</span></div>`
    ).join('');
  }

  // ---------- death / end ----------
  showDeath(killerName, weaponId) {
    this.el('deathBy').innerHTML = `You were killed by <b>${killerName}</b> ${weaponId ? weaponIcon(weaponId) : ''}`;
    let idx;
    do { idx = Math.floor(Math.random() * DEATH_TIPS.length); } while (idx === this.lastTipIdx);
    this.lastTipIdx = idx;
    this.el('deathTip').textContent = 'TIP: ' + DEATH_TIPS[idx];
    this.el('death').classList.remove('hidden');
  }
  setDeathTimer(t) {
    this.el('deathTimer').textContent = typeof t === 'string' ? t : `Respawning in ${Math.ceil(t)}…`;
  }
  hideDeath() { this.el('death').classList.add('hidden'); }

  setScope(on) { this.el('scope').classList.toggle('hidden', !on); }

  update(dt) {
    // killfeed aging
    for (let i = this.feed.length - 1; i >= 0; i--) {
      const f = this.feed[i];
      f.t += dt;
      if (f.t > 5) { f.div.remove(); this.feed.splice(i, 1); }
      else if (f.t > 4) f.div.style.opacity = (5 - f.t);
    }
    // damage direction arcs
    for (let i = this.hitDirs.length - 1; i >= 0; i--) {
      const h = this.hitDirs[i];
      h.t += dt;
      if (h.t > 1.1) { h.d.remove(); this.hitDirs.splice(i, 1); }
      else h.d.style.opacity = 1 - h.t / 1.1;
    }
    // red screen flash
    if (this.dmgFlashV > 0) {
      this.dmgFlashV = Math.max(0, this.dmgFlashV - dt * 2.4);
      this.el('dmgFlash').style.opacity = this.dmgFlashV * 0.45;
    }
    if (this.game.state === 'playing' || this.game.state === 'dead') this.drawRadar();
  }
}
