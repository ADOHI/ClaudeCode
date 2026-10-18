# Bust Morph Lab

스타일라이즈드(애니풍) 성인 여성 캐릭터의 바스트 형태 모프를 **블렌드 셰이프로 굽는 방법론**을 검증하는 Three.js 프로토타입입니다.
최종 파이프라인은 **Blender 셰이프 키 → FBX → Unity 블렌드 셰이프**이며, 여기서는 그 앞단의 알고리즘과 검증 도구를 다룹니다.

> 상태: 연구용 프로토타입 (비공개 테스트). **로컬에서 이어서 작업하려면 [docs/HANDOFF.md](docs/HANDOFF.md)부터 읽으세요.**
> 현재 뷰어: 정적 체형 모프 + **깊이층을 가진 3D 체적 연조직 동역학**. 실제 흉부 가속·회전으로 구동하며 피부·밀착 의상에 공통 변형을 전달합니다.
> 형상 생성/증류 경로: FEM 준정적 teacher와 바인드 공간 Kelvinlet 필드. dARAP 등은 미완성 후보이며, 새 동역학의 Unity 이식은 아직 남아 있습니다.
> 동작 연구와 구현 상태는 [연조직 v3](docs/research/soft-tissue-motion-v3.md), 이전 결정은 [decision-v2](docs/research/decision-v2.md)를 참고하세요.

## 구조

```
web/
  src/core/        엔진 비의존 순수 JS (Blender/Unity 포팅 대상)
    field.js       바인드 공간 변형 필드: 컴팩트 C2 윈도 × 브러시 합, 중앙선 분할/잠금
    kelvinlet.js   Regularized Kelvinlets (grab/scale, tri-scale 국소화, 완전 텐서형)
    bake.js        정점별 위치/노멀 델타 굽기 (노멀은 F^-T 해석적 변환)
    validate.js    단사성 det(I+J)>0, 이음새 일치, 삼각형 뒤집힘, 노멀 정확도
    autofit.js     높이맵 래스터화 + erosion으로 가슴 정점 자동 탐지
    runtime.js     실제 흉부 움직임 추적, 비교용 모달 동역학, 팔 들기 포즈 보정
    tissue.js      분포 tet XPBD: Green strain, 요소/구역 체적, 관성, 감쇠, 안전 제한
    tissue-proxy.js 정적 체형에 맞춘 체적 격자와 공통 표면 embedding
    tissue-region.js 실제 밑선·옆면 단면으로 부착 범위와 흉벽 추정
    tissue-transfer.js 표시 맵의 연속적인 안전 제한
  src/viewer/      three.js 뷰어 (VRM/GLB/FBX 로드, 슬라이더, 히트맵, 검증 HUD)
    morpho.js      형태계측 (상:하 볼륨비, 정점 각도, IMF 높이 등)
    modal.js       정확 이산화 모달 지글
    vskin.js       Velocity Skinning 스타일 셰이프
  test/            불변식 단위 테스트 (node --test)
  scripts/         모델 다운로드, 바인드 내보내기, 헤드리스 스크린샷, A/B 컨택트 시트
tools/             베이크 시점 Python 도구
  bustfield/       필드 Python 포트(JS와 1e-9 일치), teacher -> 필드 증류, 프로파일 곡선 역피팅
  teacher/         FEM 준정적 해석 teacher (성장, 중력, 인대, 역 rest-shape, 진동 모드)
  morpho/          형태계측 Python 미러
docs/              HANDOFF(인계), DECISIONS(결정), PHASE1_PLAN(작업 명세), research/(리서치)
wip/phase1/        중단된 작업의 부분 코드 (미검증)
```

## 실행

2026-10-18 뷰어 통합: params JSON A/B, 캐릭터 프로필, 형태계측 HUD에 이어
448노드/1512tet의 3D 연조직 경로를 기본으로 연결했습니다. 정점만 흔들리지 않도록
전체 밑면을 추정하고 고정 collar를 바깥에 둡니다. 크기 변경 시 rest 체적과
질량을 재생성합니다. 사용법·검증·현재 한계는 [docs/VIEWER.md](docs/VIEWER.md),
이식 수식과 golden 데이터는 [docs/METHOD.md](docs/METHOD.md)를 참고하세요.

```bash
cd web
npm install
npm run fetch-model   # public/models/ 에 테스트 모델 다운로드 (git에 커밋하지 않음)
npm run dev           # http://localhost:5173  (?model=/models/Michelle.glb 로 모델 지정, 파일 드래그&드롭 가능)
npm test              # 불변식 테스트
```

## 블렌드 셰이프

| 이름 | 의미 |
|---|---|
| `bust_size_up_natural` | 자연형 확대: 하부 볼륨 증가(상:하 ≈ 45:55), 약한 중력 처짐 |
| `bust_size_up_stylized` | 과장형 확대: 상부가 둥글게 차오르고 정점이 위·앞으로 (애니풍 어필) |
| `bust_size_down` | 축소 |
| `bust_lift_up` / `bust_lift_down` | 올림 / 내림 |
| `bust_spread_out` / `bust_spread_in` | 벌림 / 모음 |

UI의 `size`, `style`, `lift`, `spread` 슬라이더는 위 셰이프의 0..1 가중치로 매핑됩니다 (`sliderToWeights`).
`style`은 두 확대 셰이프를 섞습니다. Unity에서는 `SetBlendShapeWeight`에 ×100 해서 넣습니다.

## MMD(PMX) 모델

PMX는 `@moeru/three-mmd`로 읽습니다 (three r172에서 공식 MMDLoader가 제거됨).
- 텍스처가 별도 파일이므로 **폴더째 드래그&드롭**하거나, zip을 드롭하거나, `load PMX folder…` 버튼을 쓰세요.
  (zip 파일명 인코딩 기본값은 Shift_JIS, 중국어 배포본은 `?zipEncoding=gbk`)
- `public/models/<이름>/` 아래에 두면 `?model=/models/<이름>/<파일>.pmx`로도 열립니다.
- PMX 표정 모프는 밀집 절대좌표로 들어와 메모리를 많이 써서 기본적으로 제거합니다 (`?keepMorphs=1`로 유지). 유지된 절대 모프는 리그 준비 시 상대 델타로 변환해 기존 가중치를 보존하고 실시간 조직 변형과 합성합니다.
- MMD 단위(약 8cm)는 0.08배로 미터에 맞춥니다.

**명조(鸣潮) 공식 MMD 모델 주의사항**: 공식 배포처는 aplaybox(`https://www.aplaybox.com/u/811099367`)입니다.
Readme 약관상 개조는 허용되지만 재배포(개조 여부 무관), 상업 사용, 소체화/R18 개조, 캐릭터 모욕, 공서양속 위반은 금지이고,
일부 캐릭터(카멜리아, 카를로타 등)는 MMD 영상 외 사용도 금지합니다. 이 저장소에는 포함하지 않으며,
비공개 기술 테스트에만 사용하세요. 실제 게임 빌드에는 직접 보유한 캐릭터를 써야 합니다.

## 테스트 모델 라이선스

모델 파일은 저장소에 포함하지 않습니다. `npm run fetch-model`이 다음을 받습니다.
- Seed-san — [VRM Public License 1.0](https://vrm.dev/en/licenses/1.0/), VirtualCast, Inc. (가슴이 평평해서 의상/끈/이음새 테스트용)
- Michelle — three.js examples에 포함된 Mixamo 캐릭터
