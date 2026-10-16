# 바스트 모프 기법 결정 문서 v2: "2017 Kelvinlet 확정"을 다시 연다

> 이 문서의 정정 사항은 [critique-v2.md](critique-v2.md)를 함께 보세요 (Anny는 통계 사전이 아님, GeoStyle 라이선스 불명, Jin 2022 인용 미확인 등). 도메인별 원자료는 [techniques-v2.md](techniques-v2.md).

- 작성일: 2026-10-16
- 대상: 애니풍 성인 여성 캐릭터의 체형 커스터마이즈 슬라이더 (Blender 셰이프 키 → FBX → Unity 블렌드 셰이프)
- 프로토타입: `/home/user/ClaudeCode/web` (`src/core/field.js`, `kelvinlet.js`, `bake.js`, `validate.js`, `runtime.js`, `autofit.js`)
- 검증 표기
  - **확인**: 공식 repo, 소스 코드, BibTeX 같은 1차 출처로 확인했다.
  - **부분**: 논문이 있는 것은 확인했지만 세부 내용은 확인하지 못했다.
  - **미확인**: 검색 요약이나 기억에만 근거한다. 이 컨테이너에서는 arXiv, ACM DL, CVF, docs.unity3d.com에 접속할 수 없었다.

---

## 0. 결론 요약

사용자 지적이 맞다. 지금 구조는 **형상을 만드는 방법**까지 2017 Regularized Kelvinlet 브러시를 손으로 튜닝하는 방식으로 굳혀 버렸다. 리서치 결과를 반영해 결정을 다음과 같이 바꾼다.

1. **Kelvinlet 필드는 형상 생성기에서 내려와 전달층(delivery layer)으로만 남는다.** 맡는 일은 세 가지다.
   - 모든 의상 레이어와 UV 분할 정점에 같은 변위를 주는 매끄러운 바인드 공간 맵 역할
   - 해석적 F⁻ᵀ 노멀 계산
   - 싼 단사성 검사
   2022–2026 문헌에서 이 성질을 대신하는 표면 기법은 찾지 못했다.
2. **형상은 teacher가 만들고 student로 증류(distill)한다.**
   - teacher (i): 준정적 초탄성 FEM 베이크. Stabler Neo-Hookean(2024), 성장 텐서, Cooper 인대 prestress, 역 rest-shape(2022/2026)를 쓴다.
   - teacher (ii): 노멀 기반 dARAP 스타일화. Geometry in Style, CVPR 2025.
   - teacher (iii), 선택: GPU 생성기. GeoStyle, CVPR 2026.
   - student: 중심을 고정한 Kelvinlet 사전 위에서 선형 최소제곱으로 맞춘 필드. 진폭에 대해 선형이므로 블렌드 셰이프 중첩이 위치에서 정확히 유지된다.
3. **의상은 단일 워프 하나로 모든 것을 보장하던 계약을 버리고 3계층으로 나눈다.**
   - 밀착층: 필드를 그대로 쓴다.
   - 브리징·끈이 있는 피트 의상: 필드로 초기화한 뒤 inpainting과 IPC 배리어 리핏(SIGGRAPH 2025)을 한다.
   - 루즈 의상: VBD/OGC 드레이프 베이크(2024–2026)를 한다.
   - 보장은 ipctk의 정확한 교차·거리 인증으로 바꾼다.
4. **파라미터 선택은 손 튜닝에서 자동 루프로 바꾼다.** 순서는 게이트 → 형태계측 → 자연스러움 사전 → 다목적 최적화 → 아트디렉터 선호 BO(PBO, ICML 2023)다. 물리 다이얼(유효 중력, 인대 prestress, 성장 이방성, Poisson 비)을 쓰면 탐색 차원이 4–8로 줄어 PBO가 다룰 수 있는 범위에 들어온다.
5. **런타임은 1-DOF lift 스프링에서 모달 블렌드 셰이프로 올린다.** 리그를 보완하는 모달 블렌드 셰이프(Complementary Dynamics 2020, FCD 2023)에 해석적 진동자 스텝, 선형화한 Velocity Skinning 스타일 셰이프를 더한다. 본을 쓰지 않는 구조는 유지한다.
6. **파이프라인에서 결정적인 사실**: 해석적 F⁻ᵀ 노멀은 Blender + FBX 경로로는 Unity에 **도달하지 않는다**. 소스에서 확인했고, 근거는 3(e)에 있다. 그래서 Unity AssetPostprocessor에서 C# 필드로 다시 굽는 단계를 필수 인프라로 넣는다.
7. **Unity 런타임 비용 구조는 그대로다.** 런타임에는 블렌드 셰이프와 작은 C# 계산만 있다. 새 기법의 무게는 전부 베이크 시점에 둔다.

**"최신성" 정직 표기**

| 구분 | 기법 |
|---|---|
| 실제 2022–2026 기법 | VBD/OGC/DAT, IPC 의상 리타깃, Stabler NH, STAGED, Geometry in Style, GeoStyle, Anny, skew-GP PBO, FCD/Subspace MFEM, Neural-Augmented Kelvinlet |
| 오래됐지만 게임 바디 슬라이더에는 거의 쓰이지 않음 ("지금 쓸 수 있는데 안 쓰는 기법") | Velocity Skinning(2021), 해석적 스프링 스텝(교과서 수준), Jacobian/Poisson 편집(~2004), Mallucci 계측(2012), 인비트윈·조합 셰이프 |

---

## 1. 종합 순위

**채점 규칙**: 각 항목 1–5점, 합계 25점 만점.

| 축 | 기준 |
|---|---|
| N | 자연스러움 |
| S | 과장(스타일) 제어 |
| U | Unity 이식성 |
| F | 실현성. 회의론 검증 뒤 보정값을 썼고, 검증되지 않은 항목은 내가 하향 보정했다. |
| R | 최신성/참신성. 5 = 2025–26이고 게임 사용 증거 없음 · 4 = 2023–24이고 게임 미사용 · 3 = 2021–22, 또는 오래된 기법의 새 적용 · 2 = 고전 기법 · 1 = 업계 표준 |

순위는 가치 판단일 뿐이다. 구현 순서는 의존성 기준으로 4장에서 따로 정한다.

