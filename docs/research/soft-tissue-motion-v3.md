# 3D 연조직 움직임 보완 조사: 체적 이동과 공간적 지연

- 조사일: 2026-10-18
- 대상: 착의된 성인 애니 캐릭터의 자연스럽고 과장 가능한 바스트 움직임
- 선행 문서: [결정 v2](decision-v2.md), [원자료 v2](techniques-v2.md), [비평 v2](critique-v2.md)
- 이 문서는 **문헌에서 확인한 사실**, **현재 코드**, **이번 프로젝트에 적용할 설계 판단**을 구분한다. 논문을 인용하거나 구현 계획을 적은 것은 그 기법이 뷰어에 연결됐다는 뜻이 아니다.

## 1. 기존 조사의 실제 상태

v2가 단순 스프링만 조사한 것은 아니다. 체적 FEM, 피부 장력, 역 rest-shape, 리그 보완 모드, 비선형 모드와 이차 교정을 이미 다룬다. 다만 대부분을 오프라인 teacher 또는 후속 단계로 미뤘고, 런타임을 처음부터 소수의 선형 블렌드 셰이프로 제한했다. 이 결정 때문에 현재 보이는 동작과 조사 내용 사이에 큰 간격이 생겼다.

이 보완 조사를 시작할 때의 코드에서:

| 경로 | 실제 역할 | 해당 경로만으로 입증하지 못하는 것 |
|---|---|---|
| `web/src/core/modal.js`의 `pseudoModes` | 좌우 두 점 질량의 3축 대칭·반대칭 이동을 가정한 6개 모드 | 내부 조직의 공간적 변형, 압력 전달, 비선형 체적 이동 |
| 같은 파일의 `modeTargets` | 각 이동을 Kelvinlet grab 필드 타깃으로 표현 | 실제 FEM 고유모드 또는 유한변형 재질 |
| `web/src/core/runtime.js` | 흉부 이동·회전·중력 변화로 모드 구동, 감쇠 진동자의 정확 스텝 | FEM 변형 에너지에 기초한 런타임 동역학 |
| `web/src/core/vskin.js` | 속도 등에 의한 스타일 필드 | 점탄성 조직 자체의 시뮬레이션 |
| `tools/teacher/modal.py` | FEM 평형점의 접선 강성에서 고유모드 계산 | 해당 모델의 모드를 자동으로 웹에 적재하는 경로 |
| `web/src/viewer/motion.js` | 시험용 몸통 상하운동·팔 움직임 | 걷기·달리기·착지 애니메이션의 품질 검증 |

따라서 기존 웹 데모는 **준비된 필드와 점 질량 모드의 개념 검증**이었다. 내부 깊이 방향으로 분포한 조직 자유도가 없으므로, 적분기를 정교하게 만들어도 말랑한 부피의 국소 이동까지 생기지는 않는다. 테스트 통과 수와 실제 조직 움직임의 시각 품질은 별개다.

## 2. '애니메이션 Hz'와 '조직 Hz'를 연결하는 올바른 의미

두 수치를 같게 만드는 것이 목표는 아니다. 몸통 운동은 입력이고 조직의 고유진동수는 크기·질량·재질·부착 조건의 성질이다. 주기적으로 몸통을 흔들면 과도응답이 사라진 뒤의 강제응답은 입력의 주기를 따르되, 크기와 위상은 재질에 따라 달라진다. 시작·정지·착지 직후에는 여러 고유모드의 잔향이 겹친다.

프로젝트에서 확인할 것은 다음이다.

1. 몸통이 가속할 때 부착부가 먼저 움직이고, 전방·하부가 관성으로 뒤따르는가.
2. 입력을 멈추면 외부 주기 신호 없이 감쇠하는가.
3. 횡이동·피치·요 회전에서 실제 입력 방향에 맞는 뒤처짐과 부피 이동이 생기는가.
4. 큰 체형은 작은 체형과 같은 숫자의 진동수를 강제로 공유하지 않는가.
5. 몸통 입력과 무관한 `sin(time * tissueHz)`를 결과에 더하지 않는가.

이 항목들은 이 프로젝트의 역학 해석과 검증 요구다. 어떤 논문의 시각 결과를 그대로 재현했다는 주장이 아니다.

## 3. 사용자 요구를 3D 모델로 번역하기

