// 데이터 주도 설정: 월드 상수, 구역(디스트릭트) 원형, 건물 프로그램, 규칙 레지스트리.
// 레벨 디자이너는 코드가 아니라 이 표를 수정해 도시의 성격을 바꾼다.

export const WORLD = {
  size: 1024, // m (정사각 월드, 원점 중심)
  half: 512,
  base: 1, // 기본 래스터 해상도 (m)
  ana: 2, // 분석 래스터 해상도 (m)
  floorH: 3.2,
};

export const TERRAIN = { SEA: 0, LAND: 1, RIVER: 2, LAKE: 3 };
export const ROAD = {
  NONE: 0, MAIN: 1, MINOR: 2, ALLEY: 3, COAST: 4, SIDEWALK: 5, PLAZA: 6,
  CAMPUS_PATH: 7, PARK_PATH: 8, BRIDGE: 9, PIER: 10,
};
export const ZONE = { CITY: 0, CAMPUS: 1, PARK: 2, PLAZA: 3 };

// 도로 위계 (Lynch: Paths) — 폭은 m
export const ROAD_LEVELS = {
  1: { name: '간선대로', width: 14, sidewalk: 3, type: ROAD.MAIN },
  2: { name: '생활가로', width: 8, sidewalk: 2, type: ROAD.MINOR },
  3: { name: '골목', width: 4, sidewalk: 0, type: ROAD.ALLEY },
  4: { name: '해안도로', width: 10, sidewalk: 3, type: ROAD.COAST },
};

// ---- 구역 원형 (Lynch: Districts) ----
// pref: 배치 선호 (r: 중심거리 0..1 이상값, coast: 해안 근접 선호, river: 하천 근접 선호)
export const DISTRICT_TYPES = {
  center: {
    name: '중앙 행정구', faction: null, ground: '#d6d8de', accent: '#5b6cff',
    minorSep: 54, field: 'radial', noiseRot: 0.02, lot: { f: [20, 32], d: [18, 26] }, floors: [6, 14],
    pref: { r: 0.0 }, fixed: true,
  },
  commercial: {
    name: '아케이드 상점가', ground: '#efd8b8', accent: '#ff8a3d',
    minorSep: 38, field: 'toCenter', noiseRot: 0.06, alleys: 0.9, arcade: 0.45,
    lot: { f: [9, 16], d: [12, 17] }, floors: [2, 6], pref: { r: 0.3 },
  },
  residential: {
    name: '기숙사·주거구', ground: '#e6e0cf', accent: '#d9a441',
    minorSep: 50, field: 'grid', noiseRot: 0.18, alleys: 0.7, arcade: 0,
    lot: { f: [12, 20], d: [13, 19] }, floors: [3, 9], pref: { r: 0.55 },
  },
  trad_academy: {
    name: '성 루미에르 여학원', campus: true, faction: 'lumiere', ground: '#efeadb', accent: '#c9a227',
    minorSep: 44, field: 'toCenter', noiseRot: 0.03, lot: { f: [14, 22], d: [16, 22] }, floors: [3, 6],
    pref: { r: 0.62 }, special: 'chapel', wallColor: '#f4efe2',
  },
  tech_academy: {
    name: '아르케 공과학원', campus: true, faction: 'arche', ground: '#d5e2ea', accent: '#20a8d8',
    minorSep: 48, field: 'toCenter', noiseRot: 0.02, lot: { f: [18, 30], d: [18, 28] }, floors: [3, 8],
    pref: { r: 0.62 }, special: 'server', wallColor: '#b9cfdc',
  },
  free_academy: {
    name: '레드라인 자유학원', campus: true, faction: 'redline', ground: '#e6d0c8', accent: '#e0413b',
    minorSep: 38, field: 'grid', noiseRot: 0.14, lot: { f: [12, 20], d: [14, 20] }, floors: [2, 5],
    pref: { r: 0.72 }, special: 'garage', wallColor: '#9a8a84',
  },
  arts_academy: {
    name: '스텔라 예술학원', campus: true, faction: 'stella', ground: '#e8dcef', accent: '#b05cd8',
    minorSep: 42, field: 'toCenter', noiseRot: 0.04, lot: { f: [14, 22], d: [14, 22] }, floors: [3, 6],
    pref: { r: 0.6 }, special: 'hall', wallColor: '#e9e1f0',
  },
  harbor: {
    name: '청해 항만구', ground: '#cfd4d8', accent: '#2f7fbf',
    minorSep: 58, field: 'coast', noiseRot: 0.03, lot: { f: [26, 48], d: [24, 40] }, floors: [1, 3],
    pref: { r: 0.85, coast: 1 },
  },
  ruins: {
    name: '구시가지 재개발구역', ground: '#d2cbbd', accent: '#7a6a55',
    minorSep: 40, field: 'grid', noiseRot: 0.55, alleys: 1.0, deadEndAlleys: 0.5,
    lot: { f: [10, 17], d: [10, 15] }, floors: [2, 7], pref: { r: 0.85 },
  },
  park: {
    name: '미라이 중앙공원', park: true, ground: '#bfe0a8', accent: '#3f9a4a',
    minorSep: 60, field: 'radial', noiseRot: 0.1, lot: { f: [16, 24], d: [16, 24] }, floors: [1, 3],
    pref: { r: 0.32, river: 1 },
  },
};

