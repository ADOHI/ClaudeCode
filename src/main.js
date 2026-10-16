// 앱: 생성 → 씬 구축 → 조감(설계 검토) / 탐험(플레이 검증) 두 모드.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { generate, STAGES } from './core/generator.js';
import { RULES, DISTRICT_TYPES, SECRET_TYPES, WORLD } from './core/config.js';
import { PROGRAMS } from './core/buildings.js';
import { exportWorld } from './core/export.js';
import { PACING } from './core/intent.js';
import { makeGeometries, makeMaterials, buildWorldMeshes, highlightRule, entityMatrix, LAYER_GROUPS } from './render/world.js';
import { paintGround, paintOverlay, makeCanvas } from './render/ground.js';
import { Labels } from './render/labels.js';
import { Explorer } from './game/explore.js';

const $ = (s) => document.querySelector(s);
const TAGLINE = {
  center: '모든 대로가 모이는 곳. 스파이어의 헤일로 아래',
  commercial: '게임센터 불빛과 크레페 냄새의 상점가',
  residential: '빨래줄과 고양이, 조용한 골목의 기숙사 마을',
  trad_academy: '종탑과 장미 정원의 명문 여학원',
  tech_academy: '안테나와 서버 소음의 공과학원',
  free_academy: '낙서와 오토바이, 규칙 없는 자유학원',
  arts_academy: '노래하는 계단이 있는 예술학원',
  harbor: '컨테이너 미로와 갠트리 크레인의 항만',
  ruins: '공사가 멈춘 구시가지 — 숨을 곳이 많다',
  park: '세계수가 내려다보는 호수 공원',
};
const KIND_KO = {
  lamp: '가로등', lamplight: '가로등', tree: '가로수', sakura: '벚나무', trunk: '나무', bench: '벤치', vending: '자판기', car: '자동차',
  busstop: '버스정류장', container: '컨테이너', campuswall: '캠퍼스 담장', ladder: '사다리', plank: '판자 다리', lockgate: '잠긴 철문',
  key: '열쇠', coin: '루트 코인', crumb: '흔적', graffiti: '낙서', ac: '실외기', watertank: '물탱크', stairhut: '옥상 계단실',
  billboard: '옥상 광고판', antenna: '안테나', solar: '태양광 패널', rooffence: '옥상 펜스', track: '모노레일 궤도', pillar: '교각',
  platform: '승강장', stairs: '역 계단', barricade: '바리케이드', checkpoint: '검문소', signpost: '방향 표지판', signplate: '표지판',
  torii: '도리이', hokora: '작은 사당', vantage: '전망 포인트', secretmark: '비밀', awning: '차양', sign: '간판', tallsign: '세로 간판',
  door: '출입구', fence: '공사장 펜스', frame: '철골', slab: '슬래브', rubble: '잔해', pier: '부두', laundryline: '빨래줄', cloth: '빨래',
  arcaderoof: '아케이드 지붕', lantern: '등불', cat: '고양이', school: '교사', gym: '체육관',
};

