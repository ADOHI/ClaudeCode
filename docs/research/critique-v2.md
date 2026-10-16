# 완전성 비평: 「바스트 모프 기법 결정 문서 v2」에서 빠진 것, 약한 것, 정정할 것

## 0. 이번 검증의 범위와 한계

- **WebSearch는 한 번도 실행하지 못했다.** 이 턴 전체에 할당된 검색 한도(200회)가 이미 다른 에이전트들에게 소진돼 있었다. 추가 검색이 필요하면 사용자가 후속 메시지를 보내거나 `CLAUDE_CODE_MAX_WEB_SEARCHES_PER_SESSION`을 늘려야 한다.
- **WebFetch로 접속할 수 있는 곳은 github.com과 raw.githubusercontent.com, PyPI뿐이었다.** arXiv, ACM DL, doi.org, CVF, dev.epicgames.com, sidefx.com, docs.unity3d.com, unity.com, *.github.io는 프록시가 403으로 막았다.
- **그래서 이 비평의 근거는 세 종류로 나뉜다.**
  - **[확인]** GitHub 1차 소스에서 확인했거나, 로컬에서 직접 실행해 확인한 것
  - **[기억]** 기억에 근거한 것. 원문을 재확인해야 한다.
  - **[추론]** 공학적으로 판단한 것

---

## 1. 1차 출처로 정정해야 할 사실