'지방의 말랑한 젤리 같은 액체성'은 이 프로젝트에서는 **유한한 전단 강성과 거의 보존되는 부피를 가진 변형체**로 다룬다. 자유표면 유체처럼 흐르거나 정지 형태를 잃는 모델을 요구하는 것으로 해석하지 않는다. 필요한 시각 요소는 다음과 같다.

| 시각 요소 | 필요한 상태·제약 | 부족한 대체 방식 |
|---|---|---|
| 위·아래·앞쪽이 서로 늦게 따라옴 | 3D로 분포한 자유도와 내부 결합 | 가슴 하나당 이동 벡터 1개 |
| 눌린 방향과 직교하는 방향으로 퍼짐 | 부피 제어와 전단 변형의 분리 | 단순 확대 또는 고정 spread 비율 |
| 흉벽에서 붙어 있고 끝부분은 부드러움 | 위치에 따른 부착·강성 차이 | 전체에 같은 grab 가중치 |
| 빠른 동작 뒤에 짧게 잔떨림 | 관성·국소 변형·감쇠 | 별도 시간축의 사인파 |
| 과장돼도 살 덩어리로 읽힘 | 과장 입력에도 부피·변형률·부착 유지 | 모든 출력 좌표의 무제한 배수 |
| 의상이 같은 덩어리를 따라감 | 공통 체적 맵 또는 피부 부착 | 의상과 피부에 서로 다른 임의 지연 |

이는 구현 선택을 위한 프로젝트 요구사항이며 생체 재질 측정값을 주장하는 표가 아니다.

## 4. 이번에 원문·공식 페이지로 재확인한 핵심 문헌

### 4.1 체적과 피부를 분리해서 다루는 직접적인 근거

