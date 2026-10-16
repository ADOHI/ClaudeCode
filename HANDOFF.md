# 작업 인계 (HANDOFF) — 2026-10-16

로컬에서 이어서 작업하기 위한 현재 상태 정리.

## 0. 받기

저장소: https://github.com/ADOHI/ClaudeCode (이 프로젝트는 별도 브랜치에만 있고 기본 브랜치와 이력이 섞이지 않음)

```bash
git clone -b academy-city/main --single-branch https://github.com/ADOHI/ClaudeCode academy-city
cd academy-city
git fetch origin academy-city/wip-redesign:wip/redesign   # 진행 중 브랜치도 받기
npm install
```

| 원격 브랜치 | 로컬 이름 |
|---|---|
| `academy-city/main` | `master` |
| `academy-city/wip-redesign` | `wip/redesign` |

## 1. 브랜치 구조

| 브랜치 | 상태 | 내용 |
|---|---|---|
| `master` | **안정. 실행됨** | v1 프로토타입(절차 생성 + 의도 레이어 + 3D 뷰어/탐험 모드) + 재설계 문서. 공개된 아티팩트와 같은 코드 |
| `wip/redesign` | **미완성. 실행 안 됨** | 재설계 구현 도중 멈춘 코드. 아래 §4 참조 |

```bash
git log --oneline --all --graph
git checkout master          # 안정 버전
git checkout wip/redesign    # 진행 중 작업
```

## 2. 실행 (master)

```bash
npm install                                   # three@0.160.0, esbuild
npm i -D playwright                           # (선택) 스크린샷/탐험 테스트용. 전역 설치가 있으면 생략
node tools/build.mjs                          # index.html(개발) + dist/academy-city.html(단일 파일)
npx http-server -p 8123 -c-1 .                # http://127.0.0.1:8123/index.html
node tools/headless.mjs lumina --png map.png  # 헤드리스 생성 + 지표 + 탑다운 PNG
node tools/sweep.mjs                          # 10개 시드 견고성 검사
node tools/test-explore.mjs http://127.0.0.1:8123/index.html out/   # 사다리/열쇠·문/수집/매달리기
```

공개 아티팩트(v1): https://claude.ai/artifact/6ZiUDPUvD89QzW7XuJCd67

## 3. 사용자 피드백과 재설계 방향

v1에 대한 피드백:
1. **청크 사이 유기성이 없다.** 구역마다는 이해되지만, 서로 관계없이 흩뿌린 것 같고 사람이 계획한 도시처럼 보이지 않는다.
2. **건물 스타일이 너무 비슷하다.** 판타지 세계관이니 독창적인 건물이 여럿 나와야 한다.

설계 패널(제안 6 → 심사 6 → 종합 2 → 통합 계획 1)이 만든 문서:

| 파일 | 내용 |
|---|---|
| `docs/specs/cohesion.md` | 유기성 트랙 명세: 학원 환상대로(+모노레일 중앙분리대), 목적지에서 끝나는 방사 대로, 역 우선 배치(TOD), 역전·정문 광장, 하구 어촌에서 시작하는 옛길, 구역 관계 그래프(통학·방과후·물류·산책·국경), 이름 있는 거리, 경계 이음매 띠, 문턱, 건물마다 '왜 여기에' 인과 사슬 |
| `docs/specs/architecture.md` | 건축 트랙 명세: 12개 양식 어휘(헤일로 신고전, 네온 적층, 등롱 바자르, 장미 고딕, 에테르 기계, 고철 펑크, 성좌 오페라, 청해 부두, 숲의 정자, 옛 루미나 …), 구성 문법(평면 → 층 연산 → 크라운 → 부착물), 4단 위계(랜드마크 › 시그니처 › 악센트 › 일반), 시그니처 16종(찻주전자 카페, 책탑 기숙사, 하늘고래 갈비뼈 시장, 마녀 모자 탑, 중력 흉터, 부유 정원섬 …) |
| `docs/redesign/plan.md` | **두 트랙을 합친 구현 계획 (이 문서가 우선)**: 결정 D1–D20, 목표 파이프라인(16단계), 파일 소유권, 공유 데이터 계약, 예산, 수용 기준 |
| `docs/redesign/wp-*.md` | 병렬 구현용 작업 패키지 5개 (A 골격, B 도시 조직, C1 양식 문법, C2 시그니처, D 렌더/UI) |
| `docs/redesign/before/*.png` | 재설계 전 스크린샷 (비교용) |

## 4. `wip/redesign` 브랜치에서 멈춘 지점

5개 패키지를 병렬로 구현하던 중, 토큰 절약을 위해 중단했다. 커밋 시점에 들어 있던 것:

| 패키지 | 진행 | 파일 |
|---|---|---|
| A 골격 | 일부 | `config.js`(PLAN 표·규칙·ROAD.OLD 등), `terrain.js`(riverMouths), `districts.js`(관계 어닐링 항, district2/seamMargin), 신규 `history.js`, `structure.js`, `seams.js`, `tools/check-plan.mjs` |
| B 도시 조직 | 일부 | 신규 `zoning.js`(데이터), `city.js` 수정 중 (`props.js`의 `addBusStop` 등을 import하지만 아직 없음 → **현재 실행 실패**) |
| C1 / C2 / D | 시작 전 | — |

알려진 깨짐: `node tools/headless.mjs`가 `props.js does not provide an export named 'addBusStop'`로 실패한다. B 패키지의 props.js 작업이 들어가기 전에 멈췄기 때문이다.

## 5. 다음 단계 (권장 순서)

1. `wip/redesign`에서 A 패키지를 마저 끝낸다 (`docs/redesign/wp-A-skeleton.md`). 우선 legacy parity부터 확인한다: `{plan:false, arch:0}` 결과가 커밋 `e1661f2`(= master의 v1 코드)와 같아야 한다.
2. B 패키지(`wp-B-fabric.md`): props.js·intent.js·rail.js·park.js·metrics.js를 끝내고 city.js와 맞춘다.
3. C1 → C2 → D 순서로 진행한다. 파일 소유권이 겹치지 않으므로 병렬도 가능하다.
4. lead 통합(plan.md "Integration steps"):
   - generator.js에 §2 STAGES를 배선한다.
   - metrics.js에 LEAD 3줄을 추가한다.
   - check-*.mjs와 sweep을 돌린다.
   - before/after 스크린샷을 비교한다.
   - 빌드하고 재배포한다.
5. 범위가 너무 크면 **최소 버전**을 먼저 만든다. 사용자 피드백에 가장 직접적인 부분은 다음 다섯 가지다.
   - 환상대로 + 방사 대로 + 역 광장 (A의 structure.js)
   - 이름 있는 거리 (A의 streets.js)
   - 경계 이음매 블렌딩 (A의 seams.js + B의 zoning)
   - 양식 어휘 + 크라운 (C1)
   - 시그니처 6종 (C2: lantern_tower, gacha_tower, teapot_cafe, book_tower, container_babel, witch_hat)

## 6. 코드 지도 (master)

- `src/core/` — 엔진 독립 생성기. three.js 의존이 없어 Node에서 그대로 돈다. 단계 순서는 `generator.js`의 `STAGES`.
- `src/render/`, `src/game/`, `src/main.js`, `src/app.html` — three.js 뷰어, UI, 탐험 모드.
- `tools/` — 헤드리스·스윕·시드 탐색(MAP-Elites)·스크린샷·탐험 테스트·빌드.
- `docs/RESEARCH.md` — 기술 리서치(출처 66개). `docs/DESIGN.md` — v1 규칙 명세.
