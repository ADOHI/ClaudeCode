# 로컬 인계 문서

## 2026-10-18 이어받기 업데이트

이번 로컬 작업의 현재 상태입니다. 아래 구분선 뒤는 2026-10-16 클라우드 당시의 기록이며,
그 부분의 미구현 목록·테스트 수는 현재 상태와 다를 수 있습니다.

- 뷰어 params JSON 불러오기/이름별 A/B 전환, 불러온 필드의 anchor 보존
- 캐릭터 프로필의 본·머티리얼 역할·영역 덮어쓰기, 실시간 형태계측 HUD
- 전용 modal/vskin 타깃 베이크와 새 runtime API 연결, 실제 dt/흉부 회전 입력
- 런타임·형태계측·Python 필드/FEM 도구 독립 코드 리뷰와 재현 가능한 오류 수정
- synthetic golden 데이터, 조합/중간 가중치 det·노멀 오차 분석, METHOD 명세
- 실제 공개 모델 2개를 로드하는 브라우저 검증 스크립트
- 장리 배포본을 로컬 웹뷰에 연결 (원본·텍스처·렌더는 저장소 제외)
- 단일 이동 모드의 한계를 다룬 [연조직 연구 v3](research/soft-tissue-motion-v3.md)
- 기본 동역학을 240노드/720tet의 3D Green-strain XPBD 체적 proxy로 전환
- 실제 흉부 관성 입력, 깊이별 변형, 요소/좌우 구역별 체적, 고정 흉벽·rim
- 피부·밀착 의상의 공통 표시 맵, `F^-T` 노멀, solver/표시 맵의 별도 안전 제한
- 체형 슬라이더 변경 시 rest 기하·질량 재생성, 기존 절대 모프의 상대 델타 변환
- 시험 몸통 운동의 cusp·속도 편집 위상 점프·정지 스냅 수정

실행 및 프로필 형식: [VIEWER.md](VIEWER.md). 현재 JS **96개 통과**. 앞선 Python
수정 단계에서는 115개 통과, 모델 fixture 부재로 7개 생략했습니다. 이번 동역학 변경은
JS에만 있습니다. 기본 모델 2개에서 기존 뷰어 검사, Michelle·장리에서 3D 조직 브라우저
검사를 통과했습니다. 30/60/120fps 연속 흉부 입력의 조직 궤적도 단위 시험으로 비교합니다.

현재 3D 경로는 PC 연구용이며, 정확한 Stable Neo-Hookean 구현·완전한 점탄성·피부 쉘·
의상 접촉 solver는 아닙니다. 고정 모드보다 분포 변형을 직접 평가하는 단계입니다.
실제 걷기/착지/회전 클립의 착의 시각 평가, FEM 진동 모드의 셰이프 증류/연결,
garment-tier1, dARAP, 모델별 7타깃 FEM 증류/최적화, Blender/Unity 이식은 남아 있습니다.
맵 절차생성 브랜치/파일은 수정하지 않았습니다.

---

클라우드 세션(2026-10-16)에서 진행한 작업을 로컬에서 이어가기 위한 문서입니다.
먼저 [README](../README.md), 그다음 [결정 사항](DECISIONS.md), [리서치 결정 v2](research/decision-v2.md)와 [비평](research/critique-v2.md) 순으로 읽으면 됩니다.

## 1. 지금 상태 요약