class App {
  constructor() {
    this.container = $('#stage');
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 6000);
    // 세로 화면에서는 섬 전체가 들어오도록 더 멀리
    const portrait = this.container.clientWidth < this.container.clientHeight;
    this.camera.position.set(portrait ? 700 : 520, portrait ? 980 : 560, portrait ? 900 : 640);
    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = 1.42;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 1500;
    this.controls.screenSpacePanning = false;
    this.labels = new Labels($('#stage'));
    this.geos = makeGeometries();
    this.mats = makeMaterials();
    this.layers = { building: true, prop: true, rail: true, landmark: true, gameplay: true, secret: true, crumb: true, pins: true, routes: true, labels: true };
    this.overlay = 'none';
    this.mode = 'map';
    this.selected = null;
    this.clock = new THREE.Clock();
    this.setupScene();
    this.bindUI();
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.loop();
  }

  setupScene() {
    const s = this.scene;
    // 하늘: 서브컬쳐 톤의 파스텔 그라데이션
    const sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { top: { value: new THREE.Color('#6fb2ff') }, mid: { value: new THREE.Color('#bfe0ff') }, bot: { value: new THREE.Color('#ffe8f1') } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.12 ? mix(mid, top, smoothstep(0.12, 0.7, h)) : mix(bot, mid, smoothstep(-0.05, 0.12, h)); gl_FragColor = vec4(c, 1.0); }',
    }));
    s.add(sky);
    s.fog = new THREE.Fog('#dcecff', 700, 2600);
    s.add(new THREE.HemisphereLight('#e4f0ff', '#e6d9c3', 1.05));
    const sun = new THREE.DirectionalLight('#fff4e2', 1.65);
    sun.position.set(-260, 420, 180);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -230; sc.right = 230; sc.top = 230; sc.bottom = -230; sc.near = 10; sc.far = 1200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.6;
    s.add(sun);
    s.add(sun.target);
    this.sun = sun;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000), new THREE.MeshLambertMaterial({ color: '#79c0e8' }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.6;
    s.add(sea);
    this.selBox = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), new THREE.LineBasicMaterial({ color: '#ff3d6e', depthTest: false }));
    this.selBox.renderOrder = 10;
    this.selBox.visible = false;
    s.add(this.selBox);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  // ---------- 생성 ----------
  async regenerate(seed) {
    if (this.busy) return;
    this.busy = true;
    if (this.mode === 'explore') this.setMode('map');
    $('#seed').value = seed;
    try { localStorage.setItem('academy-city-seed', seed); } catch (e) { /* 저장 불가 환경 */ }
    const load = $('#loading');
    load.hidden = false;
    const list = $('#stages');
    list.innerHTML = '';
    const t0 = performance.now();
    const density = +($('#density').value || 1);
    const ctx = await generate(seed, async (key, label, i, n) => {
      const prev = list.lastElementChild;
      if (prev) prev.classList.add('done');
      const li = document.createElement('li');
      li.textContent = label;
      list.appendChild(li);
      $('#loadbar').style.width = `${(i / n) * 100}%`;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    }, { density });
    $('#loadbar').style.width = '100%';
    this.ctx = ctx;
    this.buildScene();
    this.fillPanels();
    load.hidden = true;
    this.busy = false;
    this.toast(`시드 "${seed}" 생성 완료 · ${(performance.now() - t0).toFixed(0)}ms · 비밀 ${ctx.secrets.length}개`, 'good');
  }

  buildScene() {
    const ctx = this.ctx;
    for (const k of ['worldRoot', 'ground', 'overlayMesh', 'pins', 'routeLines']) {
      if (this[k]) { this.scene.remove(this[k]); this[k] = null; }
    }
    this.world = buildWorldMeshes(ctx, this.geos, this.mats);
    this.worldRoot = this.world.root;
    this.scene.add(this.worldRoot);
    // 지면
    const gc = paintGround(ctx, 2);
    this.groundCanvas = gc;
    const mini = makeCanvas(512, 512);
    mini.getContext('2d').drawImage(gc, 0, 0, 512, 512);
    this.miniBase = mini;
    const tex = new THREE.CanvasTexture(gc);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.size), new THREE.MeshLambertMaterial({ map: tex }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.ground = ground;
    this.scene.add(ground);
    // POI 핀
    const pois = ctx.pois.filter((p) => !p.deleted && !p.hiddenPoi);
    const pinCol = { anchor: '#3dd6ff', shop: '#ffb347', dorm: '#d9a441', micro: '#7ce3b0', gate: '#5b6cff', station: '#29e0d0', vantage: '#ffffff', key: '#ff8c1a' };
    const pins = new THREE.InstancedMesh(this.geos.cone4, new THREE.MeshBasicMaterial({ toneMapped: false }), pois.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0)), c = new THREE.Color();
    pois.forEach((p, i) => {
      const sz = p.tier === 1 ? 3.2 : p.tier === 2 ? 2.2 : 1.5;
      m.compose(new THREE.Vector3(p.x, (p.y || 0) + 7 + sz * 2, p.z), q, new THREE.Vector3(sz, sz * 2, sz));
      pins.setMatrixAt(i, m);
      pins.setColorAt(i, c.set(pinCol[p.type] || '#7ce3b0'));
    });
    pins.userData = { pois };
    this.pins = pins;
    this.scene.add(pins);
    // 의도 경로 선
    const pts = [], cols = [];
    const push = (a, b, col) => { pts.push(a[0], a[1], a[2], b[0], b[1], b[2]); c.set(col); cols.push(c.r, c.g, c.b, c.r, c.g, c.b); };
    for (const r of ctx.routes.crumbs) for (let i = 1; i < r.pts.length; i++) push([r.pts[i - 1][0], 0.6, r.pts[i - 1][1]], [r.pts[i][0], 0.6, r.pts[i][1]], '#29e6ff');
    for (const r of ctx.routes.rooftop) {
      push([r.ladder.x, 0.5, r.ladder.z], [r.ladder.x, r.ladder.top + 0.6, r.ladder.z], '#ffd400');
      for (let i = 1; i < r.pts.length; i++) push(r.pts[i - 1], r.pts[i], '#ffd400');
    }
    for (const k of ctx.routes.keys) push(k.a, [k.b[0], k.b[1] + 0.1, k.b[2]], '#ff8c1a');
    for (const s of ctx.routes.sightlines) push(s.a, s.b, '#ffffff');
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    lg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.routeLines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, depthTest: true }));
    this.routeLines.renderOrder = 5;
    this.scene.add(this.routeLines);
    this.applyLayers();
    this.setOverlay(this.overlay);
    this.select(null);
    this.ruleHL = null;
  }

  applyLayers() {
    if (!this.world) return;
    for (const g of LAYER_GROUPS) for (const m of this.world.groups[g] || []) m.visible = !!this.layers[g];
    if (this.pins) this.pins.visible = this.layers.pins && this.mode === 'map';
    if (this.routeLines) this.routeLines.visible = this.layers.routes;
  }

  setOverlay(kind) {
    this.overlay = kind;
    if (this.overlayMesh) { this.scene.remove(this.overlayMesh); this.overlayMesh = null; }
    document.querySelectorAll('[data-overlay]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.overlay === kind)));
    $('#legend').dataset.kind = kind;
    if (!this.ctx || kind === 'none') return;
    const c = paintOverlay(this.ctx, kind);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(WORLD.size, WORLD.size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.3;
    mesh.renderOrder = 2;
    this.overlayMesh = mesh;
    this.scene.add(mesh);
  }

  // ---------- 선택 / 인스펙터 ----------
  pick(ev) {
    if (!this.world) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    const targets = this.world.meshes.filter((m) => m.visible);
    if (this.pins && this.pins.visible) targets.push(this.pins);
    const hits = ray.intersectObjects(targets, false);
    for (const h of hits) {
      if (h.object === this.pins) { this.select({ poi: this.pins.userData.pois[h.instanceId], point: h.point }); return; }
      const id = h.object.userData.ids[h.instanceId];
      const e = this.ctx.entities[id];
      if (e && !e.deleted) { this.select({ entity: e, point: h.point }); return; }
    }
    this.select(null);
  }

  select(sel) {
    this.selected = sel;
    const box = this.selBox;
    const el = $('#inspector-body');
    if (!sel) {
      box.visible = false;
      el.innerHTML = '<p class="muted">지도에서 건물·소품·핀을 클릭하면 <b>어떤 규칙이 왜</b> 그것을 배치했는지 보여줍니다.</p>';
      return;
    }
    const ctx = this.ctx;
    if (sel.entity) {
      const e = sel.entity;
      box.visible = true;
      box.matrix.copy(entityMatrix({ ...e, shape: 'box', w: e.w + 0.4, h: e.h + 0.4, d: e.d + 0.4, y: e.y - 0.2 }));
      box.matrixAutoUpdate = false;
      const R = RULES[e.rule] || { name: e.rule || '—', desc: '' };
      const d = ctx.districts[e.district];
      const title = e.name || (PROGRAMS[e.kind] && PROGRAMS[e.kind].label) || KIND_KO[e.kind] || e.kind;
      const sec = e.secret !== undefined ? ctx.secrets[e.secret] : null;
      el.innerHTML = `
        <div class="ins-title">${esc(title)}</div>
        <div class="chips"><span class="chip">${esc(KIND_KO[e.kind] || e.kind)}</span>${d ? `<span class="chip" style="--c:${d.accent}">${esc(d.name)}</span>` : ''}<span class="chip ghost">${e.cat}</span></div>
        <dl class="kv">
          <dt>규칙</dt><dd><b>${esc(R.name)}</b> <span class="mono">${esc(e.rule || '')}</span></dd>
          ${R.desc ? `<dt>규칙 의도</dt><dd>${esc(R.desc)}</dd>` : ''}
          ${e.why ? `<dt>배치 근거</dt><dd>${esc(e.why)}</dd>` : ''}
          ${sec ? `<dt>비밀</dt><dd>${esc(sec.name)} · 공개 방식 <b>${esc(revealKo(sec.reveal))}</b> · 숨김도 ${(sec.hidden || 0).toFixed(2)} · 흔적 ${sec.crumbs || 0}개</dd>` : ''}
          <dt>크기</dt><dd class="mono">${e.w.toFixed(1)} × ${e.d.toFixed(1)} × ${e.h.toFixed(1)} m · y ${e.y.toFixed(1)}</dd>
          <dt>위치</dt><dd class="mono">x ${e.x.toFixed(0)}, z ${e.z.toFixed(0)}</dd>
        </dl>
        <div class="row"><button class="btn small" id="hl-rule">이 규칙만 강조</button><button class="btn small" id="go-here">여기서 탐험</button></div>`;
      $('#hl-rule').onclick = () => this.highlight(e.rule);
      $('#go-here').onclick = () => this.setMode('explore', sel.point || { x: e.x, z: e.z });
    } else if (sel.poi) {
      const p = sel.poi;
      box.visible = false;
      const R = RULES[p.rule] || { name: p.rule, desc: '' };
      const d = ctx.districts[p.district];
      el.innerHTML = `
        <div class="ins-title">${esc(p.name)}</div>
        <div class="chips"><span class="chip">${esc(poiTypeKo(p.type))}</span><span class="chip ghost">등급 ${p.tier}</span>${d ? `<span class="chip" style="--c:${d.accent}">${esc(d.name)}</span>` : ''}</div>
        <dl class="kv">
          <dt>규칙</dt><dd><b>${esc(R.name)}</b> <span class="mono">${esc(p.rule || '')}</span></dd>
          ${R.desc ? `<dt>규칙 의도</dt><dd>${esc(R.desc)}</dd>` : ''}
          ${p.why ? `<dt>배치 근거</dt><dd>${esc(p.why)}</dd>` : ''}
          <dt>위치</dt><dd class="mono">x ${p.x.toFixed(0)}, z ${p.z.toFixed(0)}</dd>
        </dl>
        <div class="row"><button class="btn small" id="hl-rule">이 규칙만 강조</button><button class="btn small" id="go-here">여기서 탐험</button></div>`;
      $('#hl-rule').onclick = () => this.highlight(p.rule);
      $('#go-here').onclick = () => this.setMode('explore', { x: p.x, z: p.z });
    }
    if (window.innerWidth < 760) $('#right').classList.add('open');
  }

  highlight(rule) {
    if (!this.world) return;
    this.ruleHL = this.ruleHL === rule ? null : rule;
    highlightRule(this.ctx, this.world, this.ruleHL);
    document.querySelectorAll('.rule').forEach((r) => r.setAttribute('aria-pressed', String(r.dataset.rule === this.ruleHL)));
    $('#hl-banner').hidden = !this.ruleHL;
    if (this.ruleHL) $('#hl-banner span').textContent = `강조 중: ${RULES[this.ruleHL] ? RULES[this.ruleHL].name : this.ruleHL}`;
  }

  // ---------- 패널 ----------
  fillPanels() {
    const ctx = this.ctx, m = ctx.metrics;
    // 규칙
    const groups = { macro: '매크로 · 도시 골격', meso: '메조 · 블록과 건물', micro: '마이크로 · 거리의 질감', intent: '의도 · 플레이 경험' };
    let html = '';
    for (const [layer, title] of Object.entries(groups)) {
      html += `<div class="rgroup"><div class="rgroup-title">${title}</div>`;
      for (const [id, r] of Object.entries(RULES)) {
        if (r.layer !== layer) continue;
        const n = ctx.ruleCount[id] || 0;
        html += `<button class="rule" data-rule="${id}" aria-pressed="false" title="${esc(r.desc)}"><span class="rname">${esc(r.name)}</span><span class="rcount mono">${n || '—'}</span><span class="rdesc">${esc(r.desc)}</span></button>`;
      }
      html += '</div>';
    }
    $('#rules').innerHTML = html;
    document.querySelectorAll('.rule').forEach((b) => (b.onclick = () => this.highlight(b.dataset.rule)));
    // 지표
    const pct = (v) => `${Math.round(v * 100)}%`;
    const bar = (label, v, txt, good = 0.8, note = '') => `<div class="metric"><div class="mlabel">${label}${note ? `<span class="mnote">${note}</span>` : ''}</div><div class="mval mono">${txt}</div><div class="mbar"><i style="width:${Math.min(100, v * 100)}%" class="${v >= good ? 'ok' : v >= good * 0.75 ? 'mid' : 'low'}"></i></div></div>`;
    $('#metrics-body').innerHTML = `
      <div class="score"><span class="mono">${(m.score * 100).toFixed(1)}</span><small>종합 레벨 점수</small></div>
      ${bar('볼거리 밀도', m.poiCoverage, pct(m.poiCoverage), 0.95, `메인 동선 위 ${PACING.runSpeed * PACING.targetSec}m(달리기 ${PACING.targetSec}초) 이내 볼거리`)}
      ${bar('최대 공백', Math.min(1, (PACING.runSpeed * PACING.targetSec) / Math.max(1, m.poiGapMax)), `${m.poiGapMax.toFixed(0)}m`, 0.99, `리듬 규칙 적용 후 · 적용 전 커버리지 ${pct(m.poiCoverageBefore)}`)}
      ${bar('랜드마크 가시율', m.landmarkVisible, pct(m.landmarkVisible), 0.9, '동선 샘플에서 랜드마크가 보이는 비율')}
      ${bar('중앙탑 가시율', m.spireVisible, pct(m.spireVisible), 0.75, '전역 방향 단서')}
      ${bar('비밀 평균 숨김도', m.secretHiddenAvg, m.secretHiddenAvg.toFixed(2), 0.85, `비밀 ${m.secrets}개 · 평균 우회 ${m.secretDetourAvg.toFixed(0)}m`)}
      ${bar('흔적 연결률', m.crumbCoverage, pct(m.crumbCoverage), 0.75, '비밀까지 이어진 흔적이 있는 비율')}
      ${bar('막다른 길 보상률', m.deadEndCoverage, pct(m.deadEndCoverage), 0.99, `막다른 길 ${m.deadEnds}곳`)}
      <div class="mgrid mono">
        <span>건물</span><b>${m.buildings}</b><span>필지</span><b>${m.lots}</b>
        <span>POI</span><b>${m.pois}</b><span>랜드마크</span><b>${m.landmarks}</b>
        <span>옥상 루트</span><b>${m.rooftopRoutes}</b><span>잠긴 문</span><b>${m.gates}</b>
        <span>간선</span><b>${m.roadKm[1]}km</b><span>생활가로</span><b>${m.roadKm[2]}km</b>
        <span>엔티티</span><b>${m.entities}</b><span>생성</span><b>${(ctx.timings.total / 1000).toFixed(1)}s</b>
      </div>
      <div class="secret-types">${Object.entries(m.secretsByType).map(([t, n]) => `<span class="chip" style="--c:${SECRET_TYPES[t].color}">${SECRET_TYPES[t].name} ${n}</span>`).join('')}</div>`;
    $('#notes-pipeline').innerHTML = STAGES.map(([key, label]) => `<li><span>${esc(label)}</span><em>${(ctx.timings[key] || 0).toFixed(0)}ms</em></li>`).join('');
    $('#logs-body').innerHTML = ctx.logs.map((l) => `<li><b>${esc(l.name)}</b> ${esc(l.msg)}</li>`).join('');
    $('#districts-body').innerHTML = ctx.districts.map((d) => `<li><i style="background:${d.accent}"></i><b>${esc(d.name)}</b><span>${esc(TAGLINE[d.type] || '')}</span></li>`).join('');
    this.updateHud();
  }

  // ---------- 모드 ----------
  setMode(mode, at) {
    if (!this.ctx) return;
    if (mode === this.mode && !at) return;
    document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    if (mode === 'explore') {
      if (!this.explorer) this.explorer = new Explorer(this);
      const sp = at || (this.selected && this.selected.point) || this.defaultSpawn();
      this.explorer.spawn(sp.x, sp.z);
      this.mode = 'explore';
      this.controls.enabled = false;
      document.body.classList.add('exploring');
      $('#hud').hidden = false;
      this.selBox.visible = false;
      this.camera.near = 0.1;
      this.camera.updateProjectionMatrix();
      this.toast('클릭해서 시점 고정 · WASD 이동 · Shift 달리기 · Space 점프/매달리기 · E 상호작용 · M 지도', 'hint', 5200);
    } else {
      this.mode = 'map';
      if (this.explorer) {
        const p = this.explorer.pos;
        this.controls.target.set(p.x, 0, p.z);
        this.camera.position.set(p.x + 90, 140, p.z + 110);
      }
      this.controls.enabled = true;
      document.body.classList.remove('exploring');
      $('#hud').hidden = true;
      this.setPrompt('');
      if (document.pointerLockElement) document.exitPointerLock();
      this.camera.near = 0.3;
      this.camera.updateProjectionMatrix();
    }
    this.applyLayers();
  }

  defaultSpawn() {
    const st = this.ctx.rail && this.ctx.rail.stations.find((s) => s.spur);
    return st && st.foot ? st.foot : { x: 0, z: 75 };
  }

  // ---------- HUD ----------
  setPrompt(t) {
    const el = $('#prompt');
    if (el.textContent !== t) el.textContent = t;
    el.hidden = !t;
  }

  toast(text, kind = 'info', ms = 2600) {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = text;
    $('#toasts').appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
    while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  }

  districtBanner(d) {
    const el = $('#banner');
    el.innerHTML = `<b>${esc(d.name)}</b><span>${esc(TAGLINE[d.type] || '')}</span>`;
    el.style.setProperty('--c', d.accent);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  onCollect() { this.updateHud(); }

  updateHud() {
    if (!this.ctx) return;
    const ex = this.explorer;
    const got = ex ? ex.inventory.secrets.size : 0;
    $('#count-secrets').textContent = `${got} / ${this.ctx.secrets.length}`;
    $('#count-keys').textContent = ex ? ex.inventory.keys.size : 0;
    $('#count-coins').textContent = ex ? ex.inventory.coins : 0;
  }

  drawCompass() {
    const el = $('#compass-marks');
    const yaw = this.explorer.yaw;
    const p = this.explorer.pos;
    const items = [];
    const dirs = [['북', 0, -1], ['동', 1, 0], ['남', 0, 1], ['서', -1, 0]];
    const bearing = (dx, dz) => {
      // 카메라 정면 = (-sin yaw, -cos yaw)
      const a = Math.atan2(dx, dz) - Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
      return Math.atan2(Math.sin(a), Math.cos(a));
    };
    for (const [n, dx, dz] of dirs) items.push({ t: n, b: bearing(dx, dz), cls: 'cdir' });
    for (const l of this.ctx.landmarks) {
      const dx = l.x - p.x, dz = l.z - p.z;
      const d = Math.hypot(dx, dz);
      if (!l.global && d > 700) continue;
      items.push({ t: `${l.name} ${d < 1000 ? Math.round(d) + 'm' : ''}`, b: bearing(dx, dz), cls: l.global ? 'cspire' : 'clm', d: l.global ? -1 : d });
    }
    items.sort((a, b) => (a.cls === 'cdir' ? -2 : a.d) - (b.cls === 'cdir' ? -2 : b.d));
    // 방위 글자는 항상, 랜드마크는 겹치지 않는 것만 (가까운 순)
    const vis = [];
    const shown = items.filter((i) => Math.abs(i.b) < 1.4);
    const W = el.clientWidth || 500;
    for (const i of shown) {
      const x = (0.5 - i.b / 2.8) * W;
      const w = i.t.length * 11 + 10;
      if (i.cls !== 'cdir' && vis.some((v) => Math.abs(v.x - x) < (v.w + w) / 2)) continue;
      vis.push({ ...i, x, w });
    }
    el.innerHTML = vis.map((i) => `<span class="${i.cls}" style="left:${i.x.toFixed(0)}px">${esc(i.t)}</span>`).join('');
  }

  drawMinimap() {
    const cv = $('#minimap');
    const g = cv.getContext('2d');
    const S = cv.width;
    const p = this.explorer.pos;
    const scale = 512 / WORLD.size; // px per m on base
    const viewM = 220;
    g.save();
    g.clearRect(0, 0, S, S);
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 2, 0, Math.PI * 2); g.clip();
    g.translate(S / 2, S / 2);
    g.rotate(this.explorer.yaw);
    const k = S / viewM;
    g.scale(k, k);
    g.drawImage(this.miniBase, (-WORLD.half - p.x), (-WORLD.half - p.z), WORLD.size, WORLD.size);
    void scale;
    for (const id of this.explorer.discovered) {
      const q = this.ctx.pois[id];
      g.fillStyle = q.tier === 1 ? '#00b7ff' : '#2bb673';
      g.beginPath(); g.arc(q.x - p.x, q.z - p.z, q.tier === 1 ? 3 : 2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.fillStyle = '#ff3d6e';
    g.beginPath(); g.moveTo(S / 2, S / 2 - 8); g.lineTo(S / 2 + 6, S / 2 + 6); g.lineTo(S / 2 - 6, S / 2 + 6); g.closePath(); g.fill();
  }

  // ---------- 루프 ----------
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = this.clock.getDelta();
    this.frame = (this.frame || 0) + 1;
    if (this.mode === 'explore' && this.explorer) {
      this.explorer.update(dt, this.camera);
      const p = this.explorer.pos;
      this.sun.target.position.set(p.x, 0, p.z);
      this.sun.position.set(p.x - 260, 420, p.z + 180);
      if (this.frame % 3 === 0) { this.drawCompass(); this.drawMinimap(); }
    } else {
      this.controls.update();
      const t = this.controls.target;
      this.sun.target.position.set(t.x, 0, t.z);
      this.sun.position.set(t.x - 260, 420, t.z + 180);
    }
    if (this.ctx && this.frame % 2 === 0) this.updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  updateLabels() {
    if (!this.layers.labels) { this.labels.clear(); return; }
    const ctx = this.ctx;
    const items = [];
    if (this.mode === 'map') {
      for (const d of ctx.districts) items.push({ x: d.x, y: 40, z: d.z, text: d.name, cls: 'district', pri: 3 });
      for (const l of ctx.landmarks) items.push({ x: l.x, y: l.h + 4, z: l.z, text: l.name, cls: 'landmark', pri: 2 });
      for (const p of ctx.pois) {
        if (p.deleted || p.hiddenPoi) continue;
        if (p.tier === 1) items.push({ x: p.x, y: 18, z: p.z, text: p.name, cls: `poi t1 ${p.type}`, pri: 1, maxDist: 650 });
        else if (p.tier === 2) items.push({ x: p.x, y: 12, z: p.z, text: p.name, cls: `poi t2 ${p.type}`, pri: 0.5, maxDist: 260 });
        else items.push({ x: p.x, y: 8, z: p.z, text: p.name, cls: 'poi t3', pri: 0, maxDist: 140 });
      }
      if (this.layers.secret) for (const s of ctx.secrets) items.push({ x: s.x, y: s.y + 3, z: s.z, text: s.name, cls: 'secret', pri: 0.2, maxDist: 220 });
    } else {
      const p = this.explorer.pos;
      for (const q of ctx.pois) {
        if (q.deleted || q.hiddenPoi) continue;
        if (Math.abs(q.x - p.x) > 70 || Math.abs(q.z - p.z) > 70) continue;
        items.push({ x: q.x, y: (q.y || 0) + 4.5, z: q.z, text: q.name, cls: `poi t${q.tier}`, pri: 3 - q.tier, maxDist: 70 });
      }
    }
    this.labels.update(this.camera, items, this.w, this.h);
  }

  // ---------- UI 바인딩 ----------
  bindUI() {
    $('#gen').onclick = () => this.regenerate($('#seed').value.trim() || 'lumina');
    $('#open-notes').onclick = () => { $('#notes').hidden = false; $('#close-notes').focus(); };
    $('#close-notes').onclick = () => { $('#notes').hidden = true; };
    $('#notes').addEventListener('click', (e) => { if (e.target.id === 'notes') $('#notes').hidden = true; });
    $('#seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gen').click(); });
    $('#rand').onclick = () => {
      const words = ['sakura', 'halo', 'aurora', 'kivo', 'nova', 'iris', 'tsubasa', 'hikari', 'lumen', 'mirai', 'stella', 'yume'];
      const s = `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
      this.regenerate(s);
    };
    document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => this.setMode(b.dataset.mode)));
    document.querySelectorAll('[data-layer]').forEach((cb) => {
      cb.checked = !!this.layers[cb.dataset.layer];
      cb.onchange = () => { this.layers[cb.dataset.layer] = cb.checked; this.applyLayers(); };
    });
    document.querySelectorAll('[data-overlay]').forEach((b) => (b.onclick = () => this.setOverlay(b.dataset.overlay)));
    $('#hl-clear').onclick = () => this.highlight(this.ruleHL);
    $('#copy-json').onclick = async () => {
      if (!this.ctx) return;
      const json = JSON.stringify(exportWorld(this.ctx));
      try {
        await navigator.clipboard.writeText(json);
        this.toast(`엔진 임포트용 JSON ${(json.length / 1e6).toFixed(1)}MB 복사됨`, 'good');
      } catch (e) {
        this.toast('클립보드 접근이 막혀 복사하지 못했습니다. 브라우저 권한을 확인하세요.', 'warn', 4000);
      }
    };
    $('#toggle-left').onclick = () => $('#left').classList.toggle('open');
    $('#toggle-right').onclick = () => $('#right').classList.toggle('open');
    const dom = this.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    dom.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (this.mode === 'map' && moved < 5 && e.button === 0) this.pick(e);
      if (this.mode === 'explore' && e.pointerType === 'mouse' && !document.pointerLockElement) {
        try { const r = dom.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* 미지원 환경 */ }
      }
    });
    dom.addEventListener('mousemove', (e) => {
      if (this.mode !== 'explore' || !this.explorer) return;
      if (document.pointerLockElement === dom || e.buttons === 2) {
        this.explorer.yaw -= e.movementX * 0.0026;
        this.explorer.pitch = Math.max(-0.6, Math.min(1.25, this.explorer.pitch + e.movementY * 0.0022));
      }
    });
    dom.addEventListener('contextmenu', (e) => { if (this.mode === 'explore') e.preventDefault(); });
    dom.addEventListener('wheel', (e) => {
      if (this.mode === 'explore' && this.explorer) this.explorer.dist = Math.max(2.5, Math.min(14, this.explorer.dist + e.deltaY * 0.004));
    }, { passive: true });
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
      if (e.code === 'Escape' && !$('#notes').hidden) { $('#notes').hidden = true; return; }
      if (e.code === 'KeyM' || (e.code === 'Escape' && this.mode === 'explore' && !document.pointerLockElement)) { this.setMode(this.mode === 'map' ? 'explore' : 'map'); return; }
      if (this.mode === 'explore' && this.explorer) {
        if (e.code === 'KeyV') this.explorer.firstPerson = !this.explorer.firstPerson;
        this.explorer.keys[e.code] = true;
        if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => { if (this.explorer) this.explorer.keys[e.code] = false; });
    window.addEventListener('blur', () => { if (this.explorer) this.explorer.keys = {}; });
    this.bindTouch();
  }

  bindTouch() {
    const pad = $('#touchpad'), stick = $('#stick');
    let id = null, cx = 0, cy = 0;
    pad.addEventListener('pointerdown', (e) => { id = e.pointerId; cx = e.clientX; cy = e.clientY; pad.setPointerCapture(id); if (this.explorer) this.explorer.touch.active = true; });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id || !this.explorer) return;
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / 50)), dy = Math.max(-1, Math.min(1, (e.clientY - cy) / 50));
      this.explorer.touch.mx = dx; this.explorer.touch.mz = dy;
      this.explorer.touch.run = Math.hypot(dx, dy) > 0.95;
      stick.style.transform = `translate(${dx * 30}px, ${dy * 30}px)`;
    });
    const end = () => { id = null; stick.style.transform = ''; if (this.explorer) Object.assign(this.explorer.touch, { active: false, mx: 0, mz: 0, run: false }); };
    pad.addEventListener('pointerup', end);
    pad.addEventListener('pointercancel', end);
    $('#tjump').onpointerdown = () => { if (this.explorer) this.explorer.touch.jump = true; };
    $('#tuse').onpointerdown = () => { if (this.explorer) this.explorer.touch.use = true; };
    // 오른쪽 드래그로 시점
    let lid = null, lx = 0, ly = 0;
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && this.mode === 'explore') { lid = e.pointerId; lx = e.clientX; ly = e.clientY; } });
    dom.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lid || !this.explorer) return;
      this.explorer.yaw -= (e.clientX - lx) * 0.006;
      this.explorer.pitch = Math.max(-0.6, Math.min(1.25, this.explorer.pitch + (e.clientY - ly) * 0.005));
      lx = e.clientX; ly = e.clientY;
    });
    dom.addEventListener('pointerup', (e) => { if (e.pointerId === lid) lid = null; });
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function revealKo(r) {
  return { corner: '모퉁이 뒤 (삼각형 규칙)', nook: '움푹한 구석', deadend: '막다른 길', rooftop: '옥상 루트 끝', tease: '보이지만 닿지 않음', climb: '랜드마크 정상', maze: '미로 막다른 칸', gap: '펜스 틈새', gate: '잠긴 문 너머' }[r] || r;
}
function poiTypeKo(t) {
  return { anchor: '앵커 활동', shop: '상점', dorm: '기숙사', micro: '마이크로 POI', gate: '출입구', station: '역 · 빠른 이동', vantage: '전망 포인트', key: '열쇠' }[t] || t;
}

const app = new App();
window.__app = app;
let seed = 'lumina';
try { seed = localStorage.getItem('academy-city-seed') || seed; } catch (e) { /* 저장 불가 */ }
const hashSeed = (location.hash || '').slice(1);
if (/^[A-Za-z0-9._~-]{1,40}$/.test(hashSeed)) seed = hashSeed;
app.regenerate(seed);
void DISTRICT_TYPES;
