// 탐험 모드: 3인칭 학생 캐릭터 + 2층 높이장 충돌 + 점프/매달려 오르기/사다리 + 수집/열쇠/문.
import * as THREE from 'three';
import { buildCollision, supportAt } from '../core/collision.js';
import { hideEntity } from '../render/world.js';

const STEP = 0.6, RADIUS = 0.35, HEIGHT = 1.7, GRAV = 22, JUMP = 8.4, MANTLE = 3.6;
const WALK = 4.6, RUN = 8.2;

export class Explorer {
  constructor(app) {
    this.app = app;
    this.ctx = app.ctx;
    this.col = buildCollision(this.ctx);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0.25;
    this.dist = 6.5;
    this.grounded = true;
    this.keys = {};
    this.inventory = { keys: new Set(), secrets: new Set(), coins: 0 };
    this.discovered = new Set();
    this.anim = null; // 사다리/매달리기 애니메이션
    this.firstPerson = false;
    this.lastDistrict = -1;
    this.mesh = makeStudent();
    app.scene.add(this.mesh);
    this.ladders = this.ctx.entities.filter((e) => !e.deleted && e.climb);
    this.collectibles = [];
    for (const s of this.ctx.secrets) this.collectibles.push({ kind: 'secret', x: s.x, y: s.y, z: s.z, ref: s });
    for (const e of this.ctx.entities) {
      if (e.deleted) continue;
      if (e.kind === 'key') this.collectibles.push({ kind: 'key', x: e.x, y: 0, z: e.z, ref: e });
      if (e.coin) this.collectibles.push({ kind: 'coin', x: e.x, y: e.y - 0.5, z: e.z, ref: e });
    }
    this.gates = (this.ctx.gates2 || []).map((g) => ({ ...g, open: false }));
    this.touch = { mx: 0, mz: 0, active: false };
  }