// 도시 구성 (12개 구역)
export const CITY_PROGRAM = [
  'center', 'commercial', 'commercial', 'residential', 'residential',
  'trad_academy', 'tech_academy', 'free_academy', 'arts_academy', 'harbor', 'ruins', 'park',
];

// 경쟁 관계 (국경 규칙)
export const RIVALS = [['free_academy', 'trad_academy'], ['free_academy', 'tech_academy']];

// ---- 색 팔레트 (카테고리별, 러프하지만 구별 가능하게) ----
export const COLORS = {
  shop: '#f4a259', convenience: '#5cc8a0', cafe: '#c98b5e', arcade_game: '#ff5fa2', karaoke: '#a35cff',
  bookstore: '#7f9c5a', apartment: '#e8d6b0', dorm: '#d9c6a0', house: '#e7b98f', laundromat: '#9fd3e6',
  office: '#b8c2cf', gov: '#e3e6ee', tower: '#9aa8bd', warehouse: '#b0775a', lab: '#a9c4d6',
  server: '#6f8fa8', ruin: '#8e877c', ruin_dark: '#6d665c', construction: '#e0b84a', school: '#f1ead8',
  school_tech: '#cfdde6', school_free: '#c7a69a', school_arts: '#e2d2ee', gym: '#d3b38c', club: '#e5c07b',
  oldschool: '#7d6e5d', chapel: '#f7f3ea', hall: '#c9a7e8', garage: '#a2584f', cafeteria: '#f0c987',
  station: '#5aa9e6', stall: '#ffb347',
  roof: '#9b9b9b', watertank: '#7fa7c9', ac: '#cfd2d6', antenna: '#d0d4dc', solar: '#2c3e6b',
  tree: '#4f9d4a', sakura: '#f7a8c8', trunk: '#7a5a3a', lamp: '#3a3d45', lampLight: '#ffe9a8',
  bench: '#9a6b42', vending: '#e8463c', vending2: '#2e7dd7', busstop: '#3b82c4', sign: '#f2d43d',
  poster: '#ff9ec4', graffiti: '#e535ab', barricade: '#f2c230', fence: '#8b9096', wall: '#cfc8b8',
  container: ['#c84b31', '#2d6a9f', '#3f8f5a', '#e08a2c', '#7a4fa0', '#bdbdbd'],
  car: ['#e64b4b', '#3d7fe0', '#f2f2f2', '#2b2b2b', '#f2c94c', '#6fcf97'],
  crane: '#f2a51a', pier: '#8a7a66', rail: '#c3cad6', railPillar: '#9aa3b0', bridge: '#9aa3ad',
  // 게임플레이 (의도 레이어)
  landmark: '#ff3d6e', poi: '#3dd6ff', micro: '#7ce3b0', secret: '#ffd23d', crumb: '#62f0ff',
  key: '#ff8c1a', gate: '#b8323a', ladder: '#ffd400', plank: '#c08a4a', vantage: '#ffffff',
  fasttravel: '#29e0d0', checkpoint: '#e0413b', halo: '#ffe28a',
};