**Sheen, Larionov, Pai, _Volume Preserving Simulation of Soft Tissue with Skin_, SCA / PACMCGIT 2021.** 구역별 체적 제약과 셀 단위 압축 페널티를 나누고, 피부의 더 높은 표면 강성을 다룬다. 거친 요소마다 완전 비압축성을 강요할 때의 locking 문제와 관련된다. [저자 프로젝트](https://elrnv.com/projects/volume-preserving-simulation-of-soft-tissue-with-skin/), [원문 PDF](https://diglib.eg.org/server/api/core/bitstreams/dfcd9aab-0d98-4288-80d6-444027060a10/content).

프로젝트 적용 판단: 억지로 각 tet를 완전히 단단하게 고정하지 말고, 유한한 국소 체적 compliance와 측면별 총체적 진단을 함께 사용한다. 피부와 내부의 강성도 구분할 후보로 둔다. 이 논문 전체 솔버를 구현했다는 뜻은 아니다.

### 4.2 빠른 프로토타입에 적합한 제약 기반 재질

**Macklin, Müller, Chentanez, _XPBD: Position-Based Simulation of Compliant Constrained Dynamics_, MIG 2016.** compliance와 누적 승수를 도입하여 제약의 탄성·감쇠 에너지 의미를 정한다. 유한 반복에서 정확한 물리 해나 모든 프레임률에서 동일한 결과를 자동으로 보장하는 것은 아니다. [원문 PDF](https://matthias-research.github.io/pages/publications/XPBD.pdf).

**Macklin, Müller, _A Constraint-based Formulation of Stable Neo-Hookean Materials_, MIG 2021.** 체적·변형 에너지의 두 제약으로 유한변형 재질을 다룬다. 정규화 체적에는 `J = det(F)`, 변형 항에는 `||F||_F`가 등장하며, 요소 체적에 따른 에너지 스케일링이 필요하다. [저자 논문 목록](https://matthias-research.github.io/pages/publications/publications.html), [원문 PDF](https://mmacklin.com/neohookean.pdf).

프로젝트 적용 판단: 먼저 별도 엔진에 의존하지 않는 coarse tet XPBD를 만들어 실제 3D 변형을 평가할 수 있다. Green-strain 또는 edge-strain과 체적 제약을 구현하는 초기 버전은 **XPBD strain+volume proxy**라고 부른다. Neo-Hookean 에너지와 그 gradient를 쓰지 않았다면 **Stable Neo-Hookean 구현**이라고 부르지 않는다.

**Macklin et al., _Small Steps in Physics Simulation_, SCA 2019.** 큰 시간 간격에서 많은 반복을 하는 것과 작은 substep을 여러 번 진행하는 것을 비교한다. 논문의 관찰은 작은 스텝이 제약 오차와 수치 감쇠를 줄일 수 있다는 것이다. [원문 PDF](https://matthias-research.github.io/pages/publications/smallsteps.pdf).

프로젝트 적용 판단: 실시간 프레임과 물리 substep을 분리하고, 긴 프레임을 시간을 버리는 clamp로 숨기지 않는다. 실제 허용 substep·반복 수는 모델별로 측정한다.

### 4.3 비선형 연속체의 teacher·정답 비교용

**Smith, de Goes, Kim, _Stable Neo-Hookean Flesh Simulation_, 2018.** 큰 변형의 연조직에 쓰는 초탄성 에너지를 다루는 근거다. 단순 선형 스프링의 재생 빈도를 조절하는 기법은 아니다. Pixar의 논문 목록에는 보충 자료·코드와 정정 사항도 연결돼 있다. [Pixar 원자료 목록](https://graphics.pixar.com/library/index.html).

**Chen, Liu, Yang, Yuksel, _Vertex Block Descent_, SIGGRAPH 2024.** implicit Euler의 변분 문제를 정점 단위 갱신으로 푸는 솔버다. 이 프로젝트의 형상·물성·부착·충돌 조건을 대신 정해 주는 기법은 아니다. [저자 소속기관 원문](https://graphics.cs.utah.edu/research/projects/vbd/vbd-siggraph2024.pdf).

**Giles, Diaz, Yuksel, _Augmented Vertex Block Descent_, SIGGRAPH 2025.** hard constraint와 큰 강성비에서의 수렴 문제를 보완한다. [공식 프로젝트](https://graphics.cs.utah.edu/research/projects/avbd/).

프로젝트 적용 판단: XPBD proxy의 큰 압축·회전 결과를 검증할 비선형 teacher 후보로 남긴다. 논문 속 GPU 성능 수치를 현재 JS 뷰어의 성능으로 가져오지 않는다.

### 4.4 선형 진동자보다 높은 품질로 줄이는 방법

**Benchekroun et al., _Fast Complementary Dynamics via Skinning Eigenmodes_, SIGGRAPH 2023.** 물성과 리그를 고려한 skinning 부분공간과 회전을 다루는 local-global 동역학이다. 단순히 임의의 이동 타깃 6개를 이름만 '모드'로 부르는 것과 다르다. [공식 프로젝트](https://www.dgp.toronto.edu/projects/fast_complementary_dynamics_site/).

**Benchekroun et al., _Subspace Mixed Finite Elements for Real-Time Heterogeneous Elastodynamics_, SIGGRAPH Asia 2023.** 부분공간의 위치 자유도와 요소 stretch 자유도를 함께 사용하는 방법이다. [공식 프로젝트](https://www.dgp.toronto.edu/projects/subspace-mfem/).

프로젝트 적용 판단: 좋은 full-space 또는 proxy 변형이 확보된 다음 축소한다. 현재의 선형 가중치 재생기 앞에 비선형 solver·교정을 추가하지 않은 채 FCD를 구현했다고 표기하지 않는다.

### 4.5 2024–2026의 대안과 적용 순서

**Modi et al., _Simplicits: Mesh-Free, Geometry-Agnostic, Elastic Simulation_, SIGGRAPH 2024.** occupancy 위에 학습한 공간 가중치로 비선형 탄성 부분공간을 구성한다. 메시 전처리가 어려운 모델에 유용한 후보이나 모델별 basis 준비가 추가된다. [NVIDIA 프로젝트](https://research.nvidia.com/labs/toronto-ai/simplicits/).

**Lei et al., _PhysSkin: Real-Time and Generalizable Physics-Based Animation via Self-Supervised Neural Skinning_, CVPR 2026.** 여러 형상으로 일반화하는 신경 skinning field를 연구한다. [CVF 원문](https://openaccess.thecvf.com/content/CVPR2026/papers/Lei_PhysSkin_Real-Time_and_Generalizable_Physics-Based_Animation_via_Self-Supervised_Neural_Skinning_CVPR_2026_paper.pdf), [저자 arXiv](https://arxiv.org/abs/2603.23194).

주의: 위 **PhysSkin**과 v2에 등장한 **PhySkin: Physics-based Bone-driven Neural Garment Simulation**은 제목·저자·문제가 다른 연구다. 검색 결과에서 두 이름을 합치거나, 한 연구의 학회·코드·라이선스를 다른 연구에 붙이지 않는다. [다른 PhySkin의 저자 원문](https://arxiv.org/abs/2603.27013).

프로젝트 적용 판단: 최신 연구도 확인하되, 지금 필요한 3D 부피 움직임의 품질을 검증하기 전에 신경망 학습을 필수 경로로 두지 않는다. 두 연구의 성능이나 일반화 범위가 현재 명조 PMX 모델에서 검증됐다는 근거는 없다.

### 4.6 과장 레이어의 근거와 역할

**Rohmer et al., _Velocity Skinning for Real-time Stylized Skeletal Animation_, Eurographics 2021.** 리그의 선속도·각속도에서 squashy/floppy 변형을 만드는 스타일화 방법이다. [저자 코드·재현 자료](https://github.com/drohmer/velocity_skinning_replicability).

프로젝트 적용 판단: 이것은 물리 부피 움직임 위에 방향과 강도를 제어하는 보조 레이어로 적합하다. 부피 solver 없이 이것만 켠 상태를 지방 조직 시뮬레이션이라고 설명하지 않는다.

## 5. PC 연구 뷰어의 우선 구현 선택

당장은 **흉부에 부착된 저해상도 3D tet proxy + XPBD strain/volume + 촘촘한 표시 메시로의 공통 embedding**을 우선한다. 이 선택은 위 문헌의 구현 난도와 현재 코드에 근거한 공학 판단이다. 원 논문 전체 구현이나 최종 제작 해법을 확정한 것은 아니다.

v2의 '런타임은 반드시 블렌드 셰이프만 사용'은 Unity 전달 옵션으로 남긴다. PC 연구 뷰어에서 유한변형을 검토하는 단계까지 그 제약을 강제하면, 검증할 대상 자체가 부족해진다.

### 상태와 입력의 권장 경계

```text
리그 애니메이션 + 정적 체형 슬라이더
  -> 현재 흉부 frame / 정적 변형된 조직 proxy
  -> 흉부 가속·회전 또는 world-space 이동 경계
  -> 조직 위치·속도·변형률·체적 상태
  -> 동일한 공간 변위를 피부와 밀착 의상에 전달
  -> 최종 포즈 스키닝 / 표시 좌표로 변환
```

좌표 처리 순서는 실제 표시 파이프라인에 맞춰 하나로 고정해야 한다. 이미 skinned된 위치에 bind-space 변위를 그대로 더하거나 같은 흉부 회전을 두 번 적용하지 않는다.

| 계층 | 입력 | 출력 | 독립적으로 검증할 것 |
|---|---|---|---|
| proxy 생성 | 몸·의상 역할, 체형, 흉벽·rim 영역 | rest nodes/tets, 질량, 부착 | 양의 rest 체적, 연결성, skin ROI 적합도 |
| 조직 solver | 실제 dt, 흉부 pose 또는 가속 입력 | nodes, velocities, 진단값 | 정지 감쇠, 회전 객관성, 체적·변형률 |
| embedding | 정적 표시 위치, proxy | 최종 표시 변위 | 피부/밀착 의상 추종, seam 연속 |
| 스타일 | 실제 움직임 상태, 과장 강도 | 제한된 외력/목표 변형 | 에너지 폭주·체적 손실·관통 여부 |
| 표시 | 현재 포즈와 최종 변형 | 위치·노멀 | 이중 스키닝, 노멀 흔들림, ROI 경계 |

### 체적과 변형률

tet의 rest edge matrix를 `Dm`, 현재 edge matrix를 `Ds`로 두면 `F = Ds * inverse(Dm)`, `J = det(F)`다. `J≈1`은 해당 요소의 rest 대비 체적비다. 이것은 실제 적용되는 proxy에서 계산해야 하며, Kelvinlet 필드의 다른 샘플점 determinant를 proxy 체적의 측정값처럼 표시하지 않는다.

정규화 체적 제약 `C = J - 1`에 `U = V0*K*C²/2`를 의도하면, 그 에너지 정의에 맞는 compliance는 `1/(V0*K)`다. 이 관계는 에너지 정의에서 직접 도출한 프로젝트 단위 검사다. `V0`나 gradient의 정규화를 바꿀 때 숫자만 그대로 재사용하지 않는다.

Green-strain 제약을 사용할 때는 대각·비대각 성분의 가중치가 같은지 따로 확인한다. `FᵀF`를 쓴다는 사실만으로 특정 Neo-Hookean 모델과 동등해지지는 않는다. strain surrogate의 압축 한계와 inversion 방지를 문서화한다.

### 부착과 재질 구역

초기 가정은 흉벽에 가까운 깊이층을 강하게, rim을 연속적으로 부착하고 전방·하부는 더 자유롭게 두는 것이다. 깊이층이 없거나 대부분의 노드를 강하게 rest에 직접 붙이면, 다시 겉모양만 바뀐 전역 스프링이 된다.

표면 강성·내부 전단·총체적을 분리해서 조절한다. 거친 tet 모두에 hard volume을 강요하는 방식은 먼저 locking을 검토해야 한다. 두 측면이 완전히 독립된 proxy라면 좌우 결합을 구현했다고 주장하지 않는다.

### 감쇠와 과장

전역 velocity 감쇠만 크게 주면 국소 조직 움직임도 함께 죽을 수 있다. 내부 상대속도/strain-rate 감쇠와 전체 잔향을 구분해 조절할 후보로 둔다. 각 감쇠항은 `dt`에 따라 의미가 바뀌지 않는 단위로 정한다.

과장은 실제 몸통 입력의 관성 gain, 비대칭 강성, 복원시간, 제한된 순간 추가 하중으로 만든다. 선호하는 실루엣은 정적 rest target으로 유지한다. 출력 변위를 무제한 키우는 것은 압축·부착·의상 품질을 동시에 깨뜨릴 수 있다.

체형이 달라지면 rest 체적, 질량, 특징 길이, 부착 영역을 다시 계산한다. 동일 재질·기하학적 상사에서 특징 진동수가 대략 `sqrt(mu/rho)/L`에 비례한다는 차원 해석을 sanity check로 쓸 수 있다. 이것은 현재 캐릭터의 재질값이나 실측 주파수를 정하는 근거는 아니다.

### 피부·의상 표시

tet 안쪽은 barycentric embedding, 바깥의 밀착 의상은 정의된 외삽 shell 또는 공통 cage/RBF map 등으로 옮길 수 있다. 원점을 기준으로 같은 변위 맵을 공유해도 유한 크기의 표시 삼각형 사이 충돌이 자동으로 없어지지는 않는다.

가슴 사이를 가로지르는 천·끈, 헐렁한 겉옷은 공통 워프만으로 해결되지 않는다. 이 경로는 별도 garment/contact 문제로 남기고, 프로토타입에서 지원하지 않는 경우를 명시한다.

## 6. 합격 기준: 숫자와 착의 동영상이 함께 있어야 한다

아래 수치는 이 프로젝트의 **초기 검토 목표**다. 논문의 보장이나 의학적 허용값이 아니다. 목표를 만족하는 측정 결과가 기록되기 전에는 통과로 표기하지 않는다.

| 시험 | 관찰·측정 | 초기 검토 목표 |
|---|---|---|
| 정지 + impulse | peak 변위와 잔향, 외력이 0일 때 에너지 증가 | 발산·지속 자가진동 없음, 잔향 감소 |
| 주기 입력 후 정지 | 몸통 입력과 표면 궤적 | 입력과 강제응답의 관계 확인, 정지 뒤 독립 사인파 없음 |
| 국소 누름 | 눌린 부위와 주변 부피 이동 | 이동이 한 벡터로 고정되지 않음, apex/rim/depth 차이 기록 |
| 회전 + 횡이동 | 전후·좌우의 관성 지연 | 입력 방향을 따른 반응, 이중 회전 없음 |
| 체적 | `ΣV/ΣV0`, `J` 최솟값·p05·p95 | 총체적 변화 약 5% 이내를 우선 목표, 음의 tet 없음 |
| 공간적 지연 | 전방·상부·하부·부착부 probe의 위상·최대 변형 | 서로 같은 waveform의 상수배인지 확인 |
| 프레임률 | 같은 연속 입력, 30/60/120 fps, 고정 물리 스텝 | 같은 실시간 위치 비교, 차이와 solver 비용 기록 |
| 히치·일시정지 | 긴 dt·탭 복귀·teleport | 가짜 impulse/폭주 없음, reset 원인 표시 |
| 크기 sweep | size 최소/기본/최대 | 질량·부착·주파수 경향 기록, 가시 노드 왜곡 없음 |
| 착의 motion | 앞·옆·3/4, 시작·정지·착지·회전 | 피부/의상 벌어짐·관통 프레임 기록 |
| 안전 gate | `J`·strain·finite 검사 실패 | 마지막 정상 상태/명시적 reset 등 복구, 실패 횟수 표시 |

색상 wireframe proxy와 probe 궤적을 함께 표시하면, '모드가 늘었음'과 '실제로 공간적 변형이 생김'을 구분하기 쉽다. 수치 단위 시험이 통과해도 착의된 실제 명조 모델의 움직임이 만족스러워졌다고 자동 판정하지 않는다.

## 7. v2 결정의 수정 사항

1. **런타임 선형 셰이프만 고수하는 조건을 PC 연구 단계에서 완화한다.** 최종 Unity 전달에서는 성능 요구에 맞춰 full-space/cage, FCD/MFEM 또는 nonlinear modal corrective를 비교한다.
2. **모드 수보다 변형 공간의 품질을 먼저 검증한다.** 6개 점 질량 이동 모드는 FEM 모드의 대체 구현이 아니다.
3. **볼륨을 강하게 묶는 것과 말랑함은 같은 설정이 아니다.** 국소·구역별 체적, 전단, 표면, 부착을 분리한다.
4. **교정 셰이프는 단순 팽창 방지 장식이 아니다.** 선형 부분공간에서 빠진 비선형 기하와 큰 진폭 응답을 복구할 수 있어야 한다.
5. **최신 연구명으로 구현 완성도를 추정하지 않는다.** v2의 '확인', '미확인', 임시 경로·벤치마크 기록을 현재 실행 증거와 구분한다.
6. **연구 목록과 완료 상태를 분리한다.** 이 문서의 출처는 연구 근거다. 구현 변경·실행 결과는 해당 커밋, 테스트, 실제 모델 화면으로 별도 기록한다.

## 8. 조사 범위와 한계

이번에는 XPBD 원문, Small Steps 원문, Soft Tissue with Skin 저자 페이지·원문, FCD/MFEM 공식 프로젝트, VBD/AVBD 원자료, Simplicits NVIDIA 페이지, PhysSkin CVF/arXiv, Velocity Skinning 저자 자료를 확인했다. `mmacklin.com/neohookean.pdf`는 직접 열기에서 크기 제한이 있었으며 원문의 수식이 포함된 색인 내용과 저자 논문 목록으로 제목·기법을 교차 확인했다.

2026-10-18 기준으로 모든 2025–2026 연조직 논문을 망라한 체계적 문헌고찰은 아니다. 신경망·GPU 솔버의 공개 벤치마크를 이 PC·이 PMX·이 브라우저의 성능으로 검증하지 않았다. 실제 지방의 조직학적·의학적 파라미터나 명조 제작사의 내부 구현을 확인했다는 주장도 하지 않는다.

## 9. 이번에 연결한 구현과 실행 증거

`tissue.js`는 여섯 Green-strain 성분, 유한한 요소별 체적 페널티, 연결 구역별 총체적
제약을 XPBD로 푼다. 에너지는 `mu*V0*tr(E²)`이고 `E=(FᵀF-I)/2`다.
따라서 **Green-strain 기반 탄성 proxy**이며 2021 Stable Neo-Hookean 논문의 그대로인
구현이 아니다. 감쇠는 현재 속도 감쇠이며 재질의 완전한 점탄성 응력 모델은 아니다.

`tissue-proxy.js`는 정적으로 모핑된 모델의 삼각형 표면에 깊이층이 있는 체적 격자를
맞춘다. 기본값은 좌우 합계 240노드, 720tet이다. 흉벽과 rim을 고정하고 내부와 전방
노드를 움직인다. 좌우 총체적을 별도로 제어하며 좌우 사이의 조직 결합은 아직 없다.
체형 슬라이더를 바꾸면 rest 기하와 체적 기반 질량을 다시 만든다.

`viewer/tissue-rig.js`는 실제 흉부 이동·회전에서 관성 하중을 받아 solver를 구동한다.
흉부 추적기가 제공하는 구간 시작·중간·끝 입력을 각 물리 substep에서 보간한다.
공통 curvilinear trilinear embedding으로 피부와 가까운 의상에 변위를 전달하고,
공유 변형 맵의 수치 Jacobian으로 노멀을 `F^-T` 변환한다. 이 표시 경로는 PC 뷰어의
CPU 정점 갱신이며 Unity용 고정 블렌드 셰이프 증류를 완료한 것이 아니다.

안전 제한은 solver의 tet determinant/변형률/이동량과 표시 맵의 determinant를
각각 확인한다. 표시 맵이 너무 압축되면 모든 레이어의 변위를 같은 비율로 줄인다.
제한 횟수와 표시 비율을 진단값에 남긴다. 이는 전역 자기충돌·팔·머리카락·옷 접촉
인증을 대신하지 않는다. 별도의 피부 쉘, 의상 장력에 따른 조직 강성, 비선형 축소
모델과 GPU 구현도 남아 있다.

검증 명령:

```text
cd web
npm test
npm run dev
npm run test:tissue-viewer -- <로컬 모델 URL> <출력 폴더>
```

새 단위 시험은 rest 보존, 부착점 고정, 깊이에 따른 변형 차이, 회전 불변성,
크기 의존 응답, 정지 후 감쇠, 강한 입력 안전 제한, 양의 cage 체적,
UV seam/의상 shell의 공통 전달을 검사한다. 장리 배포본의 브라우저 시험은
실제 렌더 메시의 변형, 좌우별 체적 오차, tet/표시 맵 determinant, 정지 감쇠,
크기별 rest 체적 재생성을 검사한다. 정량 통과는 미적 선호 통과를 뜻하지 않으며
걷기·달리기·착지·회전 클립의 착의 비교 검토는 별도 후속 항목이다.

2026-10-18 로컬 실행에서 JS 96개와 production build가 통과했다. 새 조직 시험은
같은 연속 흉부 운동의 30/60/120fps 궤적 RMS 차이가 120fps 기준 5% 이내인지도
검사한다. 이는 합성 블록의 수직 운동 시험이며 모든 애니메이션에 대한 보장이 아니다.
기존 뷰어 통합 시험은 Michelle.glb와 Seed-san.vrm에서 별도로 통과했다.

실제 모델의 3D 조직 브라우저 시험 조건: size=0.6, style=0.5, 몸통 진폭 0.035S,
주기 1.8Hz, softness=0.8, damping=3.5, exaggeration=1.3, 반복 3회.
2초간 60fps의 모든 표시 프레임에서 값을 수집한 뒤 입력을 정지하고 4초간 진행했다.

| 모델 | 전달 정점 | 최대 표시 변위 / S | 최소 tet J | 최소 표시 맵 det | 최대 좌우 체적 오차 | 정지 4초 후 변위 / S |
|---|---:|---:|---:|---:|---:|---:|
| 장리 로컬 배포본 | 1,072 | 0.04854 | 0.6863 | 0.4843 | 0.0310% | 0 (sleep 기준 이하) |
| Michelle.glb | 155 | 0.03940 | 0.8049 | 0.2581 | 0.0371% | 0 (sleep 기준 이하) |

체적 오차는 solver의 좌우별 총체적이며 최종 스킨 메시를 닫아 잰 체적은 아니다.
표시 맵 determinant는 활성 정점의 수치 Jacobian 표본값이다. 전역 충돌·모든 삼각형의
접힘 부재를 인증하지 않는다. 렌더·JSON은 로컬 출력에만 보관한다. 동시 테스트와
소프트웨어 GPU 환경의 비용을 고정 FPS 성능 보장으로 사용하지 않는다.

추가 서지 정정: 비평 v2에서 원문 접근 불가로 미확인으로 남긴
Jin et al.의 [arXiv 2201.10122](https://arxiv.org/abs/2201.10122)는 이번에
제목·저자·초록을 직접 확인했다. 논문 존재가 미확인이라는 예전 상태를 현재에도
그대로 적용하지 않는다. 이 연구가 현재 proxy solver를 검증해 준다는 뜻도 아니다.