| 문서의 주장 | 확인 결과 | 문서에 반영할 수정 |
|---|---|---|
| #7 Anny는 "통계적 자연스러움 사전"이다 | **[확인]** `naver/anny`의 `src/anny/shape_distribution.py`를 보면, `SimpleShapeDistribution`은 "WHO 키-나이 데이터에 보정"한 분포이고 보정 파일은 `boys.pth`/`girls.pth`다. 통계 분포가 있는 항목은 height, weight, muscle, proportions뿐이다. `models/phenotype.py`의 `cupsize`·`firmness`는 MakeHuman 아티스트 타깃이고, 기본값 0.5만 있을 뿐 경험적 분포가 없다. 데이터 범위도 "infants to elders"다. 출처: https://github.com/naver/anny | 이름을 "통계 사전"에서 "CC0 파라메트릭 모프 공간(그럴듯함의 범위)"으로 바꾼다. N을 4에서 2.5로 내린다. 분포 클래스는 소아 보정 데이터를 쓰므로 **아예 쓰지 않는다**. 기존 age assert는 유지한다. ECCV 2026, Apache-2.0(코드), CC0(mpfb2 데이터), smplx 토폴로지 비상업이라는 점은 확인됐다. |
| #10 GeoStyle은 "확인", SDXL + DreamBooth LoRA를 쓴다 | **[확인]** 공식 README 기준 제목은 "Image-Guided Geometric Stylization of 3D Meshes", 저자는 Choi*, Lee*, Jambon, Vinker, Kim이고 CVPR 2026, arXiv 2604.07795다. **라이선스 표기가 없고, SDXL이나 DreamBooth도 언급하지 않는다.** CUDA 11.8과 nvdiffrast를 쓴다. 출처: https://github.com/changwoonchoi/GeoStyle | 검증 상태를 "부분"으로 내린다. 베이스 모델에 대한 서술을 삭제한다. 라이선스 위험 목록에 추가한다. |
| Velocity Skinning 코드는 "라이선스 미확인" | **[확인]** README에 "released under MIT License"라고 적혀 있다. 다만 LICENSE 파일은 목록에 보이지 않는다. 출처: https://github.com/drohmer/velocity_skinning_replicability | "README상 MIT, LICENSE 파일 부재"로 정정한다. 논문의 정식 저자 목록에는 Moshfeghifar와 Zordan이 포함된다. "Acceleration Skinning"은 저장소에 언급이 없어 여전히 미확인이다. |
| PhySkin/HyperBones는 CVPR 2026 / SA 2026 | **[확인]** README에 따르면 "bone-based physics-aware cloth deformation"을 위한 신경망 프레임워크이고, MIT 라이선스이며 CUDA 학습이 필요하다. **README에는 저자와 학회가 표기돼 있지 않다.** 출처: https://github.com/facebookresearch/physkin | 학회 표기를 "미확인"으로 바꾼다. |
| Newton SolverVBD는 실험적이며 Tier 2 드레이프용이다 | **[확인, 직접 실행]** newton 1.7.0의 `SolverVBD` docstring에 `.. experimental::` 표기가 있다. 이 솔버는 **사면체 체적 Stable Neo-Hookean(Smith 2018)**(`evaluate_volumetric_neo_hookean_force_and_hessian`)과 **tet별 이질 재질**(`add_soft_mesh(k_mu: float \| ndarray)`)을 지원하고 **CPU에서 돈다.** 6×6×6 격자(1080 tet), 한 면 고정 조건에서 `model.tet_poses`를 (1+s)^{-1/3}로 스케일해 등방 성장 s=0.3을 주었더니 부피비가 **1.2935**(목표 1.30, 오차 -0.5%)가 나왔다. 1500스텝 뒤 max\|v\|는 1.3e-5였다. 스크립트: `/tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/vbdtest/g.py` | **P1-3(JS로 SNH + projected Newton을 처음부터 구현)의 위험을 크게 낮출 수 있다.** Teacher A를 Newton VBD(Python, CPU)로 먼저 돌리고, JS는 뷰어와 교차검증용으로만 쓴다. 단서가 둘 있다. (1) VBD는 동역학 솔버여서 준정적 해를 얻으려면 감쇠로 수렴시켜야 한다. 상대 잔차 1e-6 기준은 별도로 측정해야 한다. (2) 2024년의 "abs-eigenvalue filter"가 아니라 2018 SNH다. #4의 F를 3에서 4로 올린다. |
| ipctk 1.6.0에 OGC가 있다 | **[확인]** `ipctk.ogc.TrustRegion`, `check_vertex_feasible_region`, `is_face_vertex_feasible` 등과 `ipctk.has_intersections`가 존재한다. | 주장을 유지한다. |
| `Mesh.AddBlendShapeFrame` | **[확인]** UnityCsReference `Mesh.bindings.cs`에 `ReadOnlySpan<Vector3>` 오버로드가 있다. `GetBlendShapeBufferImpl(int layout)`도 존재한다(2021.2 이후의 `Mesh.GetBlendShapeBuffer`). | 6장의 런타임 추가 항목 근거로 쓴다. |
| 2.2 "2022–2026 대안 중 필드의 공간 맵 성질을 대신하는 것은 없다" | **[추론]** 문서가 1.6절에 직접 채점한 케이지 좌표(Somigliana 2023, biharmonic 3D 2024)도 **공간 맵**이다. 모든 레이어에 같은 변위를 주고, 케이지 변위에 대해 선형이며, 파라미터가 작다는 성질을 똑같이 갖는다. | 문장을 "표면 기법 중에는 없다. 공간 맵 대안은 케이지 좌표뿐이며, 해석적 J와 단사성 검사가 더 비싸다"로 고친다. |
| #13 "Jin et al., SIGGRAPH 2022, arXiv 2201.10122"가 해석적 진동자 스텝의 출처다 | arXiv에 접속할 수 없어 확인하지 못했다. 감쇠 2차 선형 ODE의 정확 이산화(ZOH/FOH)는 교과서 내용이다. | **이 인용은 확인될 때까지 삭제한다.** 근거는 교과서 수준의 정확 해로 바꾼다. 인용이 날조로 판명될 위험이 그대로 남아 있기 때문이다. |
| Hsu et al. 2022 | **[기억]** 정확한 제목은 "A General Two-Stage Initialization for Sag-Free Deformable Simulations"(Hsu, Truong, Yuksel, Wu, ACM TOG 41(4), SIGGRAPH 2022)일 가능성이 높다. 2023년 헤어 전용 sag-free 논문과 혼동하지 않도록 주의해야 한다. | 원문 재확인 목록에 넣는다. |

