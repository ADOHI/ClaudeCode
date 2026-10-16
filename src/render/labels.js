// HTML 라벨: 화면 투영 + 겹침 회피(그리드 점유) + 거리 기반 우선순위.
import * as THREE from 'three';

export class Labels {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.className = 'labels';
    container.appendChild(this.root);
    this.pool = [];
    this.v = new THREE.Vector3();
  }

  _get(i) {
    while (this.pool.length <= i) {
      const el = document.createElement('div');
      el.className = 'lbl';
      this.root.appendChild(el);
      this.pool.push({ el, text: '', cls: '' });
    }
    return this.pool[i];
  }

  /** items: [{x,y,z,text,cls,pri,maxDist}] */
  update(camera, items, w, h) {
    const cand = [];
    const cp = camera.position;
    for (const it of items) {
      const d = Math.hypot(it.x - cp.x, it.y - cp.y, it.z - cp.z);
      if (it.maxDist && d > it.maxDist) continue;
      this.v.set(it.x, it.y, it.z).project(camera);
      if (this.v.z > 1 || this.v.z < -1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) continue;
      cand.push({ it, sx: (this.v.x * 0.5 + 0.5) * w, sy: (-this.v.y * 0.5 + 0.5) * h, d, score: (it.pri || 0) * 1000 - d });
    }
    cand.sort((a, b) => b.score - a.score);
    const placed = [];
    let n = 0;
    for (const c of cand) {
      if (n >= 80) break;
      // 한글은 전각에 가깝게, 나머지는 반각으로 폭 추정
      const fs = c.it.cls && c.it.cls.startsWith('district') ? 19 : 11.5;
      let em = 0;
      for (const ch of c.it.text) em += /[\u3131-\uD79D]/.test(ch) ? 1.0 : 0.58;
      const tw = em * fs + (fs > 15 ? 24 : 16), th = fs + (fs > 15 ? 12 : 8);
      const r = { x0: c.sx - tw / 2 - 3, x1: c.sx + tw / 2 + 3, y0: c.sy - th - 2, y1: c.sy + 2 };
      if (placed.some((q) => r.x0 < q.x1 && q.x0 < r.x1 && r.y0 < q.y1 && q.y0 < r.y1)) continue;
      placed.push(r);
      const p = this._get(n++);
      if (p.text !== c.it.text) { p.el.textContent = c.it.text; p.text = c.it.text; }
      const cls = 'lbl ' + (c.it.cls || '');
      if (p.cls !== cls) { p.el.className = cls; p.cls = cls; }
      p.el.style.transform = `translate(${c.sx.toFixed(1)}px, ${c.sy.toFixed(1)}px) translate(-50%, -100%)`;
      p.el.style.display = '';
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].el.style.display = 'none';
  }

  clear() {
    for (const p of this.pool) p.el.style.display = 'none';
  }
}
