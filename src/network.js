// WebSocket client for online deathmatch.
import * as THREE from 'three';

export class NetworkClient {
  constructor(game) {
    this.game = game;
    this.ws = null;
    this.id = null;
    this.connected = false;
    this.joined = false;
    this.ping = 0;
    this.stateAcc = 0;
    this.pingAcc = 0;
    this.onStatus = null;
    this.selfState = null;
    this.mode = 'deathmatch';
  }

  setStatus(text) {
    if (this.onStatus) this.onStatus(text);
  }

  connect(name, mode = 'deathmatch') {
    return new Promise((resolve, reject) => {
      this.mode = mode;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}`;
      this.setStatus('Connecting…');
      this.ws = new WebSocket(url);

      const fail = (msg) => {
        this.setStatus(msg);
        reject(new Error(msg));
      };

      this.ws.onopen = () => {
        this.connected = true;
        this.setStatus('Joining match…');
        this.send({ t: 'join', name, mode });
      };

      this.ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this.handle(msg, resolve, fail);
      };

      this.ws.onerror = () => fail('Connection failed');
      this.ws.onclose = () => {
        this.connected = false;
        this.joined = false;
        if (this.game.online) {
          this.setStatus('Disconnected');
          this.game.disconnectOnline('Lost connection to server.');
        }
      };
    });
  }

  send(msg) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  rememberSelf(data) {
    if (!data) return;
    this.selfState = data;
    if (!this.game.online) return;
    this.game.score = data.kills ?? this.game.score;
    this.game.deaths = data.deaths ?? this.game.deaths;
    if (data.points != null) { this.game.points = data.points; this.game.hud.setPoints(data.points); }
    this.game.hud.setScores(this.game.score, this.game.topOpponentScore());
  }

  handle(msg, resolveJoin, rejectJoin) {
    const g = this.game;
    switch (msg.t) {
      case 'welcome':
        this.id = msg.id;
        this.mode = msg.mode || 'deathmatch';
        this.joined = true;
        g.world.setMapVariant(!!msg.mapVariant);
        this.rememberSelf(msg.you);
        this.setStatus('Connected');
        for (const p of msg.players) g.remotes.add(p.id, p.name, p);
        if (this.mode === 'zombies') {
          g.zombies.syncAll(msg.zombies || []);
          g.zombieState = msg.zombieState || g.zombieState;
          g.loot.syncAll(msg.loot || []);
          g.syncBarricades(msg.barricades || []);
        }
        if (msg.matchActive) g.timeLeft = msg.timeLeft;
        resolveJoin();
        break;
      case 'error':
        rejectJoin(msg.msg);
        this.ws?.close();
        break;
      case 'player_join':
        g.remotes.add(msg.player.id, msg.player.name, msg.player);
        break;
      case 'player_leave':
        g.remotes.remove(msg.id);
        break;
      case 'snapshot':
        g.timeLeft = msg.timeLeft;
        this.mode = msg.mode || this.mode;
        this.rememberSelf(msg.players.find(p => p.id === this.id));
        g.remotes.syncAll(msg.players.filter(p => p.id !== this.id));
        if (this.mode === 'zombies') {
          g.zombies.syncAll(msg.zombies || []);
          g.zombieState = msg.zombieState || g.zombieState;
          g.updateZombieHud();
        }
        break;
      case 'match_start':
        this.mode = msg.mode || this.mode;
        g.world.setMapVariant(!!msg.mapVariant);
        g.timeLeft = msg.timeLeft;
        this.rememberSelf(msg.players.find(p => p.id === this.id));
        if (g.online && this.selfState) g.applyServerPlayerState(this.selfState);
        g.remotes.syncAll(msg.players.filter(p => p.id !== this.id));
        if (this.mode === 'zombies') {
          g.zombies.syncAll(msg.zombies || []);
          g.zombieState = msg.zombieState || g.zombieState;
          g.updateZombieHud();
        }
        g.hud.centerMsg(this.mode === 'zombies' ? 'ZOMBIE CO-OP' : 'GO GO GO!', 2);
        g.audio.play('go');
        break;
      case 'match_end':
        g.endOnlineMatch(msg.board);
        break;
      case 'fire': {
        const shooter = g.remotes.get(msg.fromId);
        if (!shooter) break;
        const origin = new THREE.Vector3(...msg.origin);
        const dir = new THREE.Vector3(...msg.dir).normalize();
        const muzzle = msg.muzzle ? new THREE.Vector3(...msg.muzzle) : origin;
        g.audio.play('shot_' + msg.weapon, origin);
        g.effects.muzzleFlash(muzzle, 0.8);
        const wall = g.world.raycast(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, 4096);
        const end = wall
          ? origin.clone().addScaledVector(dir, wall.t)
          : origin.clone().addScaledVector(dir, 4000);
        g.effects.tracer(muzzle, end);
        if (wall) {
          g.effects.impact(end, { x: wall.nx, y: wall.ny, z: wall.nz });
          g.audio.play('impact', end);
        }
        break;
      }
      case 'kill': {
        const meKiller = msg.killerId === this.id;
        const meVictim = msg.victimId === this.id;
        g.hud.addKill(msg.killerName, msg.weapon, msg.victimName, msg.hs, meKiller || meVictim);
        if (meKiller) {
          g.score = msg.kills;
          g.hud.setScores(g.score, g.topOpponentScore());
        }
        const killer = g.remotes.get(msg.killerId);
        if (killer) killer.kills = msg.kills;
        const victim = g.remotes.get(msg.victimId);
        if (victim) { victim.alive = false; victim.deadT = 0; }
        break;
      }
      case 'damage':
        if (msg.fromPos) {
          const from = new THREE.Vector3(...msg.fromPos);
          const yawA = Math.atan2(-(from.x - g.player.pos.x), -(from.z - g.player.pos.z));
          g.hud.showDamageFrom(g.player.yaw - yawA);
        } else if (msg.fromId) {
          const from = g.remotes.get(msg.fromId);
          if (from) {
            const yawA = Math.atan2(-(from.pos.x - g.player.pos.x), -(from.pos.z - g.player.pos.z));
            g.hud.showDamageFrom(g.player.yaw - yawA);
          }
        }
        g.hp = msg.hp;
        g.armor = msg.armor;
        g.hud.setHealth(g.hp);
        g.hud.setArmor(g.armor);
        g.audio.play('hit');
        break;
      case 'you_died':
        g.killPlayerRemote(msg.killerName, msg.weapon);
        break;
      case 'respawn':
        g.respawnFromServer(msg.x, msg.y, msg.z);
        break;
      case 'player_respawn': {
        const r = g.remotes.get(msg.id);
        if (r) {
          r.alive = true;
          r.pos.set(msg.x, msg.y, msg.z);
          r.targetPos.set(msg.x, msg.y, msg.z);
          r.group.visible = true;
        }
        break;
      }
      case 'player_hit': {
        const r = g.remotes.get(msg.id);
        if (r) { r.hp = msg.hp; r.armor = msg.armor; r.flashHit(); }
        break;
      }
      case 'you_downed':
        g.goDown(msg.bleedout, msg.by);
        break;
      case 'player_down': {
        const r = g.remotes.get(msg.id);
        if (r) r.down = true;
        break;
      }
      case 'player_revived': {
        if (msg.id === this.id) g.reviveSelf(msg.hp);
        else { const r = g.remotes.get(msg.id); if (r) r.down = false; }
        delete g.reviveProgById[msg.id];
        break;
      }
      case 'revive_progress':
        g.reviveProgById[msg.id] = msg.prog;
        if (msg.id === this.id) g.hud.setReviveSelf(msg.prog);
        break;
      case 'zombie_spawn':
        g.zombies.add(msg.zombie);
        g.zombieState = msg.zombieState || g.zombieState;
        g.updateZombieHud();
        break;
      case 'zombie_hit':
        g.zombies.flash(msg.id, msg.hp);
        g.zombieState = msg.zombieState || g.zombieState;
        g.updateZombieHud();
        break;
      case 'zombie_kill': {
        const meKiller = msg.killerId === this.id;
        g.zombies.remove(msg.id);
        if (meKiller) {
          g.score = msg.kills;
          g.audio.play('kill');
        }
        g.hud.addKill(msg.killerName, 'ak', msg.name || 'Zombie', false, meKiller);
        g.zombieState = msg.zombieState || g.zombieState;
        g.updateZombieHud();
        break;
      }
      case 'zombie_attack':
        g.zombies.flash(msg.id);
        break;
      case 'zombie_round_start':
        g.zombieState = msg.zombieState || g.zombieState;
        g.remotes.syncAll((msg.players || []).filter(p => p.id !== this.id));
        g.updateZombieHud();
        g.hud.centerMsg(`ROUND ${g.zombieState.round}`, 2);
        g.arsenal.refillAll();
        g.refillNades();
        g.hud.refreshAmmo();
        g.syncBarricades(msg.barricades || []);
        break;
      case 'zombie_round_clear':
        g.zombieState = msg.zombieState || g.zombieState;
        g.remotes.syncAll((msg.players || []).filter(p => p.id !== this.id));
        g.zombies.clear();
        g.updateZombieHud();
        g.hud.centerMsg(`ROUND ${g.zombieState.round} CLEAR`, 2.4);
        break;
      case 'buy_ok':
        g.points = msg.points;
        g.hud.setPoints(g.points);
        if (msg.ammoOnly) {
          g.arsenal.refillWeapon(msg.item);
          g.hud.refreshAmmo();
          g.audio.play('magin');
          g.hud.centerMsg(`${msg.label || 'Ammo'} refilled`, 1.2);
        } else {
          if (msg.item === 'armor') { g.armor = 100; g.hud.setArmor(100); }
          else { g.arsenal.give(msg.item); g.hud.refreshAmmo(); }
          g.audio.play('buy');
          g.hud.centerMsg(`Bought ${msg.label || msg.item}`, 1.4);
        }
        break;
      case 'buy_fail':
        g.points = msg.points;
        g.hud.setPoints(g.points);
        g.audio.play('click');
        g.hud.centerMsg('Not enough points', 1.2);
        break;
      case 'loot_spawn':
        g.loot.add(msg.loot);
        break;
      case 'loot_taken':
        g.loot.remove(msg.id);
        break;
      case 'loot_grant':
        g.arsenal.refillAll();
        g.hud.refreshAmmo();
        g.audio.play('magin');
        g.hud.centerMsg('+ AMMO', 1);
        break;
      case 'barricade_hp':
        g.setBarricadeHp(msg.id, msg.hp);
        break;
      case 'barricade_down':
        g.setBarricadeHp(msg.id, 0);
        g.audio.play('impact');
        break;
      case 'barricade_up':
        g.setBarricadeHp(msg.id, 1);
        break;
      case 'fx_explode': {
        const pos = new THREE.Vector3(...msg.pos);
        g.effects.explosion(pos, 1.3);
        g.audio.play('explosion', pos);
        break;
      }
      case 'fx_fire': {
        const pos = new THREE.Vector3(...msg.pos);
        g.effects.explosion(pos, 0.8);
        g.audio.play('explosion', pos);
        g.grenades.addFire(pos, msg.dur || 5, false);
        break;
      }
      case 'pong':
        this.ping = Math.round(performance.now() - msg.ts);
        break;
      default:
        break;
    }
  }

  sendState() {
    if (!this.joined) return;
    const p = this.game.player;
    this.send({
      t: 'state',
      x: p.pos.x, y: p.pos.y, z: p.pos.z,
      yaw: p.yaw, pitch: p.pitch,
      hp: this.game.hp, armor: this.game.armor,
      alive: this.game.state !== 'dead',
      weapon: this.game.arsenal.def?.id ?? 'ak',
      ping: this.ping,
    });
  }

  sendFire(def, origin, dir, muzzlePos) {
    this.send({
      t: 'fire',
      weapon: def.id,
      origin: [origin.x, origin.y, origin.z],
      dir: [dir.x, dir.y, dir.z],
      muzzle: muzzlePos ? [muzzlePos.x, muzzlePos.y, muzzlePos.z] : null,
    });
  }

  sendHit(targetId, dmg, part, armorPen) {
    this.send({ t: 'hit', targetId, dmg, part, armorPen });
  }

  sendMelee(targetId, dmg, part) {
    this.send({ t: 'melee', targetId, dmg, part });
  }

  sendZombieHit(targetId, dmg, part) {
    this.send({ t: 'zombie_hit', targetId, dmg, part });
  }

  update(dt) {
    if (!this.joined) return;
    this.stateAcc += dt;
    this.pingAcc += dt;
    if (this.stateAcc >= 0.05) {
      this.stateAcc = 0;
      this.sendState();
      if (this.game.reviving && this.game.reviveTarget) this.send({ t: 'revive', id: this.game.reviveTarget.id });
      if (this.game.repairing && this.game.repairTarget != null) this.send({ t: 'repair', id: this.game.repairTarget });
    }
    if (this.pingAcc >= 2) {
      this.pingAcc = 0;
      this.send({ t: 'ping', ts: performance.now() });
    }
  }

  disconnect() {
    this.ws?.close();
    this.ws = null;
    this.connected = false;
    this.joined = false;
  }
}