---

## 2. 문서가 놓친 프로토타입 버그 (`web/src/core/runtime.js`, 확인)

**버그 내용** (45–49행)

```js
dt = Math.min(dt, 1 / 30);
...
const vel = dot(sub(chestPos, this.prevPos), up) / dt / S;
acc = (vel - this.prevVel) / dt;
```

- clamp한 dt로 **실제 프레임 동안의 이동량을 미분한다.**
  - 20 fps에서는 속도가 1.5배로 과대평가된다.
  - 200 ms 히치에서는 6배가 되고, 그만큼 가짜 킥이 생긴다.
- 문서는 이것을 "프레임 드롭 시 물리 변화"라고만 적었다. 실제로는 그보다 큰 오류다.

**같은 함수의 추가 결함**
- teleport와 컷 리셋이 없다.
- 상하축만 입력으로 받는다. 전후·측방 이동과 회전은 무시된다.
- `spread = -squashStretch*lift`가 하드코딩돼 있다.

**P1-7 합격 기준에 추가할 것**
- 미분용 dt와 적분 스텝을 분리한다.
- 히치 주입 테스트(16 ms 대신 250 ms 1프레임)를 넣는다.
- 리셋 API를 만든다.

---

## 3. 탐색하지 않은 도메인과 평가

### 3.1 애니 특화 3D 생성: 생성기 자체는 못 쓰지만, 데이터는 체형 사전으로 쓸 만하다

| 기법 | 출처 | 확인 내용 |
|---|---|---|
| CharacterGen | Peng, Zhang, Guo, Cao, Hu. SIGGRAPH 2024 (TOG 43(4)), Apache-2.0. https://github.com/zjp-shadow/CharacterGen | VRoid 기반 Anime3D 데이터. 원본 VRM은 재배포하지 않는다. |
| StdGEN | He, Zhou, Zhao, Wu, Xiao, Yang, Liu, Han. CVPR 2025, arXiv 2411.05738, Apache-2.0. https://github.com/hyz317/StdGEN | VRoid 기반 Anime3D++. 의미 분해(몸, 의상, 머리카락) 기반 생성. |
| UniRig | Zhang, Pu, Guo, Cao, Hu. SIGGRAPH 2025 (TOG 44(4)), MIT. https://github.com/VAST-AI-Research/UniRig | 자동 스켈레톤과 스킨 가중치. VRoid 데이터셋 공개. 스프링 본 물성 예측은 "coming soon". |

- **판정 [추론]**: 출력 메시가 LRM 계열 재구성이라 토폴로지와 해상도가 셰이프 타깃 품질에 못 미친다. 생성기로 쓰는 것은 제외한다.
- **그래도 쓸 수 있는 것**: VRoid 계열 데이터를 **애니 도메인 형태계측 분포**로 쓸 수 있다. 수백 개 아바타에서 UP:LP, apex tilt, IMF 높이, 돌출/기저폭을 측정하면, 문서가 "가설"로 둔 애니 대역(약 50:50, 25–30°)을 **경험적 분포로 교체**할 수 있다.
- **주의할 점**
  - VRM은 모델마다 이용 조건(meta)이 다르다. 내부 측정에만 쓰고 형상은 재배포하지 않는다.
  - VRM meta에는 나이 정보가 없다. **명시적으로 성인으로 디자인된 캐릭터만 수동으로 큐레이션한다.**
  - 상당수가 VRoid Studio 기본 바디와 그 슬라이더에서 나온 것이어서, 분포가 VRoid 자체의 디자인에 편향돼 있다.
- **최선의 사전은 사내 캐릭터 아트**다.
- **위치**: 베이크 루프의 N/M 항. Anny를 대신하거나 보완한다.

### 3.2 ML Deformer와 Unity 대응물