// ---- 규칙 레지스트리: 모든 배치물은 rule id를 가진다 (추적 가능성) ----
// layer: macro | meso | micro | intent
export const RULES = {
  'macro.island': { layer: 'macro', name: '섬 지형', desc: '방사형 감쇠 + fBm 노이즈로 해안선, 만(灣)을 깎아 항구 입지 확보' },
  'macro.river': { layer: 'macro', name: '하천(Edge)', desc: '도시를 가르는 하천. 린치의 Edge — 구역 경계와 다리(통과점)를 만든다' },
  'macro.district': { layer: 'macro', name: '구역 배치 최적화', desc: '포아송 시드 + 로이드 완화 후, 선호도/쌍대 제약 점수를 언덕오르기로 최적화' },
  'macro.tensor': { layer: 'macro', name: '텐서장 가로망', desc: '구역별 기저장(격자/방사/해안) 블렌딩 → 주/부 고유벡터 유선 추적' },
  'macro.approach': { layer: 'macro', name: '학원 진입대로', desc: '모든 학원 정문은 중앙탑 방향 간선과 연결 (축선 + 비스타)' },
  'macro.coast': { layer: 'macro', name: '해안도로', desc: '해안 등거리선을 따르는 순환로 — 섬의 Edge를 걷게 만든다' },
  'macro.bridge': { layer: 'macro', name: '교량', desc: '간선이 하천을 50m 이하로 건널 때만 다리 생성 → 다리는 자연스러운 Node' },
  'meso.alley': { layer: 'meso', name: '블록 관통 골목', desc: '긴 블록(투과성 낮음)을 가로질러 골목 생성. 일부는 아케이드 지붕' },
  'meso.deadend': { layer: 'meso', name: '막다른 골목', desc: '재개발구역은 일부 골목을 블록 중간에서 끊어 포켓 공간 생성' },
  'meso.lot': { layer: 'meso', name: 'OBB 필지 분할', desc: '블록을 가로 방향 OBB로 재귀 분할, 접도(frontage) 판정' },
  'meso.zoning': { layer: 'meso', name: '용도 배정', desc: '구역·코너·접도 위계·흐름량에 따른 건물 프로그램 가중 선택' },
  'meso.skyline': { layer: 'meso', name: '스카이라인 경사', desc: '중앙탑으로 갈수록 높아지는 높이 경사 — 실루엣만으로 방향을 안다' },
  'meso.campus': { layer: 'meso', name: '학원 캠퍼스 문법', desc: '정문→전정→중정(Quad)→본관(시계탑) 축선, 측면 교사동, 후면 체육관/운동장/구교사' },
  'meso.wall': { layer: 'meso', name: '캠퍼스 담장', desc: '캠퍼스는 담장으로 닫고 정문/후문/개구멍만 열어 출입을 의도적으로 제한' },
  'meso.park': { layer: 'meso', name: '공원 경로망', desc: '입구들과 명소를 MST + 순환 간선으로 연결 (막힘 없는 산책 루프)' },
  'meso.harbor': { layer: 'meso', name: '컨테이너 미로', desc: '컨테이너 야드를 미로 생성(백트래커+브레이드)으로 채우고 막다른 칸에 보상' },
  'meso.rail': { layer: 'meso', name: '모노레일 환상선', desc: '역을 각도순으로 잇는 고가 순환선. 고가 아래 건물은 저층 상가로 변경' },
  'meso.construction': { layer: 'meso', name: '공사장', desc: '재개발구역 필지 일부를 펜스로 둘러친 공사장으로 — 틈새 하나는 열어둔다' },
  'intent.landmark': { layer: 'intent', name: '랜드마크 비스타', desc: '도로 시선축 길이 합이 최대인 필지에 구역 랜드마크 (비스타 종결점 / Weenie)' },
  'intent.spire': { layer: 'intent', name: '중앙탑', desc: '어디서든 보이는 전역 랜드마크. 모든 방사 대로의 소실점' },
  'intent.flow': { layer: 'intent', name: '보행 흐름', desc: '주요 거점 쌍 최단경로 누적(근사 매개중심성) → 메인 동선' },
  'intent.anchor': { layer: 'intent', name: '앵커 POI', desc: '흐름 상위 필지에 핵심 활동(게임센터, 카페 등) 배정' },
  'intent.rhythm': { layer: 'intent', name: '밀도 리듬', desc: '메인 동선 위 어느 지점에서도 일정 거리 안에 볼거리 — 공백을 찾아 마이크로 POI 삽입' },
  'intent.secret': { layer: 'intent', name: '숨김 보상', desc: '동선 가시성(아이소비스트) 낮고, 접근 가능하며, 적당히 우회해야 하는 지점에 비밀 배치' },
  'intent.crumb': { layer: 'intent', name: '호기심의 중력(흔적)', desc: '동선 이탈 지점에 미끼(고양이·꽃잎·불빛), 비밀까지 흔적을 이어 플레이어를 유도' },
  'intent.rooftop': { layer: 'intent', name: '옥상 루트', desc: '점프 가능한 지붕들을 그래프로 묶고, 끊긴 곳엔 판자, 입구엔 사다리, 끝엔 보상' },
  'intent.vantage': { layer: 'intent', name: '전망 포인트', desc: '루트의 최고점/랜드마크 정상에 전망 포인트(빠른 이동 해금)' },
  'intent.gate': { layer: 'intent', name: '열쇠와 자물쇠', desc: '안뜰 입구의 가장 좁은 지점에 잠긴 문, 같은 구역 중거리에 열쇠' },
  'intent.deadend': { layer: 'intent', name: '막다른 길 보상', desc: '모든 막다른 길에는 이유가 있다 — 보상/소품이 없는 막다른 길 금지' },
  'intent.border': { layer: 'intent', name: '경쟁 국경', desc: '라이벌 학원 구역 경계의 도로에 바리케이드·검문소·낙서' },
  'intent.wonder': { layer: 'intent', name: '학원 7대 불가사의', desc: '각 학원 캠퍼스의 가장 숨겨진 지점들에 괴담 스팟 (서브컬쳐 트로프)' },
  'intent.legendtree': { layer: 'intent', name: '전설의 나무', desc: '캠퍼스에서 가장 은밀한 녹지에 고백 명소 나무' },
  'intent.signpost': { layer: 'intent', name: '방향 표지', desc: '간선 교차점마다 가장 가까운 랜드마크들을 가리키는 표지판' },
  'intent.fasttravel': { layer: 'intent', name: '빠른 이동', desc: '역·전망 포인트를 빠른 이동 지점으로' },
  'micro.lamp': { layer: 'micro', name: '가로등', desc: '간선/생활가로 보도에 18~24m 간격, 좌우 교차' },
  'micro.tree': { layer: 'micro', name: '가로수', desc: '간선 보도 12m 간격. 하천변은 벚나무 산책로' },
  'micro.busstop': { layer: 'micro', name: '버스정류장', desc: '흐름 높은 간선을 따라 약 160m 간격' },
  'micro.vending': { layer: 'micro', name: '자판기', desc: '정류장 옆, 골목 입구, 기숙사 앞 — 벽에 붙여서' },
  'micro.bench': { layer: 'micro', name: '벤치', desc: '광장·공원·물가 — 경관 쪽을 바라보게' },
  'micro.car': { layer: 'micro', name: '노상 주차', desc: '생활가로 가장자리에 확률적 배치' },
  'micro.ac': { layer: 'micro', name: '실외기/배관', desc: '골목에 면한 벽에만 — 골목의 질감' },
  'micro.graffiti': { layer: 'micro', name: '낙서 영역 경사', desc: '레드라인 자유학원에서 멀어질수록 낙서 확률 감소 (세력권 시각화)' },
  'micro.poster': { layer: 'micro', name: '동아리 포스터', desc: '학원 정문 주변 벽/게시판' },
  'micro.roof': { layer: 'micro', name: '옥상 소품', desc: '물탱크·실외기·안테나·태양광 — 구역별 옥상 문법' },
  'micro.awning': { layer: 'micro', name: '차양/간판', desc: '상점 정면(접도면)에만 차양과 간판' },
  'micro.laundry': { layer: 'micro', name: '빨래줄', desc: '주거구 골목 양쪽 건물 사이' },
  'micro.cat': { layer: 'micro', name: '동네 고양이', desc: '조용한 골목/공원 — 살아있는 도시 신호' },
  'micro.crosswalk': { layer: 'micro', name: '횡단보도', desc: '간선 교차로 접근부' },
};