| # | 기법 (출처) | 연도 | N | S | U | F | R | 합 | 위치 | 검증 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 아트디렉터 선호 BO: skew-GP PBO (Takeno et al., ICML 2023, optuna-dashboard `PreferentialGPSampler`, https://github.com/optuna/optuna-dashboard/blob/main/optuna_dashboard/preferential/samplers/gp.py) + Sequential Gallery (Koyama et al., SIGGRAPH 2020) | 2023 | 4 | 5 | 5 | 4.5 | 4 | 22.5 | 베이크 루프 | 확인 |
| 2 | 역 rest-shape / sag-free 초기화: 아트 조각을 중력 평형 상태로 만든다 (Hsu et al., SIGGRAPH 2022; STAGED, CGF 45(2) 2026, https://diglib.eg.org/handle/10.1111/cgf70402) | 2022/2026 | 4 | 5 | 5 | 3 | 5 | 22 | 베이크 | 미확인 |
| 3 | 준정적 초탄성 베이크와 물리 스타일 다이얼: Stable Neo-Hookean + 절대고유값 필터 projected Newton (SIGGRAPH 2024, https://www.cs.columbia.edu/cg/abs-psd), 성장 F=Fe·Fg (AMO 2024, https://pmc.ncbi.nlm.nih.gov/articles/PMC10960783), Cooper 인대 prestress (Briot 2022; Sci Rep 2025, https://www.nature.com/articles/s41598-024-83598-8) | 2024 | 5 | 4 | 5 | 3.5 | 4 | 21.5 | 베이크 | 미확인 |
| 4 | VBD + OGC로 조직과 의상을 함께 베이크 (Chen et al., TOG 2024/2025; Newton SolverVBD, https://github.com/newton-physics/newton; OGC, https://doi.org/10.1145/3731205; Divide-and-Truncate, SIGGRAPH 2026) | 2024–26 | 5 | 3 | 5 | 3 | 5 | 21 | 베이크 | 확인(Newton 문서와 DOI) |
| 5 | 리그 보완 모달 지글 블렌드 셰이프 (Complementary Dynamics 2020, https://github.com/ErisZhang/complementary-dynamics; FCD SIGGRAPH 2023 + Subspace MFEM SA 2023, 레퍼런스 구현 simkit https://github.com/otmanon/simkit) | 2023 | 4 | 4 | 5 | 4 | 4 | 21 | 베이크와 런타임 | 확인 |
| 6 | 무교차 의상 리타깃 IPC 배리어 리핏 (Huang et al., SIGGRAPH 2025, https://doi.org/10.1145/3721238.3730590) + ipctk 1.6 (https://pypi.org/project/ipctk/) | 2025 | 4 | 4 | 5 | 3 | 5 | 21 | 베이크 | 부분 |
| 7 | Anny 통계적 자연스러움 사전 + EDFM (Brégier et al., ECCV 2026, https://github.com/naver/anny, MakeHuman CC0 breast 타깃) | 2025/26 | 4 | 3 | 5 | 4 | 5 | 21 | 베이크 루프 | 확인 |
| 8 | 노멀 기반 dARAP 스타일화, CPU 모드 (Geometry in Style, CVPR 2025, https://github.com/threedle/geometry-in-style) | 2025 | 4 | 4 | 5 | 3 | 5 | 21 | 베이크 | 확인 |
| 9 | Velocity/Acceleration Skinning을 선형화한 스타일 셰이프 기저 (Rohmer et al., EG 2021, https://github.com/drohmer/velocity_skinning_replicability; GI 2022) | 2021 | 3 | 5 | 5 | 5 | 3 | 21 | 런타임 | 부분 |
| 10 | 이미지 가이드 기하 스타일화 (GeoStyle, Choi et al., CVPR 2026, https://github.com/changwoonchoi/GeoStyle) | 2026 | 3 | 5 | 5 | 2.5 | 5 | 20.5 | 베이크(GPU) | 확인 |
| 11 | Unity 임포트 시 해석적 노멀·탄젠트 재굽기 (AssetPostprocessor + `Mesh.AddBlendShapeFrame`, https://github.com/Unity-Technologies/UnityCsReference/blob/master/Runtime/Export/Graphics/Mesh.bindings.cs) | 엔진 | 4 | 4 | 5 | 4 | 3 | 20 | 파이프라인 (**필수**) | 확인 |
| 12 | 절차적 인비트윈 프레임 + 조합 교정 셰이프 (Lewis et al., EG STAR 2014) | 고전 | 4 | 5 | 5 | 4 | 2 | 20 | 베이크와 런타임 | 확인 |
| 13 | 해석적 감쇠 진동자 스텝 (Jin et al., SIGGRAPH 2022, https://arxiv.org/abs/2201.10122) | 2022 | 4 | 4 | 5 | 5 | 2 | 20 | 런타임 | 부분 |
| 14 | VLM 쌍대 토너먼트 심사 (GPTEval3D CVPR 2024, https://arxiv.org/abs/2401.04092; BlenderAlchemy ECCV 2024, https://github.com/ianhuang0630/BlenderAlchemyOfficial) | 2024 | 3 | 4 | 5 | 4 | 4 | 20 | 베이크 루프 | 확인 |
| 15 | Neural-Augmented Kelvinlet 잔차 (AAAI 2026, https://arxiv.org/abs/2506.08043) | 2026 | 4 | 4 | 4 | 3 | 5 | 20 | 베이크 | 미확인 (authoring 도메인 검증에서는 탈락, physics 도메인에서는 검증되지 않은 채 남음) |
| 16 | Somigliana 좌표 탄성 케이지 (Chen, de Goes, Desbrun, SIGGRAPH 2023; 닫힌 형식 Thiery et al. TOG 2024, 코드 https://gitlab.com/jthiery/biharmonic3dcoordinates_siggraph2024) | 2023/24 | 4 | 3 | 5 | 3.5 | 4 | 19.5 | 베이크 | 확인 |
| 17 | 형태계측 목적함수 (Mallucci & Branford 2012/2014, https://doi.org/10.1016/j.bjps.2011.08.006) + BOPE (AISTATS 2022, https://github.com/pytorch/botorch/blob/main/tutorials/bope/bope.ipynb) | 2012/22 | 4 | 4 | 5 | 4.5 | 2 | 19.5 | 베이크 루프 | 부분 |
| 18 | ipctk로 정확한 교차·최소거리 인증 (C-IPC 2021, ipctk 1.6.0 CPU wheel에 barrier와 OGC 포함) | 2021/24 | 4 | 2 | 5 | 5 | 3 | 19 | 검증 | 확인 |

### 순위 밖이지만 계획에 쓰는 것

| 기법 | 쓰는 곳 |
|---|---|
| Robust Skin Weights Transfer의 inpainting (Abdrashitov et al., SA 2023, https://github.com/rin-23/RobustSkinWeightsTransferCode) | 의상 Tier 1 |
| Jacobian/Poisson 편집 (~2004 기법; NJF와 LJN의 학습 부분은 불필요) | 텍스처 늘어짐 클램프 도구 |
| modal-derivative 이차 교정 셰이프 (Barbič & James 2005 계열; Neural Modes CVPR 2024는 GPU 실험용으로만) | 런타임 Phase 2 |
| Unity Mesh-to-SDF 런타임 가드 (https://github.com/Unity-Technologies/com.unity.demoteam.mesh-to-sdf) | 의상 런타임 가드 |
| Blender 네이티브 하네스 (Surface Deform, Cloth "Dynamic Base Mesh", "Apply Modifier as Shape Key") | 통합 도구 |

### 보류 (Phase 3 이후, 또는 조건부)

| 기법 | 보류 이유 |
|---|---|
| PhySkin/HyperBones (CVPR 2026 / SA 2026, 코드 MIT https://github.com/facebookresearch/physkin) | 루즈 의상 × 포즈 × 슬라이더 조합을 런타임에 다룰 수 있는 유일한 후보지만, 의상당 CUDA 학습과 약 128개의 추가 본이 필요하다 |
| Simplicits / FreeForm-RKPM (Kaolin) | 성장(rest-shape 스케일링)이 내장돼 있지 않다. 피부 위에 얇게 겹친 의상 쉘은 같은 occupancy를 공유해 따로 표현되지 않는다 |
| 패턴 재그레이딩 (GarmentCode, https://github.com/maria-korosteleva/GarmentCode; Dress Anyone, https://arxiv.org/abs/2405.19148) | 패턴이 있어야 한다 |
| HOOD/ContourCraft (https://github.com/dolorousrtur/ContourCraft) | SMPL 라이선스가 비상업용이고, 리메시가 필요하다 |
| 학습 기반 포즈 교정 MLP (UE ML Deformer 패턴, https://github.com/PeizhuoLi/neural-blend-shapes) | 처음에는 RBF로 충분하다 |
| 2D 미학 점수기 + CMA-ES (anime_dbaesthetic 등) | 파일럿을 통과하기 전에는 보조 신호로만 쓴다 |
| Unity에서 필드를 라이브로 평가 | GPU 경로 위험. 대신 슬라이더가 바뀔 때 CPU Burst로 캐릭터별 메시를 굽는 안전한 변형을 검토한다 |
| 스프링 본 계열 (KawaiiPhysics, https://github.com/pafuhana1213/KawaiiPhysics; Magica Cloth 2; VRM SpringBone) | 이길 대상인 베이스라인이자 아티스트에게 익숙한 파라미터 어휘로만 쓴다 |

### 검증에서 탈락했거나 파이프라인과 맞지 않아 제외한 것

| 제외 사유 | 기법 |
|---|---|
| 토폴로지를 바꿔 블렌드 셰이프가 되지 않음 | MagicClay, RADmesh, Gaussian splat 드래그 계열 |
| 검증 탈락 | APAP, MeshUp, smooth ARAP, Anisotropic Green Coordinates, latent neural integrator, Dynamic Kelvinlet 임펄스, SMEAR, Bolt, LoBoFit, Compressed Skinning |
| 현재 불가 | USD 경로 (Blender USD exporter는 offset만 쓰고, Unity USD 패키지에는 blend shape 임포트가 없다) |

---

## 2. Kelvinlet 필드는 아직 건전한 베이스라인인가

### 2.1 판정

전달층으로서는 유지한다. 형상 생성기로서는 교체한다. 커널 자체를 바꿀 근거는 아직 약하다.

### 2.2 필드만이 주는 것 (2022–2026 대안 중 이것을 대신하는 것은 없다)

1. **공간 맵이다.** 변위가 위치의 함수이므로, 몸·브라·상의·재킷과 UV 이음새에서 갈라진 정점이 모두 같은 변위를 받는다. 레이어 순서가 유지되고 이음새가 벌어지지 않는다. 표면 기법(dARAP, Jacobian/Poisson, GeoStyle, APAP 등)은 모두 하나로 용접된 몸 표면에서만 정의된다.
2. **닫힌 형식의 J가 있다.** 그래서 노멀 델타가 normalize(F⁻ᵀn)으로 정확하다. 툰 셰이딩의 명암 경계(terminator)가 형상을 정확히 따라간다.
3. **단사성을 싸게 검사할 수 있다.** det(I+ΣwJ)>0을 격자에서 확인한다 (`validate.js` `fieldCheck`, `extremeCombos`).
4. **진폭에 대해 선형이다.** 바인드 위치에서 평가하므로, 블렌드 셰이프의 가중합이 위치에 대해 결합 필드와 정확히 같다. 위치 중첩 오차가 0이다.
5. **파라미터가 수십~수백 개 숫자뿐이다.** C#이나 HLSL로 옮기기 쉽고, 최적화기와 PBO의 탐색 공간으로 쓸 수 있다.

### 2.3 필드의 실제 한계

1. 형상을 힘과 브러시로 지정한다. 사람이 원하는 모양(실루엣, 프로파일)과 직접 연결되지 않는다.
2. 선형 탄성, 소변형 커널이다. 큰 `size_up`에서 체적이 일관되게 늘지 않고, 흉벽 접촉에 따른 기저부 제한, 중력 처짐, 피부 장력에 의한 상부 라운딩을 표현하지 못한다.
3. 의상을 피부와 평행하게만 움직인다. 클리비지 위로 원단이 팽팽하게 걸치는 브리징, 끈 미끄러짐, 헴 들림은 원리적으로 불가능하다.
4. 측면당 브러시가 1–3개여서 날카로운 IMF 주름 같은 고주파 형태를 만들 수 없다 (`DEFAULT_PARAMS`).
5. 파라미터를 손으로 튜닝한다.
6. 연속 맵이 단사여도 이산 삼각형끼리의 무교차까지 보장하지는 않는다. 필드 곡률에 비해 삼각형이 크면 교차가 생길 수 있으므로, 정확한 이산 검사(ipctk)가 필요하다.

### 2.4 각 신기법이 구체적으로 더하는 것

| 기법 | 필드가 못 하는 것 | 필드로 돌아오는 경로 |
|---|---|---|
| 준정적 FEM (SNH + 성장 + 중력 + 인대) | 체적 일관 성장, 흉벽에 막힌 기저부, 중력 처짐, 피부 장력에 의한 구형 상부(Laplace 법칙) | teacher 변위를 증류 |
| 역 rest-shape (Hsu 2022 / STAGED 2026) | 아트 조각이 기본 포즈에서 정확히 재현되면서, 파생 변형은 모두 물리적으로 일관됨 | 모든 FEM teacher의 출발 상태 |
| 물리 다이얼 (유효 중력 ρgL/μ, 인대 prestress, 전방 이방성 성장, Poisson 비) | 자연형과 과장형을 의미 있는 4–8개 손잡이로 표현 | PBO와 CMA-ES의 탐색 변수 |
| dARAP (Geometry in Style) | 힘이 아니라 목표 노멀(모양)로 프로파일과 곡률을 지정. 둥근 상부, 또렷한 IMF | teacher. ARAP은 면적 증가에 저항하므로 크기용으로는 쓰지 않는다 |
| GeoStyle (CVPR 2026) | 사내 컨셉아트로 과장 실루엣을 제안 | teacher (GPU, 제안용) |
| IPC 리핏, VBD/OGC 드레이프 | 원단 장력, 브리징, 끈 미끄러짐, 헴 들림과 전진 | 의상별 셰이프 키 (필드 밖, ipctk 인증) |
| 모달 기저 (Complementary Dynamics 2020, FCD 2023) | 1-DOF lift 스프링 대신 물리적으로 유도된 다자유도 바운스·흔들림·비틀림 | 모드도 증류해 모든 레이어에 적용 |
| PBO, Anny, 형태계측 | 손 튜닝을 대체하고 아트디렉터의 취향을 학습 | 필드 파라미터(θ)를 선택 |
| Unity 재굽기 | 해석적 노멀이 실제로 Unity까지 도달 | C# 필드 포트 |

### 2.5 커널 교체 후보 평가

| 후보 | 평가 |
|---|---|
| Sharp Kelvinlets (2019) | 그래픽스 분야에서 확인된 Kelvinlet의 마지막 확장이다. 이후 확장은 찾지 못했다. |
| Somigliana 좌표 (2023/24) | de Goes가 공저한 탄성 케이지 후속작이다. 새 능력이 아니라 아티스트용 제어 방식(케이지)이 바뀌는 점진적 개선이다. 코드가 있지만 라이선스가 명시되지 않았다. 합성(composite) F는 autodiff나 유한차분으로 구해야 한다. → Phase 3의 저작 UI 후보로 둔다. |
| Neural-Augmented Kelvinlet (AAAI 2026, 미확인) | 2026년에도 Kelvinlet이 해석적 사전(prior)으로 쓰인다는 증거다. 우리 구조(Kelvinlet + 잔차)와 같은 방향이다. 물리 베이크 데이터가 먼저 있어야 한다. |

결론: 커널은 유지한다. 대신 **고정 중심 Kelvinlet 사전**(측면당 24–64개 원자, 반경 3단계, grab과 scale)으로 표현력을 늘린다. 진폭에 선형이므로 증류는 ridge 최소제곱 한 번으로 끝난다.

### 2.6 계약 변경

| 이전 | 이후 |
|---|---|
| 단일 워프가 모든 레이어의 무교차를 보장 | 밀착층은 필드 + det + 이산 검사로 보장. 물리로 처리한 의상층은 필드로 초기화하고, IPC/OGC로 풀고, ipctk 인증으로 보장 |

---

## 3. 업그레이드 아키텍처

```
[아트 base sculpt] --(역 rest-shape)--> [rest 상태]
   |-- Teacher A: 준정적 FEM (성장, 중력, 인대 prestress, 압력)  -> natural 끝 + 물리 다이얼
   |-- Teacher B: dARAP 노멀 스타일화 (CPU)                    -> stylized 프로파일
   '-- Teacher C (GPU, 선택): GeoStyle / NAK 잔차
             | 증류: Kelvinlet 사전 선형 LS + det 제약 (+ 피부 바깥 쉘 샘플)
             v
   Student: 바인드 공간 필드 W * sum(Kelvinlet), 중앙선 분할·잠금 -- 게이트(det, 레이어 순서, 간격)
             |
 (c) 어필 루프: 형태계측 -> Anny 사전 -> CMA-ES/NSGA-II(물리 다이얼) -> VLM -> PBO(아트디렉터)
             |
 (b) 의상: 밀착=필드 | 브리징·끈=필드+inpaint+IPC 리핏 | 루즈=VBD/OGC 드레이프 -> ipctk 인증
             |
 (e) Blender(위치만, 미리보기) -> FBX -> Unity AssetPostprocessor
       (C# 필드 재굽기: 위치, F^-T 노멀, 아웃라인 탄젠트, 인비트윈, 보정)
       + 사이드카(물리 의상 델타)
             |
 (d) Unity 런타임: 슬라이더 + 모달 지글(해석 스텝) + Velocity Skinning 셰이프
       + 포즈/중력 보정(RBF) -> SetBlendShapeWeight
```

### (a) 형상 생성 (베이크 시점)

**선택 1. Teacher A: 준정적 초탄성 FEM**
- **볼륨**: 프록시 볼륨은 `autofit.js`의 높이맵 래스터화를 재사용해 만든다. 전면 피부 표면과 흉벽 오프셋 사이를 압출해 tet 격자를 깐다. 지저분한 게임 메시를 TetGen으로 tet화하는 문제를 피할 수 있다.
- **에너지와 솔버**: Stable Neo-Hookean 에너지를 쓰고, 절대고유값 필터 projected Newton(PCG)으로 정적 평형을 직접 푼다. 동역학을 감쇠시켜 수렴시키는 방식은 쓰지 않는다.
- **하중 케이스**

  | 타깃 | 하중 |
  |---|---|
  | size | 선 조직 부피에 Fg=(1+s)^{1/3}I. 과장형은 전방 축 이방성과 피부 prestress를 쓴다 |
  | lift | 유효 중력의 크기·방향, 그리고 인대 prestress |
  | spread | 측방 체력(body force) |

- **역 rest-shape**: 고정점 반복 X_rest ← X_rest + (X_target − x_eq(X_rest))로 구한다. 더 견고한 방법이 필요하면 Hsu 2022나 STAGED로 올린다.
- **재질 범위**: 유방 FE 문헌(Briot 2022, Sci Rep 2025)의 범위는 정성적 사전으로만 쓴다. 실측 환자 파라미터를 애니 체형에 그대로 옮기지 않는다.

**선택 2. Teacher B: dARAP**
- 바스트 ROI 안에서 이상화한 타원체나 물방울 형태를 apex에 맞추고, 그 노멀을 목표 노멀로 정한다.
- 공식 코드는 `pin_first_vertex`만 지원하므로, 윈도 경계의 Dirichlet 앵커는 직접 구현한다.
- Teacher A 결과 위에 프로파일·곡률 스타일만 덧입히는 데 쓴다.
- λ가 곧 "스타일 양"이다.

**선택 3. 증류(student)**
- 중심을 고정한 Kelvinlet 사전 위에서 선형 ridge LS를 푼다. 그 뒤 윈도와 중앙선 잠금을 곱한다.
- 샘플은 세 종류를 쓴다.
  - 피부 정점
  - 내부 격자 노드
  - 피부 바깥 1–3 cm의 쉘 샘플. teacher 변위를 노멀 방향으로 일정하게 외삽한 값이다. 의상이 놓이는 영역의 필드를 통제하기 위해 넣는다.
- `extremeCombos`에서 det(I+ΣwJ)이 0 이하가 되면 정칙화를 키우거나 LM 패널티를 추가한다.

**이유**: teacher가 모양과 물리를 정하고, student가 보장·해석적 노멀·이식성을 지킨다.

**현재 코드에서 유지하는 것**

| 파일 | 유지 대상 |
|---|---|
| `field.js` | 윈도, 중앙선 분할, lockLateral, sliderToWeights |
| `kelvinlet.js` | 사전 원자로 사용 |
| `bake.js` | F⁻ᵀ 노멀 |
| `validate.js` | 전부 |
| `autofit.js` | apex 검출, 높이맵 |

**클라우드(three.js, GPU 없음)에서 검증 가능**: JS FEM teacher, 역 rest-shape, CPU dARAP, 증류 피터, 손 튜닝 `DEFAULT_PARAMS`와의 형태계측 비교 (Seed-san, Michelle).

**로컬에서 필요한 것**

| 항목 | 이유·조건 |
|---|---|
| GeoStyle | SDXL + DreamBooth LoRA, CUDA. 레퍼런스는 사내 아트만 쓴다 |
| Geometry in Style 텍스트 모드 | DeepFloyd IF가 연구용 라이선스이고 48GB급 GPU가 필요하므로 **출시 에셋에는 사용 금지** |
| 고해상도 FEM | Newton VBD on GPU |
| Blender 베이크 포트 | 로컬 Blender |

### (b) 의상 처리

| 계층 | 대상 | 기법 | 보장 |
|---|---|---|---|
| Tier 0 | 브라, 바디슈트, 그린 듯 밀착한 애니 상의 | 필드 그대로 | det, 이산 검사 |
| Tier 1 | 클리비지 브리징이나 끈이 있는 피트 상의 | 필드로 초기화. 매칭되지 않거나 브리징하는 영역에만 inpainting (Abdrashitov 2023. 실제 에너지는 Q = −L + L·M⁻¹·L 혼합형). 그다음 IPC 배리어 리핏 | ipctk |
| Tier 2 | 코트, 루즈 상의, 스커트 | VBD 드레이프, 모프 경로를 따라 이동 (Newton SolverVBD) | DAT 절단 + ipctk |

**Tier 1 IPC 리핏의 에너지**: 저작 의상 기준의 막(membrane)·굽힘 변형률 + 영역별 tightness 목표(Pixar 2020) + 몸과 안쪽 레이어에 대한 배리어. 안쪽 레이어부터 바깥쪽으로 푼다. Huang et al. 2025의 정확한 에너지 항은 원문에서 확인해야 한다.

**Tier 2 세부**
- 차분 델타 = sim(target) − sim(basis)를 저작 메시에 적용한다. 그래야 가중치 0에서 저작 의상과 정확히 같다.
- "hug"와 "taut" 두 변형을 굽고 "원단 장력" 슬라이더로 섞는다.
- 저주파 잔차만 굽는다. 고주파 주름까지 구우면 선형 보간에서 주름이 헤엄친다.
- OGC는 아직 Newton에 들어 있지 않다. 대신 ipctk 1.6.0에 OGC(TrustRegion)가 들어 있어, Linux CPU에서도 OGC 수준의 보장으로 안정화할 수 있다.

**인증**: ipctk `has_intersections`와 최소거리를 `extremeCombos` × w∈{0.25, 0.5, 0.75, 1} 전체에 대해 확인한다. 저작된 rest 상태가 이미 교차가 없고 간격이 d̂보다 커야 한다는 전제가 있다. 애니 의상은 간격이 0이거나 이미 파고든 경우가 흔하므로, 의상 밑에 가려지는 몸은 컬링하거나 먼저 정리한다.

**런타임 가드**: Mesh-to-SDF로 저강도 밀어내기를 한다. 64³ 볼륨에서 복셀이 약 5 mm여서 1–3 mm 간격은 강제하지 못하므로, 큰 관통만 막는 가드로 쓴다. 의상 버텍스 셰이더에서 SDF를 샘플링하고 shadow, depth, motion vector 패스에 똑같이 적용한다.

**현재 코드에서 유지하는 것**: `meshCheck`(레이어 순서), `computeMask`, `extremeCombos`.

**클라우드**: Tier 0과 Tier 1(inpainting + 장애물 제약 막 이완 + 간격 검사)을 JS로. ipctk 인증과 Newton VBD 소규모 드레이프는 같은 컨테이너의 Python CPU로 한다. scratch venv에 newton 1.7.0, warp 1.18.0, ipctk 1.6.0이 이미 설치돼 있다.

**로컬**: GPU로 고해상도 드레이프, Unity 가드, Marvelous Designer 패턴(있는 경우).

### (c) 어필·파라미터 최적화 루프

1. **게이트 (ms 단위)**: det, 레이어 순서, 최소 의상 간격을 w={0.5, 1}과 lift ±1, spread ±1 스택에서 확인한다.
2. **형태계측 M**
   - 측정 항목: apex 시상 단면 기준 UP:LP, apex tilt, 상부 곡률 부호, 하부 볼록도, IMF 높이, 돌출/기저폭, 프로파일 총 회전량. 횡단면 기준 측방 발산.
   - 자연 대역: Mallucci 45:55, 약 20°.
   - 애니 대역: 약 50:50, 25–30°, 상부 약간 볼록, 높은 IMF. 이것은 **가설**이고 PBO로 검증해야 한다.
3. **자연스러움 N**
   - Anny의 성인 전용 breast 타깃을 사전 공간에 맞춘다. `age`는 'young' 앵커 이상으로 고정하고 child 타깃은 쓰지 않는다. 이것은 코드에서 하드 assert로 둔다.
   - RBSM은 라이선스를 확인할 수 있을 때만, 오프라인 지표 분포 보정용으로 쓴다.
4. **최적화기**: CMA-ES나 NSGA-II. 탐색 변수는 날 브러시 20개가 아니라 **물리 다이얼 + dARAP λ + 윈도**(4–8차원)다.
5. **Pareto 프런트 = style 슬라이더의 양 끝.** style=0.5의 선형 혼합이 프런트 근처에 있는지 확인하고, 벗어나면 인비트윈을 넣는다.
6. **VLM 쌍대 토너먼트 (선택)**
   - 루브릭: 실루엣 명료성, 흉벽 부착감, 의상 추종, 동일 캐릭터 유지.
   - A/B 순서를 바꿔 여러 번 샘플링한다.
   - 입력은 착의 렌더, 크롭, 실루엣, 노멀맵만 쓴다.
7. **아트디렉터 PBO**: 타깃당 30–60회 비교. 학습한 효용으로 자동 평가 항목의 λ 가중치를 다시 맞춘다.

**2D 미학 점수기**: 먼저 파일럿을 돌려 θ를 스윕했을 때 점수가 반응하는지, 그리고 PBO 선택과 상관이 있는지 확인한다. 통과하기 전에는 fitness에서 뺀다. 웹 데이터 편향 때문에 과장·선정성 방향으로 reward hacking이 일어날 위험이 있다.

**현재 코드에서 유지하는 것**: `autofit.js` apex 검출, `validate.js` 게이트, `sliderToWeights`의 style 혼합.

**클라우드**: `morpho.js`, `cmaes.js`, Pareto 계산과 style 0.5 검사, `scripts/shoot.mjs`(Playwright)로 착의 툰 렌더 컨택트 시트 생성.

**로컬**: 아트디렉터와의 PBO 세션(optuna-dashboard), VLM 심사(API 또는 로컬 GPU).

### (d) 런타임 (Unity): 모션과 교정

**1. 모달 지글**
- 바스트 FEM에서 흉벽을 Dirichlet로 고정하고, 강성을 이질적으로 둔다(Subspace MFEM의 아이디어).
- 선형 변위 모드 4–6개를 L/R 공동으로 구한다. 그래야 좌우 결합이 생긴다.
- 슬라이더 셰이프와 흉부 강체 운동에 대해 질량 직교화한다. 이것이 Complementary Dynamics의 아이디어다.
- 모드 하나가 셰이프 하나다. 각 모드도 증류해 모든 레이어에 적용한다.
- 정직 표기: 선형 변위 모드 자체는 DyRT(2002) 계열의 오래된 기법이다. 새로운 부분은 리그 보완(2020), 이질 강성 부분공간(2023), skinning eigenmode(2023)다.
- **외력**: −Φᵀ M (a_chest + α×r + ω×(ω×r) + 2ω×v − g). 원래 제안에서 빠졌던 Coriolis 항과 중력 항을 넣었다.
- **적분**: (K_r, M_r)를 대각화한 뒤 모드별로 정확 이산화(1차 홀드 외력)한다. 지금 `runtime.js`는 semi-implicit Euler 4 서브스텝에 `dt = min(dt, 1/30)`이라서 프레임이 떨어지면 물리가 바뀐다. 이것을 해결한다.
- **아트 파라미터**: overshoot %와 정착 시간에서 ζ = −ln(OS)/√(π² + ln²OS)와 ω를 계산한다.
- **크기 의존성**: 3–5개 크기 샘플에서 모드를 굽고 보간한다.
- **Phase 2 업그레이드**: 큰 진폭에서 선형 모드가 풍선처럼 부풀면, modal-derivative 이차 교정(모드 4개면 교정 10개, CPU로 계산)이나 skinning eigenmode + FCD local-global을 Burst로 포팅한다 (simkit 참고).

**2. 스타일 레이어: Velocity/Acceleration Skinning 선형화**
- squashy: traceless 대칭 텐서이므로 5 셰이프로 **정확히** 표현된다.
- floppy: 3 셰이프, 1차 근사.
- follow-through: 3 셰이프.
- 구동 입력은 모달의 상대 속도와 흉부 ω/α다. 현재 하드코딩된 `spread = −squashStretch·lift`를 대체한다.
- 가중치에 부호가 있으므로, Clamp BlendShapes를 끄거나 ± 쌍 셰이프를 쓴다.
- 원 코드 번들의 라이선스는 확인하지 못했다.

**3. 포즈·중력 교정**
- 물리 베이크로 스윕한다: 팔 올림, 팔 교차(측방 압박), 앞으로 숙임, 누움.
- 결과를 PCA로 K=8–16개 셰이프로 압축한다.
- 입력(흉부 기준 중력 방향, 상완 각도, 슬라이더)에서 RBF나 선형 회귀로 가중치를 구한다. 이것이 현재 `poseCorrective`를 대체한다.
- MLP(ML Deformer 패턴)는 나중의 선택지다.

**4. 팔 캡슐 충돌 (선택)**: 핸들 수준에서 VRM SpringBone 어휘로 처리한다. 모달 방식에는 충돌이 없기 때문이다.

**5. 셰이프 예산 추정** (레이어당 희소 셰이프, 기기에서 프로파일 필요)

| 항목 | 개수 |
|---|---|
| 슬라이더 | 7 |
| 조합 교정 | 3–6 |
| 모드 | 4–6 |
| Velocity Skinning | 11 |
| 포즈 교정 | 8–16 |
| 합계 | 약 35–50 |

인비트윈은 별도 셰이프가 아니라 프레임으로 들어간다.

**현재 코드에서 유지하는 것**: `BustDynamics`의 인터페이스, `combineWeights`, `poseCorrective`의 API 자리. 적분기는 교체한다.

**클라우드**: 런타임 로직 전부를 JS로 구현한다. 30/60/120 fps 궤적 일치 테스트, 최대 진폭에서 det 검사, 뷰어에서 애니메이션 재생.

**로컬**: Unity MonoBehaviour와 Burst, 기기 프로파일링.

### (e) 파이프라인·교환 설정

**소스 오브 트루스는 FBX 셰이프 키가 아니다.** 필드 파라미터 JSON과, 물리로 처리한 의상 델타 사이드카가 기준이다.

**Blender** (미리보기와 위치만): https://github.com/blender/blender/blob/main/scripts/addons_core/io_scene_fbx/export_fbx_bin.py
- NumPy `foreach_set`으로 굽는다. `relative_key` = Basis, 내보내기 전 `value` = 0.
- **`vertex_group`은 절대 쓰지 않는다.** 마스크는 델타에 곱해 넣는다. 이유는 다음과 같다.
  - FBX 익스포터는 vgroup 가중치를 FullWeights에 넣고 델타 자체는 마스킹하지 않는다.
  - Unity가 이것을 어떻게 해석하는지는 미확인이다.
- 툰 커스텀 노멀은 Data Transfer로 넣는다. NonGeometrical 모디파이어라 셰이프 키가 있어도 적용된다. Normal Edit와 Weighted Normal은 셰이프 키가 있으면 적용이 거부된다.
- FBX 설정: Smoothing은 "Normals Only", Apply Transform, deform 본만.
- 소스에서 확인한 사실
  - FBX 셰이프 노멀은 `normals_vertex_get()`, 즉 매끈한 정점 노멀이다. 커스텀 노멀과 sharp를 무시한다.
  - FBX에는 인비트윈이 없다.

**Unity AssetPostprocessor**: https://github.com/Unity-Technologies/UnityCsReference/blob/master/Modules/AssetPipelineEditor/ImportSettings/ModelImporterModelEditor.cs

- **OnPreprocessModel**에서 다음 설정을 강제한다.
  - `importBlendShapes` = true
  - `importBlendShapeDeformPercent` = false
  - `importNormals` = Import
  - `importBlendShapeNormals` = Import
  - `meshCompression` = Off
  - `legacyComputeAllNormalsFromSmoothingGroupsWhenMeshHasBlendShapes` = false. 이 속성은 internal이므로 `SerializedObject`로 설정한다.
  - 인스펙터에서 Normals 모드를 바꾸면 Blend Shape Normals가 Calculate로 리셋된다. 소스 주석으로 확인했다. 그래서 매 임포트마다 강제한다.
- **OnPostprocessModel**에서 C# 필드를 임포트된 정점마다 평가한다.
  - 흉부 bindpose로 바인드 공간으로 옮긴다. Unity는 왼손 좌표계이므로 `field.js` 주석대로 외적을 뒤집는다.
  - deltaNormals = normalize(F⁻ᵀn_custom) − n_custom.
  - 아웃라인 노멀은 후처리기에서 계산해 tangent에 쓴다. 그 메시에서는 노멀맵용 탄젠트를 포기해야 하므로 결정이 필요하다.
  - `ClearBlendShapes` 후 프레임 가중치를 오름차순으로 다시 추가한다. 인비트윈 25/50/75/100과 오버드라이브 150을 포함한다.
  - 조합 교정은 위치가 아니라 **노멀과 접힘**(det(I+ΣwJ)≤0 영역)에만 필요하다. 위치는 이미 정확히 중첩되기 때문이다.
  - det 검사나 레이어 검사가 실패하면 임포트를 실패시킨다.
  - 결과는 메시 해시와 파라미터 해시로 캐시한다.
- 필드가 위치에만 의존하므로, Unity의 seam split, weld, Optimize Mesh 재정렬이 일어나도 인덱스 매핑이 필요 없다.

**사이드카** (필드가 아닌 델타, 즉 Tier 1·2 의상)
- 키: 바인드 위치 해시. split 정점은 노멀로 구분한다.
- 내용: 위치 델타, 그리고 정점별 F로 회전시킨 커스텀 노멀 델타. F는 one-ring 최소제곱으로 추정한다.
- Unity "Calculate"로 노멀을 다시 계산하면 툰 노멀을 잃으므로 쓰지 않는다.

**런타임 설정**: https://github.com/Unity-Technologies/UnityCsReference/blob/master/Editor/Mono/PlayerSettings.bindings.cs
- Player Settings "GPU Skinning" = GPU (Batched). 지원하지 않는 플랫폼에서는 자동으로 GPU로 내려간다.
- Clamp BlendShapes는 끄고, 클램프는 드라이버 코드에서 한다.
- `localBounds`를 셰이프 최대 범위만큼 넓힌다.
- `skinnedMotionVectors`를 켠다.

**glTF는 보조 경로이자 교차 검증용이다**: https://github.com/blender/blender/blob/main/scripts/addons_core/io_scene_gltf2/blender/exp/primitive_extract.py
- Blender glTF 익스포터는 `normals_split_get()`으로 커스텀 노멀을 반영한 모프 노멀을 쓴다.
- glTFast는 탄젠트 델타를 유지한다.
- UniVRM(https://github.com/vrm-c/UniVRM)은 탄젠트 델타를 버리고 기본 탄젠트도 무조건 다시 계산한다. tangent에 저장한 아웃라인 노멀과 호환되지 않는다.

**클라우드**: `golden.json` 생성 (`field.js` 주석에는 `docs/golden.json`과 `docs/METHOD.md`가 언급되지만 저장소에 없다), 파라미터 JSON 스키마, Unity의 split·재정렬을 흉내 낸 사이드카 매칭 테스트, three.js `GLTFExporter`로 교차 검증.

**로컬**: C# 포트와 Unity 안의 golden 테스트, Blender 애드온.

---

## 4. 단계별 구현 계획

### Phase 1: 이 클라우드 세션에서 JS/three.js로 바로 구현·검증 (CPU, GPU 없음)

| ID | 작업 | 파일 | 합격 기준 |
|---|---|---|---|
| P1-1 | golden 값과 파라미터 스키마 | `docs/golden.json`, `src/core/params.schema` | 필드·J·노멀 샘플 200점, 왕복(직렬화·역직렬화) 오차 1e-9 |
| P1-2 | 형태계측 + 뷰어 HUD | `src/core/morpho.js` | Seed-san과 Michelle에서 해상도를 바꿔도 지표 변동 2% 이내. 손 튜닝 `DEFAULT_PARAMS`의 natural/stylized 지표를 표로 기록 |
| P1-3 | 프록시 볼륨 FEM teacher (높이맵 압출 tet, SNH + 절대고유값 projected Newton/PCG, 중력, 성장, 장력 전용 인대 스프링, 역 rest-shape) | `src/core/fem.js`, `src/core/inverse.js` | 상대 잔차 1e-6 이하, 모든 tet에서 det(F)>0, 선 조직 부피 변화가 지정 성장의 ±5% 이내, 역 rest 후 base sculpt 재현 오차 0.5%S 이하 |
| P1-4 | Kelvinlet 사전 증류 | `src/core/distill.js` | 윈도 내 피부 RMS 오차가 최대 변위의 3% 이하(원자 64개 이하), `extremeCombos`에서 min det(I+ΣwJ) > 0.2, `meshCheck` 통과 |
| P1-5 | CPU dARAP (목표 노멀 Procrustes 로컬 스텝 + CG 글로벌, 윈도 경계 Dirichlet) | `src/core/darap.js` | ROI 밖 변위가 1e-4 S 이하, λ 단조성(λ가 클수록 목표 노멀 편차 감소) |
| P1-6 | CMA-ES와 Pareto (물리 다이얼, λ, 윈도) | `src/core/cmaes.js`, `scripts/optimize.mjs` | natural 끝이 Mallucci 대역 안, stylized 끝이 애니 가설 대역 안, style=0.5 혼합의 프런트 이탈 판정 |
| P1-7 | 런타임 업그레이드: 해석적 스텝, 모달 셰이프(부분공간 반복 + CG 고유해), Velocity Skinning 셰이프 | `runtime.js`, `src/core/modal.js`, `src/core/vskin.js` | 30/60/120 fps 궤적 차이 1% 이하, 최대 진폭에서 det>0, 모드와 슬라이더 셰이프의 질량 내적 1e-6 이하 |
| P1-8 | 의상 Tier 1 (cling 맵, 쌍라플라시안 inpainting, 장애물 제약 막 이완) | `src/core/garment.js` | w∈{0.25, 0.5, 0.75, 1}에서 최소 간격이 두께 이상, 브리지 영역이 apex를 따라 전진(정성 + 수치) |
| P1-9 | 조합·인비트윈 분석 | `validate.js` 확장 | 조합별 노멀 오차 맵, 프레임 중간점의 det, 교정이 필요한 조합 목록 |
| P1-10 | 리뷰용 착의 툰 컨택트 시트 | `scripts/shoot.mjs` 확장 | 고정 카메라 6뷰 × 2포즈, A/B 비교 페이지 |

**Phase 1b: 같은 컨테이너, Python CPU** (scratch venv: `/tmp/claude-0/-home-user-ClaudeCode/4080deb5-ddc7-578d-82ab-36b2a08d8a54/scratchpad/venv`)
- ipctk로 Phase 1 출력 메시를 인증한다.
- Newton SolverVBD로 Tier 2 소규모 드레이프를 시험한다. 변형하는 몸을 콜라이더로 쓰는 API는 미확인이므로 먼저 확인한다.
- simkit `skinning_eigenmodes`로 `modal.js`를 교차 검증한다.
- optuna-dashboard PBO를 드라이런한다.

**Phase 1 종료 시 결정 게이트**

| 관찰 | 결정 |
|---|---|
| 원자 64개로도 증류 오차가 3%를 넘음 | RBF 잔차 필드나 Somigliana 케이지 검토 |
| 물리 다이얼만으로 과장형이 나오지 않음 | dARAP 비중을 늘림 |
| 선형 모드가 큰 진폭에서 부풂 | Phase 2에서 이차 교정을 앞당김 |

### Phase 2: 사용자 로컬 (Blender + Unity, 로컬 GPU)

- Blender 베이크 애드온(NumPy 포트, 2(e) 설정).
- Unity AssetPostprocessor, C# 필드, golden 테스트, 인비트윈, 노멀·접힘 교정.
- 런타임 MonoBehaviour와 Burst (모달, Velocity Skinning, RBF 포즈 교정). 실기기에서 GPU (Batched) 비용과, 가중치 0인 셰이프를 실제로 건너뛰는지 확인한다.
- 물리 베이크를 생산 해상도로: Newton VBD on GPU, Tier 2 드레이프, 포즈·중력 스윕.
- 아트디렉터 PBO(타깃당 30–60회)와 VLM 토너먼트. 학습된 효용으로 λ를 다시 가중한다.
- Mesh-to-SDF 런타임 가드.

### Phase 3: GPU와 연구 항목

- GeoStyle을 사내 컨셉아트로 실행해 stylized 제안을 받는다. 라이선스 검토가 먼저다.
- Neural-Augmented Kelvinlet 잔차(존재와 코드 재확인 후).
- Somigliana 케이지 저작 UI.
- FCD local-global Burst 포트, 또는 modal-derivative 이차 교정.
- PhySkin/HyperBones로 루즈 의상 런타임.
- 패턴 재그레이딩(natural 피트 의상).
- 슬라이더가 바뀔 때 CPU Burst로 캐릭터별 메시를 굽는 방식.

---

## 5. 위험과 미해결 질문

### 위험

| 위험 | 영향 | 완화 |
|---|---|---|
| 증류 충실도: 원자가 적으면 IMF 같은 고주파가 손실되고, 원자가 많으면 접힘 위험 | 형태 품질 저하 | 사전 크기 스윕, det 제약, RBF 잔차를 대안으로 |
| 애니 체형의 재질 파라미터에 실측 근거가 없음. 물리는 사실주의 쪽으로 끈다 | 과장 손실 | 물리는 natural 끝과 다이얼에만 쓰고, 과장은 역 rest-shape, 다이얼, dARAP으로 |
| 중력에 맞서는 극단적 조각에서 역 rest-shape가 발산하거나 교차 | 베이크 실패 | 유효 중력을 클램프하고 인대 prestress로 대체, STAGED나 Hsu 2022로 상향 |
| 물리 응답은 비선형인데 블렌드 셰이프는 선형 | 조합과 중간값에서 오차 | 인비트윈, 조합 교정, 중간점 검증 |
| 의상 보장 방식이 필드에서 인증으로 바뀜. 애니 의상은 rest 상태 간격이 0 이하인 경우가 많음 | IPC 시작 불가 | 가려진 몸 컬링, 사전 정리(ContourCraft 아이디어), 인증 실패 시 Tier 다운그레이드 |
| FBX에서 Unity로 갈 때 필드가 아닌 델타의 정점 정체성이 사라짐 | 사이드카 매칭 실패 | 위치 해시 + 노멀 구분, Phase 1에서 매칭 테스트 |
| tangent 아웃라인 노멀이 노멀맵과 충돌하고, UniVRM과는 호환되지 않음 | 아웃라인 드리프트 | 아웃라인 방식 결정(질문 8) |
| C#과 JS 필드의 수치 불일치 | 레이어 순서 깨짐 | golden CI |
| PBO는 6–10차원이 넘으면 성능이 급락하고, 아트디렉터 한 명의 취향에 치우침 | 수렴 실패, 편향 | 물리 다이얼로 4–8차원, 형태계측과 사전으로 보조 |
| 학습 점수기와 diffusion 사전이 과장·선정성 쪽으로 편향 | 품질·윤리 | 착의 렌더만, 성인 앵커만, 파라미터 경계와 N 항, 인간 승인 게이트 |
| 라이선스 | 법적 위험 | DeepFloyd IF(연구용) 출시 사용 금지 · SDXL 검토 · SMPL 계열은 비상업용 · RBSM 미확인 · Somigliana/biharmonic 코드 라이선스 불명 · BlenderAlchemyOfficial은 라이선스 파일 없음(코드 복사 금지) · Roblox 레이어드 의상 특허 미확인 |
| Newton SolverVBD가 experimental이라 API가 바뀜. Gaia는 Windows 전용 | 유지보수 부담 | 버전 고정, 베이크 도구에만 사용 |
| 모바일 비용 | 프레임 예산 | 셰이프 35–50개 추정은 확인 전 가정. Phase 2에서 실기기 측정 |

### 검증 공백 (원문 재확인 필요)

| 분류 | 항목 |
|---|---|
| 세부를 확인하지 못한 논문 | STAGED와 Hsu 2022 세부 · 성장 텐서 논문(Ortigosa-Martínez 2024) · Stabler NH 세부 · Clinical Biomechanics 2026 인대 네트워크 논문 저자 · Neural-Augmented Kelvinlet 코드 링크 · Spring Decomposed Skinning(CGF 2025) · Acceleration Skinning 저자와 DOI · Velocity Skinning 보충 코드의 라이선스 · Huang et al. 2025의 에너지 항 |
| 저자 주장 성능 수치 | PhySkin, FCD, OGC |
| Unity 동작 | 가중치 0 셰이프 건너뛰기 · FullWeights 해석 · Mesh LOD 버퍼 공유 · `AddBlendShapeFrame` 오름차순 재구성 요구 |
| 기타 | UE ML Deformer 문서 URL · Ziva 단종일(2024-04) · MagicaCloth와 블렌드 셰이프 호환성 |

### 사용자에게 묻는 것

1. 타깃 플랫폼에 모바일이 포함되는가? 셰이프 수 예산이 이것으로 정해진다.
2. 범위에 드는 의상 종류는 무엇인가? 밀착, 피트, 루즈 비율. Marvelous Designer나 Style3D 패턴이 있는가?
3. 아트디렉터가 타깃당 30–60회 쌍대 선택에 참여할 수 있는가?
4. 런타임 추가 본(팔 캡슐 충돌용 1–2개)을 허용하는가?
5. 로컬 GPU의 VRAM은 얼마인가? GeoStyle/SDXL 실행 가능 여부가 갈린다.
6. 상용 라이선스 정책은 어떤가? diffusion 기반 teacher를 제안 전용으로라도 허용할지.
7. 테스트 캐릭터: 명조 공식 MMD는 README 약관대로 비공개 기술 테스트에만 쓴다. 게임 빌드용 자체 캐릭터는 언제 들어오는가?
8. 아웃라인 방식은 inverted hull + tangent 노멀인가, UTS식 UV/컬러 채널인가? 노멀 파이프라인 설계가 이것에 달려 있다.