- **[기억, 미확인]** Unreal ML Deformer의 구조
  - 오프라인 시뮬레이션(Houdini, Ziva, Chaos Flesh)으로 학습 데이터를 만든다.
  - Neural Morph Model은 MLP로 **모프 타깃 가중치**를 출력한다.
  - Nearest Neighbor Model도 있다.
  - Chaos Flesh는 UE 내장 FEM 플레시다.
  - 레퍼런스 작품(명조)이 UE 기반이라는 점도 기억에 근거한 것이다.
- **Unity에는 1st-party ML Deformer가 없다.** 대체 경로는 다음과 같다.
  - Unity Inference Engine(구 Sentis). `Unity-Technologies/sentis-samples`의 About이 "Inference Engine samples"라고 돼 있는 것은 확인했지만, 이름이 바뀐 공식 문서는 확인하지 못했다.
  - **Burst로 직접 작성한 소형 MLP**(입력 20차원 → PCA 계수 16개)면 충분하다.
- **문서에 넣을 위치**: 3(d)-3 "포즈·중력 교정"의 RBF 다음 단계. 슬라이더 × 포즈 × 지글의 비선형 결합을 RBF보다 잘 잡는다. 지금의 "나중 선택지"에서 **"Phase 2 실험 항목"으로 올린다.**
- **Unity Digital Human 패키지** **[확인]**
  - 출처: https://github.com/Unity-Technologies/com.unity.demoteam.digital-human
  - 4D clip import, 4D frame fitting, skin deformation GPU 경로(2021.2+), **SkinAttachment**(변형하는 피부 위에 메시와 트랜스폼을 붙이는 기능, Burst)가 있다.
  - Unity 안에서 고밀도 변형과 부착 처리를 실제로 구현한 사례이므로, 아래 4장 (d) 항목의 레퍼런스로 쓴다.

### 3.3 Ziva식 근육·지방 시뮬레이션

- **[기억, 미확인]**
  - Ziva VFX: Unity가 2022년에 인수했고, 이후 판매를 중단했다. 문서의 "2024-04"는 원문 확인이 필요하다.
  - Houdini Muscles & Tissue / Otis: sidefx.com이 차단돼 확인하지 못했다.
  - Chaos Flesh: 미확인.
- **모델링에서 빠진 것 [추론]**
  - Ziva 관행의 핵심은 **attachment와 sliding(fascia)**이다. 문서의 Teacher A는 흉벽을 Dirichlet로 고정한다.
  - 이 조건에서는 팔을 올릴 때의 리프트 교정(3(d)-3 스윕)이 물리적으로 생기지 않는다. **흉근 경계가 팔 회전에 따라 움직이는 이동 경계**와 **흉벽 위 미끄럼 접촉**(VBD/OGC나 IPC의 마찰 접촉으로 구현 가능)이 필요하다.
  - 피부를 별도 쉘로 두고 prestress를 주는 것도 Ziva식 관행이다. 문서는 피부 장력을 다이얼로만 다룬다.

### 3.4 4D 스캔 데이터셋과 생체역학

| 데이터 | 출처 | 상태 |
|---|---|---|
| 4D-DRESS | CVPR 2024 하이라이트, 의상 64벌, 시퀀스 520개 이상, 스캔 프레임 약 7.8만 개. https://github.com/eth-ait/4d-dress | **[확인]** 저장소에 라이선스 표기가 없다. 다운로드 사이트의 약관은 확인하지 못했다. 의상 Tier 2 드레이프 거동의 정성 검증용. |
| DFAUST (CVPR 2017), Dyna (SIGGRAPH 2015), SoftSMPL (EG 2020) | — | **[기억]** 연구·비상업 라이선스로 알고 있다. 상업 제품에 형상을 넣는 것은 금지일 가능성이 높다. 논문에 공개된 수치(주파수, 감쇠 범위)만 참고하는 것이 안전하다. |
| 유방 생체역학 운동 연구 (Portsmouth 대학의 Scurr 등) | — | **[기억]** 달리기 중 3평면 변위와 8자 궤적을 보고한 것으로 안다. 모달 지글의 **궤적 형태 지표**(상하:좌우:전후 비율, 위상)를 정할 근거가 된다. 원문 확인이 필요하다. |