// 마이크로 POI (리듬 채우기) 후보 — 구역별
export const MICRO_POIS = {
  center: ['홀로그램 광고탑', '분수 벤치', '거리 공연', '안내 키오스크'],
  commercial: ['크레페 노점', '가챠 머신 코너', '버스킹 무대', '타코야키 포장마차', '스티커 사진기'],
  residential: ['작은 신사', '놀이터', '고양이 급식소', '동네 게시판', '세탁소 앞 벤치'],
  trad_academy: ['동아리 홍보 부스', '성모상 정원', '티 테이블'],
  tech_academy: ['드론 정비대', '로봇 시연대', '해커톤 텐트'],
  free_academy: ['오토바이 집합소', '낙서 벽', '드럼통 모닥불'],
  arts_academy: ['야외 이젤', '버스킹 무대', '포토존'],
  harbor: ['낚시 포인트', '포장마차', '등대 전망대'],
  ruins: ['낙서 벽', '아지트 소파', '드럼통 모닥불', '고장난 자판기'],
  park: ['피크닉 매트', '전망 벤치', '보트 선착장', '야외 무대'],
};

export const SECRET_TYPES = {
  cat: { name: '숨은 고양이', color: '#ffd23d', crumb: '발자국' },
  wonder: { name: '학원 불가사의', color: '#b77bff', crumb: '푸른 도깨비불' },
  tag: { name: '레드라인 낙서 태그', color: '#ff4fa8', crumb: '스프레이 자국' },
  memory: { name: '잊혀진 기록', color: '#9fe8ff', crumb: '흩날린 종이' },
  stash: { name: '밀수품 상자', color: '#ffb04d', crumb: '끌린 자국' },
  treasure: { name: '보물 상자', color: '#ffe066', crumb: '반짝임' },
  view: { name: '비경', color: '#ffffff', crumb: '바람개비' },
};
