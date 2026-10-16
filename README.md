# 루미나 학원도시 — 절차 생성 + 규칙 기반 레벨 디자인 프로토타입

서브컬쳐 학원도시 오픈월드의 **맵을 절차 생성**하고, 생성된 공간을 **분석한 결과를 근거로 규칙이 레벨 디자인**하는 웹 프로토타입이다.
비주얼은 러프한 블록아웃이지만, 모든 오브젝트는 색과 실루엣으로 구별되고 클릭하면 **어떤 규칙이 왜** 배치했는지 볼 수 있다.

- 기술 리서치: [docs/RESEARCH.md](docs/RESEARCH.md)
- 레벨 디자인 명세: [docs/DESIGN.md](docs/DESIGN.md)

## 실행

```bash
npm install
npm run build                 # index.html(개발) + dist/academy-city.html(단일 파일 배포본)
npx http-server -p 8123 .     # http://127.0.0.1:8123/index.html
```

- 조감 모드: 좌드래그 이동 · 우드래그 회전 · 휠 확대 · 클릭으로 배치 근거 보기 · 레이어/분석 오버레이/규칙 강조
- 탐험 모드(`M`): WASD · Shift 달리기 · Space 점프/매달려 오르기 · E 사다리/문 · V 1인칭
- URL 해시로 시드 공유: `index.html#sakura-123`

## 헤드리스 도구

```bash
node tools/headless.mjs lumina --png map.png --json world.json   # 단계 타이밍, 로그, 지표, 탑다운 PNG, 엔진용 JSON
node tools/seed-search.mjs 24 city                                # MAP-Elites 품질 다양성 탐색
node tools/shot.mjs http://127.0.0.1:8123/index.html out/         # 브라우저 스크린샷 (Playwright)
node tools/test-explore.mjs http://127.0.0.1:8123/index.html out/ # 사다리·열쇠/문·수집·매달리기 자동 검증
```

## 구조

```
src/core/      엔진 독립 생성기 (three.js 의존 없음, Node에서 그대로 실행)
  rng.js         시드 RNG(fork로 단계 격리) + Simplex
  grid.js        그리드, EDT, 다익스트라, 연결요소, OBB 기하
  config.js      구역 원형 · 색 · 규칙 레지스트리 (데이터 주도)
  terrain.js     섬 · 만 · 곡류 하천
  districts.js   포아송 + 로이드 + 제약 점수 배정 + 왜곡 보로노이 + 캠퍼스/공원 코어
  roads.js       텐서장 가로망 (Chen 2008), 진입대로, 해안도로, 끝점 연결, 래스터, 교차점
  blocks.js      블록 추출, 관통 골목, 둘레형 필지 + 안뜰 통로, 접도 판정
  buildings.js   프로그램 표 · 용도 가중치 · 매싱/파사드/옥상 문법
  city.js        거점, 랜드마크 비스타, 용도 배정, 중앙탑, 컨테이너 미로, 항만
  campus.js      학원 캠퍼스 문법 (축선 + 탐색 배치 + 담장)
  park.js        호수 · 세계수 · MST+사이클 산책로
  rail.js        모노레일 환상선 + 고가 밑 클리어런스
  props.js       마이크로 규칙
  analysis.js    보행 흐름 · 아이소비스트 숨김도 · 우회거리 · 위요도
  intent.js      의도 레이어 (리듬, 비밀, 흔적, 옥상 루트, 자물쇠/열쇠, 막다른 길, 국경, 표지판)
  metrics.js     품질 지표 + 행동 기술자
  collision.js   2층 높이장 충돌
  export.js      엔진 임포트용 JSON
src/render/    three.js 인스턴싱 렌더러, 지면 텍스처, 히트맵, 라벨
src/game/      탐험 모드 (캐릭터, 충돌, 사다리, 문, 수집)
src/main.js    앱 / UI
```