### 3.5 Gaussian splat / implicit 아바타 변형

- **[추론] 제외한다.** 이유를 문서에 명시해야 한다.
  - PhysGaussian(CVPR 2024) 계열은 메시 토폴로지를 보존하는 출력이 없다. 그래서 블렌드 셰이프, 의상 레이어, 툰 노멀 파이프라인 어디에도 들어가지 못한다.
  - 메시에 Gaussian을 붙이는 아바타(GaussianAvatars류)는 변형을 메시에 의존한다. 그래서 우리에게 새로 주는 것이 없다.
- **이 판정은 검색으로 최신 상황을 확인하지 못한 채 내린 것이다.**

### 3.6 2025년 산업 벤치마크 누락 (모두 [기억, 미확인])

- **MetaHuman (UE 5.6, 2025)**: 파라메트릭 바디와, 의상(Outfit)을 체형에 맞게 자동 리사이즈하는 기능(Chaos 기반). 우리가 "슬라이더를 따라가는 의상" 문제에서 넘어야 할 **가장 직접적인 2025년 상용 기준선**이다.
- **Roblox Layered Clothing**: 내부와 외부 케이지로 의상을 임의 바디에 맞춘다. 문서는 특허만 언급한다. 케이지 기반 공간 맵이 산업에서 실제로 쓰인 근거이므로 #16 Somigliana의 순위 논거에 넣는다.

---

## 4. 새로 넣을 기법 (점수는 문서의 채점 규칙을 따른다)