**목표**: 애니풍 성인 여성 캐릭터의 바스트 형태 모프를 블렌드 셰이프로 굽는 방법론. 자연스러우면서 과장된 매력.
최종 경로는 Blender 셰이프 키 → FBX → Unity 블렌드 셰이프 (+ Unity 임포트 시 C# 재굽기).

**아키텍처 (decision-v2)**

```
teacher (형상 생성)                         student (전달층)                  출력
FEM 준정적 해석 (tools/teacher)    ─┐
dARAP 스타일화 (wip, 미완)          ├─ 증류 ─>  바인드 공간 필드 (field.js)  ─>  블렌드 셰이프 (위치 + F^-T 노멀)
프로파일 곡선 역피팅 (bustfield)    ─┘          Kelvinlet 사전 + 윈도 + 중앙선      검증 게이트 (det, 이음새, 뒤집힘)
```

| 영역 | 상태 | 위치 |
|---|---|---|
| 필드, 굽기, 검증, 자동 맞춤 (JS) | 완료, 테스트 있음 | `web/src/core/` |
| 뷰어 (VRM/GLB/FBX/PMX, 슬라이더, 히트맵, HUD) | 완료 | `web/src/viewer/` |
| 필드 Python 포트 (JS와 1e-9 일치) + 증류 + 프로파일 곡선 피팅 | 완료, 머지됨, **독립 리뷰 전** | `tools/bustfield/` |
| FEM teacher (성장·중력·인대, 역 rest-shape, 진동 모드) | 완료, 머지됨, **독립 리뷰 전** | `tools/teacher/` |
| 런타임 (dt 버그 수정, 정확 이산화 모달 지글, Velocity Skinning 셰이프) | 완료, 머지됨, **독립 리뷰 전** | `web/src/core/{runtime,modal,vskin}.js` |
| 형태계측 (Mallucci 비율 등, JS + Python) + A/B 컨택트 시트 | 완료, 머지됨, **독립 리뷰 전** | `web/src/core/morpho.js`, `tools/morpho/`, `web/scripts/contact-sheet.mjs` |
| 의상 Tier 1 (클리비지 브리징, 끈) | **중단, 부분 코드만** | `wip/phase1/garment-tier1/` |
| dARAP 스타일화 | **중단, 부분 코드만** | `wip/phase1/darap-stylize/` |
| golden 데이터 + 조합 분석 + METHOD.md | **시작 전** | [PHASE1_PLAN.md](PHASE1_PLAN.md) |

테스트: JS 51개, Python 107개(bustfield 67, morpho 14, teacher 26) 모두 통과. `vite build` 성공.

**머지된 4개 패키지는 구현 에이전트가 테스트까지 했지만, 계획했던 독립 검증자 리뷰는 거치지 않았습니다.** 로컬에서 먼저 리뷰하세요.

## 2. 로컬 환경 준비

```bash
git clone https://github.com/ADOHI/ClaudeCode && cd ClaudeCode
git checkout claude/great-volta-1f210v

# 웹 (Node 22 권장)
cd web && npm install
npm run fetch-model          # Seed-san, Michelle -> web/public/models/ (git-ignored)
npx playwright install chromium   # 헤드리스 스크린샷/내보내기 스크립트용
npm test && npm run dev      # http://localhost:5173

# Python (3.11+; 클라우드에서는 3.13으로 검증)
cd .. && python -m venv .venv && .venv/bin/pip install -r tools/requirements.txt pytest
(cd tools/bustfield && ../../.venv/bin/python -m pytest -q)
(cd tools/morpho && ../../.venv/bin/python -m pytest -q)
(cd tools/teacher && ../../.venv/bin/python -m pytest -q)
```

**명조 장리(Changli) 테스트 모델**: 공식 배포처 aplaybox(https://www.aplaybox.com/u/811099367)에서 직접 받아
`web/public/models/Changli/` 에 풀어 두세요 (`Changli.pmx` + `textures/` 등). 약관상 재배포 금지이므로 저장소에 넣지 않습니다.
뷰어에서 `?model=/models/Changli/Changli.pmx` 로 열거나 폴더째 드래그&드롭합니다.

클라우드 스크립트들은 Chromium 경로로 `/opt/pw-browsers/...`가 있으면 그것을 쓰고, 없으면 Playwright 기본 브라우저를 씁니다 (`CHROME_PATH`로 지정 가능).

## 3. 파이프라인 실행 (현재 가능한 범위)

```bash
cd web && npm run dev &      # 아래 내보내기는 dev 서버가 필요

# 1) 바인드 공간 내보내기 (bust-bind/1)
node scripts/export-bind.mjs /models/Changli/Changli.pmx .cache/changli.bind.json

# 2) FEM teacher (CPU 약 5분)
cd .. && .venv/bin/python -m tools.teacher.bake --bind web/.cache/changli.bind.json --preset changli \
    --out web/.cache/teacher/changli

# 3) 증류: teacher -> 필드 파라미터 JSON (타깃마다 teacher NPZ 하나, 약 3초)
cd tools && ../.venv/bin/python -m bustfield.distill --bind ../web/.cache/changli.bind.json \
    --teacher samples:../web/.cache/teacher/changli/bust_size_up_natural.npz --targets bust_size_up_natural \
    --out ../web/.cache/fem_natural.params.json --report ../web/.cache/fem_natural.report.json

# 4) 형태계측 보고
node tools/morpho/report.mjs web/.cache/changli.bind.json

# 5) A/B 컨택트 시트 (렌더는 저장소 밖으로)
cd web && node scripts/contact-sheet.mjs --model /models/Changli/Changli.pmx --base http://localhost:5173/ --out /tmp/sheet
```

**첫 end-to-end 결과 (클라우드, 장리, 기본 다이얼)**: FEM `bust_size_up_natural`을 측면당 원자 48개로 증류하면 피부 RMS 오차 6.3%
(목표 ≤ 3%). 접힘 게이트는 0.2 기준 미달(고해상도 격자 min det 0.162)인데, 원인은 아직 손 튜닝 상태인 다른 타깃들의 조합입니다.
→ 다음 단계: 7개 타깃을 모두 FEM으로 증류하고, 3%를 못 맞추면 decision-v2의 결정 게이트대로 사전 확대 / RBF 잔차 필드를 검토.
(이 세션에서 teacher NPZ의 `U`/`target` 형식을 distill이 읽지 못하던 인터페이스 버그를 고쳤습니다.)

정확한 인자는 각 README가 기준입니다: [tools/teacher](../tools/teacher/README.md), [tools/bustfield](../tools/bustfield/README.md), [tools/morpho](../tools/morpho/README.md).
**아직 뷰어가 증류된 params JSON을 불러오는 기능이 없습니다** (다음 작업 2번).

## 4. 다음 작업 (우선순위 순)

1. **머지된 4개 패키지 독립 리뷰.** 각 패키지의 합격 기준은 [PHASE1_PLAN.md](PHASE1_PLAN.md)에 있습니다. 부호·좌표계(사이드 프레임, 바인드 vs 로컬), S 단위, 테스트가 동어반복이 아닌지 확인.
2. **뷰어 통합**
   - params JSON 불러오기/전환 (손 튜닝 기본값 ↔ FEM 증류 결과 ↔ 프로파일 피팅 결과 A/B)
   - 형태계측 HUD (morpho.js, 슬라이더 변경 시 스로틀링해서 재계산)
   - 새 런타임 API로 전환: `bustWeights`, vskin 셰이프(`runtimeTargets()`)도 같이 굽기, FEM 진동 모드 연결 (`DEFAULT_DYNAMICS.modes`)
   - **캐릭터 프로필 JSON** ([DECISIONS.md](DECISIONS.md)): 본 매핑, 몸/의상 머티리얼 역할, 의상 Tier·두께, 앵커 덮어쓰기
3. **남은 Phase 1 패키지**: garment-tier1, darap-stylize, golden-spec. 명세는 [PHASE1_PLAN.md](PHASE1_PLAN.md), 부분 코드는 `wip/phase1/` (미검증, 테스트 없음 — 참고용으로 보고 다시 작성해도 됨).
4. **P1-6 최적화 루프**: teacher 물리 다이얼(≤8) × 증류 × 형태계측 → CMA-ES / Pareto, natural은 Mallucci 대역, stylized는 애니 가설 대역.
5. **아트디렉터 선호 세션 (PBO)**: optuna-dashboard `PreferentialGPSampler`로 A/B 선택 → 효용 학습 → 파라미터 선택.
6. **Phase 2 (로컬 전용)**
   - Blender 베이크 애드온: `tools/bustfield`(numpy)를 bpy에서 그대로 쓰고 셰이프 키로 굽기. `vertex_group` 마스크는 쓰지 말고 델타에 곱할 것.
   - Unity AssetPostprocessor: C# 필드 포트로 임포트 시 재굽기 (FBX 셰이프 노멀은 커스텀 노멀을 잃기 때문, decision-v2 3(e)). golden 테스트로 JS/Python/C# 일치 확인. Unity는 왼손 좌표계라 `forward = cross(up, left)`.
   - 런타임 MonoBehaviour (BustDynamics/bustWeights 포트).
   - 작업 PC(24 GB)에서 고해상도 FEM (Newton VBD GPU).

## 5. 알려진 한계

- FEM teacher는 높이맵 프록시 볼륨이라 하부 오버행이 볼륨 안에 묻히고, 흉벽이 고정 경계(미끄럼 없음)입니다. 기본 다이얼에서 natural/stylized 차이는 실제로 있지만 작습니다. 다이얼 선택은 최적화 루프의 몫입니다. 자세한 것은 `tools/teacher/README.md`의 Limitations.
- 장리는 상의 밑에 피부가 없어 밀착 상의(`UP`)를 피부 대신 씁니다. 클리비지 아래는 부드러운 filler입니다.
- 앵커가 중앙선에 0.18S 이하로 가까운 체형은 일부 극단 조합에서 det가 0 근처까지 떨어집니다 (검증 게이트가 잡아냄).
- Anny는 통계적 사전이 아닙니다 (아티스트 타깃). 분포 클래스는 소아 데이터로 보정돼 있으므로 쓰지 않습니다 (critique-v2).
- 런타임/지글은 아직 FEM 모드가 아니라 기존 셰이프에서 만든 pseudo-mode로 동작합니다.