  spawn(x, z) {
    // 걸을 수 있는 가장 가까운 지점
    const c = this.col;
    let best = null;
    for (let r = 0; r < 40 && !best; r++) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r, pz = z + Math.sin((a / 16) * Math.PI * 2) * r;
        const i = Math.floor(px + c.H), j = Math.floor(pz + c.H);
        if (i < 1 || j < 1 || i >= c.N - 1 || j >= c.N - 1) continue;
        const id = j * c.N + i;
        if (c.blocked[id] || c.floor[id] > 0.6) continue;
        best = [px, pz];
        break;
      }
    }
    if (!best) best = [0, 40];
    this.pos.set(best[0], 0.01, best[1]);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-best[1], -best[0]) + Math.PI; // 중앙탑을 등지지 않게
  }

  cellAt(x, z) {
    const c = this.col;
    const i = Math.floor(x + c.H), j = Math.floor(z + c.H);
    if (i < 0 || j < 0 || i >= c.N || j >= c.N) return -1;
    return j * c.N + i;
  }

  // 이동 가능한가? (벽 높이도 반환)
  probe(x, z, y) {
    const c = this.col;
    let wallTop = -1e9, hard = false;
    for (const [ox, oz] of [[0, 0], [RADIUS, 0], [-RADIUS, 0], [0, RADIUS], [0, -RADIUS]]) {
      const id = this.cellAt(x + ox, z + oz);
      if (id < 0) return { ok: false, hard: true };
      if (c.blocked[id] === 1) return { ok: false, hard: true };
      const f = c.floor[id];
      if (f > y + STEP) { wallTop = Math.max(wallTop, f); if (c.blocked[id] === 2) hard = true; }
      if (c.deckB[id] < y + HEIGHT && c.deckT[id] > y + STEP) { wallTop = Math.max(wallTop, c.deckT[id]); }
    }
    return { ok: wallTop === -1e9, wallTop, hard };
  }

  update(dt, camera) {
    dt = Math.min(dt, 0.05);
    const k = this.keys;
    if (this.anim) {
      this.anim.t += dt;
      const a = this.anim;
      const t = Math.min(1, a.t / a.dur);
      this.pos.lerpVectors(a.from, a.to, a.ease ? t * t * (3 - 2 * t) : t);
      if (t >= 1) {
        if (a.next) { const n = a.next; this.anim = { ...n, t: 0, from: this.pos.clone() }; }
        else { this.anim = null; this.vel.set(0, 0, 0); this.grounded = true; }
      }
    } else {
      // 입력
      let fx = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
      let sx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
      if (this.touch.active) { fx = -this.touch.mz; sx = this.touch.mx; }
      const len = Math.hypot(fx, sx);
      const speed = k.ShiftLeft || k.ShiftRight || this.touch.run ? RUN : WALK;
      let mx = 0, mz = 0;
      if (len > 0.01) {
        const fwdX = -Math.sin(this.yaw), fwdZ = -Math.cos(this.yaw);
        const rgtX = Math.cos(this.yaw), rgtZ = -Math.sin(this.yaw);
        mx = ((fwdX * fx + rgtX * sx) / Math.max(1, len)) * speed;
        mz = ((fwdZ * fx + rgtZ * sx) / Math.max(1, len)) * speed;
        this.facing = Math.atan2(mx, mz);
      }
      const accel = this.grounded ? 14 : 4;
      this.vel.x += (mx - this.vel.x) * Math.min(1, accel * dt);
      this.vel.z += (mz - this.vel.z) * Math.min(1, accel * dt);
      if ((k.Space || this.touch.jump) && this.grounded) {
        this.vel.y = JUMP;
        this.grounded = false;
        this.touch.jump = false;
      }
      // 수평 이동 (축 분리 + 서브스텝)
      const dist = Math.hypot(this.vel.x, this.vel.z) * dt;
      const steps = Math.max(1, Math.ceil(dist / 0.25));
      let mantleTry = null;
      for (let s = 0; s < steps; s++) {
        const dx = (this.vel.x * dt) / steps, dz = (this.vel.z * dt) / steps;
        let p = this.probe(this.pos.x + dx, this.pos.z, this.pos.y);
        if (p.ok) this.pos.x += dx; else { if (!p.hard) mantleTry = p; this.vel.x *= 0.2; }
        p = this.probe(this.pos.x, this.pos.z + dz, this.pos.y);
        if (p.ok) this.pos.z += dz; else { if (!p.hard) mantleTry = mantleTry || p; this.vel.z *= 0.2; }
      }
      // 매달려 오르기: 점프 중 벽 상단이 손 닿는 높이면 올라선다
      if (mantleTry && (!this.grounded || k.Space) && mantleTry.wallTop - this.pos.y <= MANTLE && mx * mx + mz * mz > 0.1) {
        const top = mantleTry.wallTop;
        const dirx = Math.sin(this.facing || 0), dirz = Math.cos(this.facing || 0);
        const tx = this.pos.x + dirx * 0.9, tz = this.pos.z + dirz * 0.9;
        const p = this.probe(tx, tz, top + 0.05);
        if (p.ok) {
          this.anim = { t: 0, dur: 0.22, from: this.pos.clone(), to: new THREE.Vector3(this.pos.x, top + 0.05, this.pos.z), next: { dur: 0.14, to: new THREE.Vector3(tx, top + 0.05, tz) } };
          this.app.toast('매달려 오르기', 'hint', 600);
        }
      }
      // 수직
      const sup = supportAt(this.col, this.pos.x, this.pos.z, this.pos.y, STEP);
      if (this.vel.y > 0 || this.pos.y > sup + 0.02) {
        this.vel.y -= GRAV * dt;
        this.pos.y += this.vel.y * dt;
        const sup2 = supportAt(this.col, this.pos.x, this.pos.z, this.pos.y + 0.3, 0.3);
        if (this.vel.y <= 0 && this.pos.y <= sup2) { this.pos.y = sup2; this.vel.y = 0; this.grounded = true; }
        else this.grounded = false;
        // 머리 위 데크
        const id = this.cellAt(this.pos.x, this.pos.z);
        if (id >= 0 && this.vel.y > 0 && this.col.deckB[id] < this.pos.y + HEIGHT && this.col.deckB[id] > this.pos.y) { this.vel.y = 0; }
      } else {
        this.pos.y = sup;
        this.vel.y = 0;
        this.grounded = true;
      }
      if (this.pos.y < -5) this.spawn(this.pos.x, this.pos.z);
    }
    this.interact(dt);
    // 캐릭터
    this.mesh.position.copy(this.pos);
    if (this.facing !== undefined) this.mesh.rotation.y = this.facing;
    this.mesh.visible = !this.firstPerson;
    const halo = this.mesh.userData.halo;
    if (halo) { halo.rotation.z += dt * 0.8; halo.position.y = 2.05 + Math.sin(performance.now() / 500) * 0.04; }
    // 카메라
    const head = new THREE.Vector3(this.pos.x, this.pos.y + 1.55, this.pos.z);
    if (this.firstPerson) {
      camera.position.copy(head);
      camera.rotation.set(-this.pitch, this.yaw, 0, 'YXZ');
    } else {
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      let d = this.dist;
      // 카메라 충돌: 머리→카메라 선분이 높이장에 막히면 당긴다
      for (let t = 0.5; t <= this.dist; t += 0.4) {
        const x = head.x + Math.sin(this.yaw) * cp * t, z = head.z + Math.cos(this.yaw) * cp * t, y = head.y + sp * t;
        const id = this.cellAt(x, z);
        if (id >= 0 && (this.col.floor[id] > y - 0.2 || (this.col.deckB[id] < y + 0.2 && this.col.deckT[id] > y - 0.2))) { d = Math.max(0.6, t - 0.4); break; }
      }
      camera.position.set(head.x + Math.sin(this.yaw) * cp * d, head.y + sp * d, head.z + Math.cos(this.yaw) * cp * d);
      camera.lookAt(head);
    }
  }

  nearestLadder() {
    let best = null, bd = 1.8;
    for (const e of this.ladders) {
      const c = e.climb;
      const d = Math.hypot(c.x - this.pos.x, c.z - this.pos.z);
      if (d < bd) { bd = d; best = e; }
      // 지붕 위에서 사다리 꼭대기 근처
      const topX = c.x + c.nx * 1.0, topZ = c.z + c.nz * 1.0;
      if (Math.abs(this.pos.y - c.top) < 1.2 && Math.hypot(topX - this.pos.x, topZ - this.pos.z) < 1.8) { best = e; bd = 0; }
    }
    return best;
  }

  interact() {
    const app = this.app;
    let prompt = '';
    const lad = this.anim ? null : this.nearestLadder();
    const gate = this.gates.find((g) => !g.open && Math.hypot(g.x - this.pos.x, g.z - this.pos.z) < 2.6);
    if (lad) {
      const c = lad.climb;
      const onTop = Math.abs(this.pos.y - c.top) < 1.2;
      prompt = onTop ? 'E  사다리 내려가기' : `E  ${lad.name || '사다리'} 오르기`;
      if (this.keys.KeyE || this.touch.use) {
        this.keys.KeyE = false; this.touch.use = false;
        const base = new THREE.Vector3(c.x - c.nx * 0.6, 0, c.z - c.nz * 0.6);
        base.y = Math.max(0, supportAt(this.col, base.x, base.z, 0.5, 0.6));
        const top = new THREE.Vector3(c.x + c.nx * 1.0, c.top + 0.05, c.z + c.nz * 1.0);
        const dur = Math.max(0.6, c.top / 9);
        if (onTop) this.anim = { t: 0, dur: 0.25, from: this.pos.clone(), to: new THREE.Vector3(c.x, c.top, c.z), next: { dur, to: base } };
        else this.anim = { t: 0, dur: 0.25, from: this.pos.clone(), to: new THREE.Vector3(c.x - c.nx * 0.3, this.pos.y, c.z - c.nz * 0.3), next: { dur, to: new THREE.Vector3(c.x, c.top, c.z), next: { dur: 0.2, to: top } } };
      }
    } else if (gate) {
      const has = this.inventory.keys.has(gate.id);
      prompt = has ? 'E  잠긴 철문 열기' : '잠긴 철문 — 이 구역 어딘가에 열쇠가 있다';
      if (has && (this.keys.KeyE || this.touch.use)) {
        this.keys.KeyE = false; this.touch.use = false;
        gate.open = true;
        const cells = this.col.gateCells.get(gate.id) || [];
        for (const id of cells) { this.col.floor[id] = 0; this.col.blocked[id] = 0; }
        const e = this.ctx.entities[gate.entity];
        hideEntity(app.world, e);
        app.toast('철문이 열렸다 — 안뜰로 들어갈 수 있다', 'good');
      }
    }
    app.setPrompt(prompt);
    // 수집
    for (const c of this.collectibles) {
      if (c.done) continue;
      if (Math.abs(c.x - this.pos.x) > 1.8 || Math.abs(c.z - this.pos.z) > 1.8) continue;
      if (Math.abs(c.y - this.pos.y) > 2.2) continue;
      c.done = true;
      if (c.kind === 'secret') {
        this.inventory.secrets.add(c.ref.id);
        for (const e of this.ctx.entities) if (e.secret === c.ref.id && e.cat === 'secret') hideEntity(app.world, e);
        app.toast(`발견! ${c.ref.name}  (${this.inventory.secrets.size}/${this.ctx.secrets.length})`, 'secret');
        app.onCollect(c.ref);
      } else if (c.kind === 'key') {
        this.inventory.keys.add(c.ref.keyFor);
        hideEntity(app.world, c.ref);
        app.toast('녹슨 열쇠를 얻었다 — 잠긴 철문을 찾아보자', 'good');
      } else {
        this.inventory.coins++;
        hideEntity(app.world, c.ref);
      }
      app.updateHud();
    }
    // POI 발견 / 구역 진입
    for (const p of this.ctx.pois) {
      if (p.deleted || this.discovered.has(p.id)) continue;
      if (Math.abs(p.x - this.pos.x) > 16 || Math.abs(p.z - this.pos.z) > 16) continue;
      this.discovered.add(p.id);
      if (p.tier <= 2 && p.type !== 'key') app.toast(`${p.name}`, 'poi', 1600);
    }
    const id = this.cellAt(this.pos.x, this.pos.z);
    const d = id >= 0 ? this.ctx.district.data[id] : 255;
    if (d !== 255 && d !== this.lastDistrict) {
      this.lastDistrict = d;
      app.districtBanner(this.ctx.districts[d]);
    }
  }

  dispose() {
    this.app.scene.remove(this.mesh);
  }
}

function makeStudent() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c });
  const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.45, 12), mat('#2b3a67'));
  skirt.position.y = 0.78;
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.1, 0.62, 8), mat('#f1d9c7'));
  legs.position.y = 0.31;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.55, 12), mat('#f4f6fb'));
  body.position.y = 1.18;
  const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.04), mat('#e0413b'));
  tie.position.set(0, 1.28, 0.22);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), mat('#f6e1d3'));
  head.position.y = 1.6;
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.225, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), mat('#e7b7d8'));
  hair.position.y = 1.62;
  hair.rotation.x = -0.25;
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.03, 0.55, 8), mat('#e7b7d8'));
  tail.position.set(0, 1.42, -0.2);
  tail.rotation.x = 0.4;
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.025, 8, 32), new THREE.MeshBasicMaterial({ color: '#ffd84d', toneMapped: false }));
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 2.05;
  for (const m of [skirt, legs, body, tie, head, hair, tail]) { m.castShadow = true; g.add(m); }
  g.add(halo);
  g.userData.halo = halo;
  return g;
}