| # | 기법 | 출처·근거 | N/S/U/F/R | 위치 |
|---|---|---|---|---|
| (a) | **아트디렉터가 그린 프로파일·실루엣 곡선 역피팅.** 시상면과 정면 곡선을 선 하나로 그리면, Kelvinlet 사전 진폭으로 선형 LS를 푼다. | 엔지니어링 [추론]. 필드가 진폭에 선형이라 det 제약 하의 QP 한 번이면 된다. 애니 과장의 핵심이 측면 프로파일과 실루엣이므로 **S 축에서 diffusion보다 직접적**이다. GPU와 라이선스 문제도 없다. | 4/5/5/5/3 = **22** | 베이크. P1-4 바로 뒤에 둔다. |
| (b) | **애니 도메인 형태계측 분포** (3.1절, VRoid 계열) | CharacterGen, StdGEN, UniRig 데이터 경로 [확인]. 라이선스와 성인 큐레이션 조건이 붙는다. | 3/4/5/3.5/4 = 19.5 | 베이크 루프의 M/N |
| (c) | **부착물 추종: 장신구·버튼·펜던트·견갑과, 특히 머리카락 콜라이더** | **[추론] 문서의 실제 누락이다.** 본에 붙은 강체 부착물은 블렌드 셰이프를 따라가지 않는다. 애니 장발이 가슴 위에 얹히므로, size와 지글에 따라 **SpringBone 구 콜라이더의 중심과 반경**이 갱신되지 않으면 머리카락이 관통한다. 부착점에서 필드를 평가해 위치를 구하고, F를 polar 분해해 회전을 구한다(C#). 레퍼런스는 Digital Human의 SkinAttachment [확인]. | 4/3/5/5/2 = 19 (**필수 인프라**) | 런타임 + 베이크(슬라이더별 콜라이더 피팅) |
| (d) | **신경 교정 MLP (UE Neural Morph 패턴)를 Burst로 포팅** | 3.2절 | 4/4/4/3.5/3 = 18.5 | 런타임 Phase 2 |
| (e) | **커스텀 컴퓨트 경로.** `Mesh.GetBlendShapeBuffer`와 `SkinnedMeshRenderer.GetVertexBuffer`를 써서 모달 기저와 VS 셰이프를 바스트 ROI 전용 **단일 디스패치**로 적용한다. | API 존재 [확인, `GetBlendShapeBufferImpl`]. 성능은 미측정. 보류 목록의 "필드 라이브 평가"를 안전하게 구현하는 경로이기도 하다. | 4/4/4/3.5/2 = 17.5 | 런타임 (모바일 예산 대안) |
| (f) | **Dem Bones** (Le & Deng, SIGGRAPH Asia 2012, BSD-3, EA). 블렌드 셰이프나 시퀀스를 LBS 본으로 변환한다. | https://github.com/electronicarts/dem-bones [확인] | 3/3/5/5/2 = 18 | 모바일·LOD 폴백. 지글 모드를 2–4개 본으로 바꾼다. |

---

## 5. 평가 지표 공백: 자연스러움과 어필 (문서에 없는 것만)

1. **툰 셰이딩 지표**
   - 광원을 스윕하면서 **명암 경계선(terminator)의 곡률 연속성**(꺾임과 흔들림 수)을 잰다.
   - 하이라이트 안정성과 인버티드 헐 아웃라인 폭의 분산을 잰다.
   - 셋 다 슬라이더 스윕과 조합 전체에서 측정한다.
   - 애니 룩은 기하 RMS보다 이 지표들에 지배된다. 해석적 F⁻ᵀ 노멀이 가치 있다는 주장도 이 지표로 증명해야 한다.
2. **지각 균등 슬라이더**
   - 2AFC로 JND를 측정한다.
   - 슬라이더 값을 재매핑해서 같은 간격의 이동이 같은 크기의 지각 변화를 내도록 만든다.
   - 지금은 슬라이더 값이 셰이프 가중치에 선형으로 연결돼 있다.
3. **평가자 신뢰도**
   - 아트디렉터 한 명이 아니라 아트디렉터, 아티스트, 타깃 플레이어로 다수 평가자를 둔다.
   - Bradley–Terry 척도와 Krippendorff α로 일치도를 본다.
   - 문서가 인정한 "한 명 취향 편향"을 수치로 관리하는 방법이다.
4. **동적 지표**
   - overshoot %, 정착 시간, 흉부 가속도 대비 위상 지연, 3D 궤적 형태(3.4절)를 잰다.
   - **애니메이션 클립(걷기, 달리기, 점프, 팔 교차) 재생 중 관통 프레임 비율**을 잰다. 여기에는 몸-의상, 팔-가슴, 머리카락-가슴 관통이 모두 들어간다. 지금 게이트는 정적 `extremeCombos`뿐이다.
5. **동일성 유지**: 슬라이더 극단에서도 같은 캐릭터로 보이는지 잰다. 실루엣 IoU와 루브릭을 쓴다. 문서의 VLM 루브릭에만 있고 수치 지표는 없다.
6. **[기억] 지각 연구 근거**
   - Fleming et al. 2016 "Appealing female avatars from 3D body scans: perceptual effects of stylization"
   - Zell et al. SIGGRAPH Asia 2015 "To Stylize or not to Stylize?"
   - McDonnell et al. SIGGRAPH 2012 "Render me Real?"
   - 형상 스타일화와 재질·렌더링 스타일화가 서로 영향을 준다는 근거다. 원문 재확인이 필요하다.

---

## 6. Unity/모바일 실행 근거 없이 높게 매겨진 항목

1. **U=5를 일괄로 준 것은 과대평가다.**
   - 물리 베이크 결과(#3, #4, #6)는 비선형이다.
   - 블렌드 셰이프로 옮기면 **의상 수 × 슬라이더 7개 × 인비트윈 프레임 수 × 조합 교정**만큼 셰이프와 메모리가 늘어난다.
   - Tier 2 의상이 있는 항목은 U를 4로 내리고, **의상당 셰이프 메모리 예산식**을 문서에 넣는다.
   - **[기억]** Unity의 블렌드 셰이프 정점 레코드는 위치·노멀·탄젠트 델타와 인덱스로 약 40 B/정점/프레임이다. 원문 확인이 필요하다.
2. **지글 셰이프는 거의 항상 가중치가 0이 아니다.** 모드 4–6개와 VS 11개가 레이어마다 매 프레임 활성 상태다. "가중치 0 셰이프 건너뛰기"는 이 셰이프들에 도움이 되지 않는다. 그래서 Phase 2 실기기 측정 전에 4장 (e)·(f) 폴백을 계획에 넣는다.
3. **모바일 Skin Weights 제한**(보통 본 4개) 때문에 Dem Bones 변환에 제약이 생긴다. 문서에 이 조건을 명시한다.

---

## 7. 랭킹 수정 제안 요약

| 항목 | 변경 |
|---|---|
| #7 Anny | 21 → 약 19. 4장 (b)로 보완한다. |
| #10 GeoStyle | 검증 상태를 "부분"으로, 라이선스는 불명으로 표기한다. |
| #4 VBD | F 3 → 4 (CPU에서 tet SNH와 성장 동작을 확인했다). Teacher A의 1순위 실행 경로로 둔다. |
| #13 | 인용을 삭제하고 교과서 근거로 바꾼다. |
| 신규 | 4장 (a) 22점을 상위권에 넣고, (c)는 필수 인프라로 넣는다. |

---

## 8. 검색이 가능해지면 먼저 확인할 것

| 항목 | 확인할 내용 |
|---|---|
| Neural-Augmented Kelvinlet (arXiv 2506.08043) | 존재 여부 |
| STAGED | CGF 45(2) 2026 |
| Hsu 2022 | 제목 |
| Huang 2025 IPC 리타깃 | 에너지 항 |
| Divide-and-Truncate | SIGGRAPH 2026 |
| UE ML Deformer / Chaos Flesh | 버전과 출력 형식 |
| MetaHuman 5.6 Outfit | 리사이즈 방식 |
| Ziva | 판매 중단일 |
| Houdini Otis | 확인 필요 |
| Unity | 블렌드 셰이프 정점 레이아웃, 0 가중치 스킵 여부 |
| 4D-DRESS, DFAUST | 약관 |
| Fleming 2016, Zell 2015 | 서지 정보 |
| Scurr 등 유방 운동학 | 서지 정보 |
| Spring Decomposed Skinning (CGF 2025) | 확인 필요 |

**관련 파일**
- `/home/user/ClaudeCode/web/src/core/runtime.js` (2장의 버그, 45–49행)
- `/tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/vbdtest/g.py` (Newton VBD 성장 검증)
- `/tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/vbdtest/t.py`
- `/tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/anny_src/` (Anny 소스 발췌)

Sources:
- [naver/anny](https://github.com/naver/anny)
- [changwoonchoi/GeoStyle](https://github.com/changwoonchoi/GeoStyle)
- [drohmer/velocity_skinning_replicability](https://github.com/drohmer/velocity_skinning_replicability)
- [facebookresearch/physkin](https://github.com/facebookresearch/physkin)
- [newton-physics/newton](https://github.com/newton-physics/newton)
- [hyz317/StdGEN](https://github.com/hyz317/StdGEN)
- [zjp-shadow/CharacterGen](https://github.com/zjp-shadow/CharacterGen)
- [VAST-AI-Research/UniRig](https://github.com/VAST-AI-Research/UniRig)
- [Unity-Technologies/com.unity.demoteam.digital-human](https://github.com/Unity-Technologies/com.unity.demoteam.digital-human)
- [UnityCsReference Mesh.bindings.cs](https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Graphics/Mesh.bindings.cs)
- [Unity-Technologies/sentis-samples](https://github.com/Unity-Technologies/sentis-samples)
- [electronicarts/dem-bones](https://github.com/electronicarts/dem-bones)
- [eth-ait/4d-dress](https://github.com/eth-ait/4d-dress)