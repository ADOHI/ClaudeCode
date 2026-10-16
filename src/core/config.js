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
  CAMPUS_PATH: 7, PARK_PATH: 8, BRIDGE: 9, PIER: 10, OLD: 11,
};
export const ZONE = { CITY: 0, CAMPUS: 1, PARK: 2, PLAZA: 3 };

// 도로 위계 (Lynch: Paths) — 폭은 m
export const ROAD_LEVELS = {
  1: { name: '간선대로', width: 14, sidewalk: 3, type: ROAD.MAIN },
  2: { name: '생활가로', width: 8, sidewalk: 2, type: ROAD.MINOR },
  3: { name: '골목', width: 4, sidewalk: 0, type: ROAD.ALLEY },
  4: { name: '해안도로', width: 10, sidewalk: 3, type: ROAD.COAST },
  5: { name: '옛길', width: 6, sidewalk: 1.5, type: ROAD.OLD },
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
  'meso.skyline': { layer: 'meso', name: '스카이라인 경사', desc: '스파이어 + 역세권 봉우리 높이장' },
  'meso.campus': { layer: 'meso', name: '학원 캠퍼스 문법', desc: '정문→전정→중정(Quad)→본관(시계탑) 축선, 측면 교사동, 후면 체육관/운동장/구교사' },
  'meso.wall': { layer: 'meso', name: '캠퍼스 담장', desc: '캠퍼스는 담장으로 닫고 정문/후문/개구멍만 열어 출입을 의도적으로 제한' },
  'meso.park': { layer: 'meso', name: '공원 경로망', desc: '입구들과 명소를 MST + 순환 간선으로 연결 (막힘 없는 산책 루프)' },
  'meso.harbor': { layer: 'meso', name: '컨테이너 미로', desc: '컨테이너 야드를 미로 생성(백트래커+브레이드)으로 채우고 막다른 칸에 보상' },
  'meso.rail': { layer: 'meso', name: '모노레일 환상선', desc: '역을 각도순으로 잇는 고가 순환선. 고가 아래 건물은 저층 상가로 변경' },
  'meso.construction': { layer: 'meso', name: '공사장', desc: '재개발구역 필지 일부를 펜스로 둘러친 공사장으로 — 틈새 하나는 열어둔다' },
  'intent.landmark': { layer: 'intent', name: '랜드마크 비스타', desc: '도로 시선축 길이 합이 최대인 필지에 구역 랜드마크 (비스타 종결점 / Weenie)' },
  'intent.spire': { layer: 'intent', name: '중앙탑', desc: '어디서든 보이는 전역 랜드마크. 모든 방사 대로의 소실점' },
  'intent.flow': { layer: 'intent', name: '보행 흐름', desc: '관계 OD(통학·방과후·물류·산책) + 거점 쌍 경로' },
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
  // ---- 도시 골격 (cohesion) ----
  'macro.plan': { layer: 'macro', name: '도시 골격 계획', desc: '환상대로·방사대로·역·광장·옛길을 먼저 깔고, 용도·높이·거리 성격이 모두 이 골격을 읽는다' },
  'macro.ring': { layer: 'macro', name: '학원 환상대로', desc: '네 학원 정문 앞을 꿰는 순환 대로 — 중앙분리대 위로 모노레일' },
  'macro.radial': { layer: 'macro', name: '방사 대로 · 축선 종결', desc: '스파이어에서 출발해 정문·구역 코어·공원 입구에서 끝나는 목적지 대로' },
  'macro.oldroad': { layer: 'macro', name: '옛길(연대기)', desc: '하구 어촌에서 강 단구를 따라 옛 나루까지 — 섬에서 가장 오래된 길과 참배길' },
  'macro.relation': { layer: 'macro', name: '구역 관계 그래프', desc: '통학·방과후·물류·옛길·산책·국경·대로 관계가 배치의 이유가 된다' },
  'meso.station': { layer: 'meso', name: '역세권 · 역전 광장', desc: '역 앞 광장·버스 터미널·역 빌딩 — 역에 가까울수록 높고 붐빈다' },
  'meso.street': { layer: 'meso', name: '이름 있는 거리', desc: '통학로·상점가·어시장 거리·벚꽃 산책길 — 길마다 건축선·차양·배너·아치' },
  'meso.seam': { layer: 'meso', name: '이음매(경계 띠)', desc: '두 구역 사이 띠에는 둘을 잇는 용도(학원가·하숙촌·어시장 골목)가 선다' },
  'meso.threshold': { layer: 'meso', name: '문턱(구역 진입)', desc: '구역 진입점: 압축된 길 → 관문 → 쉼터 광장' },
  'meso.heritage': { layer: 'meso', name: '옛길 필지', desc: '옛길 변은 좁고 깊은 필지, 기와 박공의 노포' },
  'meso.promenade': { layer: 'meso', name: '수변 산책로', desc: '하천 8m 띠는 산책로 — 카페와 벤치가 강을 향한다' },
  'meso.axis': { layer: 'meso', name: '축선 종결 · 조망 보호', desc: '직선 가로 끝에 랜드마크, 시선축을 가리는 건물은 낮춘다' },
  'micro.banner': { layer: 'micro', name: '거리 배너', desc: '가로등 배너 색이 지금 걷는 거리와 세력을 알려준다' },
  'micro.territory': { layer: 'micro', name: '학원 세력권', desc: '정문에서 도로를 따라 번지는 학원 세력: 수종·공고문·최전선' },
  'intent.chain': { layer: 'intent', name: '구역 간 열쇠 사슬', desc: '열쇠는 관계가 있는 이웃 구역의 거리 위에 — 관계를 따라 걷게 한다' },
  // ---- 건축 문법 (architecture) ----
  'arch.style': { layer: 'arch', name: '양식 어휘', desc: '구역마다 300m 밖에서도 읽히는 지붕 실루엣 가족 하나' },
  'arch.dialect': { layer: 'arch', name: '방언', desc: '같은 유형 구역 둘은 맥락으로 갈린다 (중심 가까움=네온, 물가=테라스)' },
  'arch.field': { layer: 'arch', name: '세력 양식장', desc: '학원 정문에서 도로망을 따라 양식이 번진다 — 진입대로가 세력의 거리' },
  'arch.block': { layer: 'arch', name: '블록 유전자', desc: '블록은 한 가족, 필지는 한 층만 변이' },
  'arch.borrow': { layer: 'arch', name: '경계 차용', desc: '소프트 경계에서 색→창→지붕→몸체 순으로 차용. 간선·하천 경계는 차용 없음' },
  'arch.grammar': { layer: 'arch', name: '구성 문법', desc: '발자국·층군 연산·왕관·부착물' },
  'arch.tier': { layer: 'arch', name: '위계·예산', desc: '랜드마크 › 시그니처 › 악센트 › 바탕' },
  'arch.corner': { layer: 'arch', name: '모서리 경첩', desc: '간선 교차점마다 표지 건물' },
  'arch.terminus': { layer: 'arch', name: '비스타 종결', desc: '직선가로 끝은 탑 파사드로 닫는다' },
  'arch.rival': { layer: 'arch', name: '대치 요새화', desc: '라이벌 경계는 섞이지 않고 흉벽과 깃발' },
  'arch.frame': { layer: 'arch', name: '시그니처 무대', desc: '주변은 시그니처보다 2층 낮게' },
  'arch.arcade': { layer: 'arch', name: '가로 회랑', desc: '블록면 전체에 이어지는 아치 회랑' },
  'arch.signature': { layer: 'arch', name: '시그니처 건축', desc: '구조적 이유가 있는 자리에만 서는 판타지 건물' },
  'arch.gateway': { layer: 'arch', name: '경계 관문', desc: '우호 경계를 넘는 간선의 문, 좌우 기둥은 각자의 양식' },
  'arch.skybridge': { layer: 'arch', name: '구름다리', desc: '같은 양식 건물을 잇는 옥상 높이 다리 (옥상 루트 간선)' },
  'micro.canopy': { layer: 'micro', name: '골목 캐노피', desc: '골목 머리 위 양식별 등롱줄·빛 배관 (빨래줄 일반화)' },
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

// ==== 도시 골격 계획 (cohesion track, C§4) ====
// 골격 계획 손잡이: 환상대로·방사대로·역·광장·가로망·이음매·문턱·OD 흐름.
export const PLAN = {
  ring: { rMin: 205, rMax: 270, rAdd: 12, gateJunction: 36, sigmaDeg: 25, devScale: 40, devW: 2.5, devCap: 6,
    maxGapDeg: 70, snapRange: 110, windowDeg: 20, legMaxRatio: 2.0, width: 18, sidewalk: 4, median: 4,
    plazaR: 70, innerSoftR: 150, innerSoftMul: 3, riverCost: 5, seaMargin: 20 },
  radials: { max: 7, mergeDeg: 22, mouthGapDeg: 34, mouthR: 64, maxRiverCross: 50, spurMedian: 3 },
  stations: { max: 7, hardMax: 8, minArc: 170, gateArcPick: 150, gateArcOk: [110, 260], nearGatePenaltyArc: 90 },
  squares: { stationFront: 20, stationBack: 11, gate: 10, gateOffset: 11, core: 12 },
  roads: { dsepMain: 150, maxMainLines: 30, spineSeedStep: 120, coreSeedMinSpine: 90 },
  tensor: { spineW: 1.8, spineL: 45, oldW: 1.3, oldL: 22, oldMinR: 120 },
  seam: { band: 64, coreT: 0.6, pSeam: 0.85, pLeak: 0.35, floorBlend: 0.5, colorBlend: 0.2 },
  height: { ratioCap: 2.5, pairR: 25, iters: 3, axisCapMax: 3, axisMinFloors: 2 },
  streets: { max: 10, perStation: 2, minLen: 90, maxMainFrac: 0.5, jaccard: 0.5, walkMax: 520, maskR: 10 },
  thresholds: { persist: 15, merge: 60, perPair: 2, max: 24, compress: 35, release: [10, 45], skipNearSquare: 40 },
  promenade: { river: 8 },
  od: { scale: 12, genericW: 0.5, maxDist: 1400 },
  placement: { dormTown: 0.8, supply: 0.3, oldPort: 0.6, oldPortSlack: 150, harborMouthSlack: 120, harborMouthDiv: 200 },
};

export const SHORT = { center: '중앙', commercial: '상점가', residential: '주거구', trad_academy: '루미에르', tech_academy: '아르케',
  free_academy: '레드라인', arts_academy: '스텔라', harbor: '청해항', ruins: '구시가지', park: '미라이 공원' };

export const RELATION_KINDS = {
  commute: { name: '통학', color: '#5b6cff', purpose: 'school' },
  afterschool: { name: '방과후', color: '#ff5fa2', purpose: 'shop' },
  supply: { name: '물류', color: '#2f7fbf', purpose: 'market' },
  heritage: { name: '옛길', color: '#a0784a', purpose: 'leisure' },
  leisure: { name: '산책', color: '#3f9a4a', purpose: 'leisure' },
  rivalry: { name: '국경', color: '#e0413b', purpose: 'through' },
  civic: { name: '대로', color: '#8890a0', purpose: 'leisure' },
};
export const ACADEMY_TYPES = ['trad_academy', 'tech_academy', 'free_academy', 'arts_academy'];
export const RELATION_RULES = [
  { from: 'residential', to: ACADEMY_TYPES, kind: 'commute', pick: 2, w: 3 },
  { from: ACADEMY_TYPES, to: ['commercial'], kind: 'afterschool', pick: 1, w: 2 },
  { from: 'harbor', to: ['commercial', 'center'], kind: 'supply', pick: 1, w: 1.5 },
  { from: 'ruins', to: ['harbor'], kind: 'heritage', pick: 1, w: 1 },
  { from: 'park', to: ['arts_academy', 'residential', 'trad_academy'], kind: 'leisure', pick: 2, w: 1 },
  // RIVALS → rivalry (w 0.8); every radial → civic(center, dest district) (w 1);
  // Kruskal over adjacent pairs (border > 80 cells at stride 2) adds civic edges until the graph is connected. Cap 24 edges.
];
export const RELATION_STORY = {
  commute: '{A} 학생들이 매일 {B}로 등교', afterschool: '{A} 방과후 → {B}', supply: '{A}의 물자가 {B}로',
  heritage: '{A}는 {B}의 옛 포구에서 시작', leisure: '{A} 사람들의 산책 → {B}', rivalry: '{A} vs {B} — 국경', civic: '{B} → 스파이어 대로',
};

export const STREET_CHAR = { // buildTo = front setback range (m); grain = frontage range (m)
  ring: { buildTo: [2, 3.5], faceVar: 1, trees: 'double', lamp: 'twin' },
  radial: { buildTo: [1.5, 3], faceVar: 1, trees: 'row', lamp: 'twin' },
  shotengai: { buildTo: [0, 0.4], faceVar: 1, awning: 'continuous', grain: [7, 11], banner: true, arch: true, covered: 80 },
  gakuen: { buildTo: [0.3, 1.2], faceVar: 1, awning: 'continuous', grain: [8, 13], banner: true, arch: true, sakura: 10, poster: true },
  market: { buildTo: [0, 0.5], faceVar: 1, awning: 'continuous', grain: [8, 12], banner: true, arch: true },
  promenade: { buildTo: [3, 5], awning: 'cafe', sakura: 10, bench: 24 },
  old: { buildTo: [0, 0.6], grain: [6, 10], depth: [12, 18], lantern: 18 },
};
export const SCHOOL_ROAD_NAMES = { trad_academy: '루미에르 언덕길', tech_academy: '아르케 테크로드', free_academy: '레드라인 골목길', arts_academy: '스텔라 오선지 거리' };
export const PURPOSE_COLORS = { commute: '#20a8a0', school: '#5b6cff', shop: '#ff8a3d', leisure: '#3f9a4a', market: '#2f7fbf' };

// 학원 세력: 양식 키, 도로 측지 감쇠 길이 L(m), 가로수 수종 색 (free_academy: 나무 대신 자전거 거치대)
// (SPECIES · ACADEMY_LAMBDA를 대체한다 — plan §1 D3)
export const FACTIONS = {
  trad_academy: { style: 'lumiere', L: 150, species: '#f7a8c8' },
  tech_academy: { style: 'arche', L: 140, species: '#e8c547' },
  free_academy: { style: 'redline', L: 180, species: null },
  arts_academy: { style: 'stella', L: 150, species: '#b48fd8' },
};
