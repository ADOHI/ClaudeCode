# 기술 리서치 — 절차 생성 학원도시의 "밀도 · 의도 · 발견"

> 대상: 3D 서브컬쳐 오픈월드, 절차 생성 맵 + 규칙 기반 디테일 레벨 디자인
> 기준일: 2026-10-16. 확인하지 못한 내용은 **(미확인)** 으로 표시했다. 출처는 문서 끝에 번호로 정리했다.

---

## 0. 문제 정의

절차 생성 도시가 실패하는 전형적인 방식은 세 가지다.

| 실패 | 증상 | 이 프로젝트의 대응 |
|---|---|---|
| **밀도 실패** | 넓지만 비어 있다. 같은 블록이 반복된다 | 메인 동선 위에서 *시간 기준* 공백을 측정하고 메운다 (§7, `intent.rhythm`) |
| **의도 실패** | 무엇이 왜 거기 있는지 설명되지 않는다 | 모든 배치물에 `rule` + `why`를 남긴다. 분석 필드가 근거다 |
| **발견 실패** | 숨겨진 것이 없거나, 숨겨진 것을 찾을 단서가 없다 | 아이소비스트로 숨김도를 계산하고, 동선 이탈점에 미끼와 흔적을 둔다 |

핵심 설계 결정: **"생성"과 "레벨 디자인"을 분리한다.** 도시 골격(도로·블록·건물)은 절차 생성이 만들고, 플레이 경험(볼거리 리듬, 숨김 보상, 루트, 자물쇠/열쇠)은 생성된 공간을 *분석한 결과*를 근거로 규칙이 배치한다. Spider-Man 팀이 겪은 문제, 곧 지형이 바뀌면 손으로 놓은 사건이 깨지는 문제[22–24]를 피하려는 구조다. 의도 레이어는 매번 분석부터 다시 하므로 지형이 바뀌어도 스스로 다시 맞춰진다.

---

## 1. 도시 골격: 가로망

| 기법 | 핵심 | 장점 | 한계 |
|---|---|---|---|
| L-system + 전역 목표/국소 제약 (Parish & Müller 2001)[1] | 인구 밀도 등 이미지 맵을 전역 목표로 삼아 도로를 성장시킨다. CityEngine의 출발점 | 거대 도시에 강하다 | 디자이너가 형태를 직접 통제하기 어렵다 |
| **텐서장 가로 모델링 (Chen et al. 2008)**[2] | 격자·방사 같은 기저장을 블렌딩한 텐서장의 주/부 고유벡터를 따라 유선을 추적한다 | 구역마다 '도시 문법'을 다르게 주면서도 이음새가 부드럽다. 디자이너가 장을 직접 편집할 수 있다 | 끝점 연결과 교차점 처리를 따로 구현해야 한다 |
| 에이전트 기반 (Lechner et al.)[3] | 토지 이용 에이전트가 시뮬레이션으로 성장한다 | 그럴듯한 혼합 용도 | 조향이 어렵다 |
| 예제 기반 (Aliaga 2008, Nishida 2016)[4][5] | 예시 패치와 통계를 재사용한다 | 시그니처 거리(상점가, 계단 골목)를 재현하기 좋다 | 예시 제작 비용이 든다 |
| 학습 기반 (2022–2026) | OSM 기반 트랜스포머[6], InfiniCity[7], GlobalMapper[8], CityDreamer[9], CityCraft[10], UrbanWorld[11], CityX[12], CityDreamer4D[13], Yo'City(CVPR 2026)[14] | 다양성과 실사감 | 대부분 포토리얼/뉴럴 렌더링이 목표라 **게임플레이 의미(통행, 시야, 은신)가 없다** |

**채택: 텐서장.** 학원도시는 *계획도시*라서 구역마다 가로 문법이 달라야 한다. 중앙은 방사형, 상점가는 중앙탑을 향한 격자, 구시가지는 노이즈 회전으로 비틀린 골목이 된다. 텐서장은 이 차이를 기저장 하나로 표현하고 경계는 블러로 자연스럽게 잇는다. 해안선과 하천의 접선장을 경계장으로 더하면 해안·강변 도로가 저절로 생긴다(Chen의 boundary field). 학습 기반 모델은 지금 단계에서는 **기저장의 사전분포(prior)** 로 쓰는 것이 맞다. 형상을 바로 출하하는 데는 쓰지 않는다 (§8).

구현 메모 (`src/core/roads.js`)
- 위계: 간선(dsep 105–128m) → 학원 진입대로 → 해안 등거리선 도로 → 생활가로(구역별 dsep 38–58m) → 블록 관통 골목.
- 균일 간격 시딩(Jobard–Lefer 방식): 이미 그린 선 위의 점을 다른 family의 시드로, 수직 오프셋 점을 같은 family의 시드로 큐에 넣는다. **새 길은 항상 기존 길에서 출발하므로 연결성이 보장된다.**
- 끝점 처리(Chen): 같은 family 선에 가까워져 멈춘 끝점은 진행 방향으로 연장해 다른 선에 잇는다. 끝내 잇지 못한 끝점은 **막다른 길로 기록**하고, 의도 레이어가 보상 대상으로 쓴다.
- 교량 규칙: 간선이 50m 이하의 수면을 만날 때만 다리를 놓는다. 다리는 자연스럽게 Lynch의 Node가 된다.

---

## 2. 필지와 매싱

- **Vanegas et al. 2012**[15]: OBB 분할과 직선 골격(straight skeleton) 띠 분할 두 모드를 제공하고, 편집해도 필지의 정체성이 유지된다. 2024년 후속 연구는 필지와 가로를 함께 생성한다[16].
- **CGA shape grammar (Müller et al. 2006)**[17]: 매스 → 파사드 → 창호로 내려가는 규칙 언어. 게임에서는 **게임플레이 훅(사다리, 옥상 출입, 자판기)을 종단 기호로 둔다**는 점이 핵심이다. UE PCG에는 5.5부터 grammar 노드가 있다(2차 출처)[28].

**채택: 둘레형(perimeter) 분할 + 규칙 표 기반 매싱.**
블록을 가로 방향 OBB로 보고, 외곽에는 접도 필지를 두르고 **안쪽은 안뜰로 남긴다.** 안뜰로 통하는 3.5m 통로를 하나 끼워 넣으면 그 통로가 자물쇠/열쇠 규칙이 노리는 '최협점'이 된다. 블록 분할을 숨은 공간 설계와 같은 연산으로 처리하는 것이 이 구조의 요점이다. (`src/core/blocks.js`)

매싱 문법(`src/core/buildings.js`): box / podium+tower / stepped / ㄱ자 slab / broken(폐건물). 옥상 문법은 구역별로 다르다. 주거는 물탱크와 실외기, 상업은 광고판, 테크는 안테나와 태양광, 학교는 **옥상 펜스**(학원물의 상징 공간)를 둔다. 파사드 규칙은 접도면에만 차양·간판·출입구를, 골목면에만 실외기·낙서를 붙인다.

---

## 3. 산업 파이프라인에서 가져온 원칙

| 사례 | 가져온 원칙 | 적용 |
|---|---|---|
| Horizon Zero Dawn, GPU 절차 배치 (van Muijden, GDC 2017)[18] | **결정론적이고 국소적으로 안정적인** 배치. 밀도 맵 하나로 바위와 사운드, 생물까지 놓는다 | `RNG.fork(label)` 단계별 독립 스트림, 필지 RNG는 좌표 해시로 분기 (한 블록을 바꿔도 다른 블록이 흔들리지 않음) |
| Far Cry 5 (Carrier, GDC 2018)[19] | Houdini 도구를 매일 지형 변경에 맞춰 다시 실행 | 전체 파이프라인을 헤드리스로 재실행 (`tools/headless.mjs`) |
| Ghost of Tsushima (Pohlmann; Hamilton, GDC 2021)[20][21] | GPU 바이트코드 배치 규칙, **UI 없이 섬이 플레이어를 안내** | 랜드마크 비스타, 흔적, 방향 표지판 |
| Marvel's Spider-Man 1/2 (Santiago, Ruskin, Halperin)[22–24] | 도로·건물이 바뀌면 사건 배치를 **명세로 재검증**하고 아니면 플래그 | 의도 레이어 전체가 분석 → 배치 재실행, 지표로 검증 |
| Matrix Awakens / City Sample[25][26] → 2026 업데이트[28] | Houdini 도시 → UE 5.8의 PCG 그래프 + shape grammar + Unreal MCP 기반 LLM 보조 저작 | JSON 내보내기 스키마를 PCG 포인트 데이터로 읽을 수 있게 설계 |
| UE5 PCG[29][30][31] | 5.7 정식(production-ready), GPU 실행, 5.8에서 **재생성해도 유지되는 수동 편집** | "절차 생성 기반 + 디자이너 덧칠" 워크플로의 엔진 측 해법 |
| Townscaper (Stålberg)[33][34] | 불규칙 쿼드 그리드 + 모서리 기반 WFC | 구시가지 확장 후보 (§8) |

Unity: Unite 2024에서 Terrain을 대체할 레이어/마스크 기반 월드빌딩 시스템이 예고됐다[32]. 2025–2026 출시 상태는 **(미확인)**.

---

## 4. WFC · Model Synthesis · 제약 기반 배치

- WFC (Gumin 2016)[35]와 Model Synthesis (Merrell 2007/2021)[36]는 같은 계열이다. Model Synthesis는 블록 단위로 수정하므로 큰 출력에 강하다. 2023년 그래프 문법 버전은 격자에 묶이지 않는다[37].
- ASP 기반 PCG (Smith & Mateas 2011)[38], LLM이 관계 제약을 쓰고 솔버가 배치하는 방식 (Holodeck, CVPR 2024[39]; Xu & Verbrugge 2025[40]).

**결론: WFC는 국소 규칙만 보장한다.** 연결성, 도달 가능성, 랜드마크 시선 같은 **전역 속성은 상위 레이어(그래프/텐서장)가 먼저 고정해야 한다.** 이 프로젝트는 전역 속성을 분석 필드와 지표로 다루고, 국소 디테일만 규칙으로 처리한다. WFC는 골목 드레싱이나 옥상 잡동사니 같은 *내부* 디테일에 쓰는 것이 적절하다.

---

## 5. 레벨 디자인 이론: 의도와 탐험

### 5.1 Lynch, 『도시의 이미지』(1960)[41]
사람이 도시를 기억하는 다섯 요소인 Paths, Edges, Districts, Nodes, Landmarks를 **생성기의 레이어 하나하나로** 만들었다.

| 요소 | 생성기 구현 |
|---|---|
| Paths | 간선 / 생활가로 / 골목 / 진입대로 위계 |
| Edges | 해안선, 하천, 캠퍼스 담장, 모노레일 고가 |
| Districts | 왜곡 가중 보로노이 + 구역별 가로 문법·용도표·옥상 문법·색 |
| Nodes | 간선 교차 광장, 역, 다리, 캠퍼스 정문 |
| Landmarks | 전역(센트럴 스파이어) + 구역별(관람차, 시계탑, 미완의 타워, 등대, 세계수, 학원 시계탑) |

### 5.2 Disney "Weenie"[42]와 비스타 종결
멀리서 끌어당기는 시각적 자석이다. **구역 랜드마크는 '도로 시선축 길이의 제곱합'이 최대인 필지**에 세운다 (`chooseLandmarkSites`). 긴 직선 도로 끝에 랜드마크가 서서, 길을 걸으면 늘 그 랜드마크를 보게 된다.

### 5.3 젤다 BotW 필드 레벨 디자인 (CEDEC 2017)
흔히 GDC 2017 발표로 인용되지만, 필드 디자인 강연은 **CEDEC 2017(8/31), 후지바야시 히데마로·요네즈 마코토**의 발표다[44]. 키워드는 **인력(引力)** 과 **지형**이다. **삼각형 규칙**은 삼각형 지형이 '넘을까 돌아갈까'라는 선택을 만들고 그 뒤를 가린다는 원리다. 초기의 탑·직선 구조는 플레이테스트에서 레일처럼 느껴졌고, 수정 후 히트맵에서 동선이 퍼졌다. 특정 '밀도 맵'의 존재는 **(미확인)**.

도시판 번역:
- **삼각형 = 중층 블록, 고가, 담장.** 숨김 보상은 메인 동선 관찰자의 아이소비스트에서 보이지 않는 곳에만 놓인다. 모퉁이를 돌아야 보인다.
- **인력 = 미끼.** 동선을 벗어나는 지점(이탈점)에 고양이·도깨비불·스프레이 화살표 같은 **동선에서 보이는** 미끼를 두고, 그 뒤로 흔적을 잇는다.

### 5.4 Dormans: 미션/공간 그래프 문법, 사이클 생성[45][46]
- 공원 산책로는 MST에 순환 간선을 더해 만든다. 막다른 산책이 없다.
- 컨테이너 미로는 백트래커로 만든 뒤 브레이드(막다른 칸 30% 뚫기)를 한다. 사이클이 있어야 좌절이 줄어든다.
- 자물쇠/열쇠는 문(최협점)과 열쇠(같은 구역, 보행 60–220m)를 두어 *지역 안의 짧은 미션 그래프*를 만든다. 생성 세계 속 퀘스트 구조는 Ashmore & Nitsche[47]를 참고했다.

### 5.5 Space syntax와 아이소비스트[48–51]
- Hillier & Hanson의 통합도/선택도(choice) → **보행 흐름 = 거점 쌍 최단경로 누적(근사 매개중심성)**.
- Benedikt의 아이소비스트 → **숨김도 = 1 − (메인 동선 관찰자 중 이 셀을 보는 수 / 7)**.
- Splinter Cell 분석(Martin 2014)은 '보이는 것과 갈 수 있는 것의 차이'를 지표로 썼다 → **"보이지만 닿지 않는" 티저**: 옥상 루트의 보상은 거리에서 보이는 지붕 가장자리에 둔다.
- Minecraft 아이소비스트 측정치가 사람의 평가와 상관한다는 결과(Hervé et al. 2022)는 이 필드를 품질 지표로 쓸 근거가 된다.

---

## 6. 탐색 기반 PCG, 품질 다양성, ML/LLM

- 탐색 기반 PCG 분류 (Togelius et al. 2011)[53]: 이 프로젝트는 **생성-검증(generate & test) + 수리(repair)** 구조다. 리듬 규칙이 공백을 '수리'한다.
- MAP-Elites (Mouret & Clune 2015)[54], 품질 다양성 PCG (Gravina et al. 2019)[55]: `tools/seed-search.mjs`가 *도로 밀도 × 숨김 공간 비율* 2축 아카이브에서 칸마다 최고 점수 시드를 보관한다. 디자이너는 성격이 다른 유효한 도시들을 팔레트처럼 고른다.
- PCGML (Summerville et al. 2018)[56]은 데이터 부족이 핵심 난제라고 본다. 최근 서베이[57][58], MarioGPT[59], PCG Benchmark(FDG 2025: 품질·다양성·제어성)[60], 탐험 에이전트로 레벨을 평가하는 연구[61]가 있다.
- Genie 3 / Project Genie (DeepMind)[62]는 몇 분 수준의 일관성만 유지한다. **레벨 파이프라인으로는 아직 이르다.**

**정리: LLM은 기하가 아니라 제약과 규칙을 쓰는 데 쓴다.** 이 프로젝트의 규칙 표(`config.js`의 `DISTRICT_TYPES`, `ZONING`, `RULES`)가 LLM이 생성·수정할 대상이다.

---

## 7. 밀도와 페이싱: 숫자의 출처

| 주장 | 출처 | 신뢰도 |
|---|---|---|
| Witcher 3 "40초 규칙": 약 40초마다 집중할 무언가를 보여준다 | Bartosz Ochman, Noclip 다큐(2017)[63] | 개발자 발언. 공개된 측정법은 없다 |
| Ghost of Tsushima: "10초마다는 아니지만 3분마다여서도 안 된다" | Jason Connell[64] | 정성적 범위 |
| AC Shadows: "50m마다 POI"는 지양 | [65] | 반대 방향의 사례 |
| "30–60초마다 무언가" | — | **통설. 1차 출처를 찾지 못함** |

**채택: 거리 대신 시간으로 측정한다.** 걷기·달리기·파쿠르·모노레일로 이동 속도가 다르기 때문이다. 기본값은 *메인 동선 위 어느 지점에서도 달리기(6 m/s) 8초 = 48m 이내에 볼거리*다 (`PACING` in `intent.js`). 밀집 도시이므로 야생 오픈월드보다 훨씬 짧게 잡았다. 이 값은 **플레이테스트로 보정할 파라미터**이고, 정답으로 정해 둔 값이 아니다. '보였다(아이소비스트 진입)'와 '도달했다'는 따로 기록해야 한다는 제안[63–66 정리]을 반영해, 지표에 랜드마크 *가시율*을 별도 항목으로 두었다.

---

## 8. 현대적 · 미래적 확장 로드맵

| 단계 | 내용 | 근거 |
|---|---|---|
| 지금 (구현됨) | 텐서장 + 둘레형 필지 + 분석 기반 의도 레이어 + 지표 + MAP-Elites 시드 탐색 + 엔진 독립 JSON | §1–7 |
| 단기 | 분석 패스(아이소비스트, 흐름)를 **WebGPU/Compute**로 이전 → 1m 해상도, 높이 고려 3D 가시성 | HZD GPU 배치[18], UE PCG GPU[29] |
| 단기 | UE 5.7+/5.8 PCG 그래프에서 JSON을 포인트로 읽어 모듈 메시 스폰. 수동 편집 유지 기능과 결합 | [28][30][31] |
| 중기 | **탐험 봇**으로 시간 기준 페이싱 측정: '처음 보인 시각'과 '도달 시각' 로그 → 리듬 규칙의 목표값을 데이터로 보정 | [61], §7 |
| 중기 | 학습 기반 레이아웃 모델(확산/트랜스포머)을 **텐서장 기저의 사전분포**로 사용. 형상은 여전히 규칙이 만든다 | [6][10][14] |
| 중기 | LLM이 규칙 표와 관계 제약을 작성 → 솔버/생성기가 실행 → 지표로 검증하는 루프 | [39][40], UE MCP[28] |
| 장기 | 구시가지에 불규칙 그리드 + WFC 모듈 (Townscaper식) | [33][34][36] |

---

## 참고문헌

1. Parish & Müller, "Procedural Modeling of Cities," SIGGRAPH 2001. https://history.siggraph.org/?p=116923
2. Chen, Esch, Wonka, Müller, Zhang, "Interactive Procedural Street Modeling," SIGGRAPH 2008. https://www.sci.utah.edu/~chengu/street_sig08/street_project.htm
3. Lechner et al., "Procedural City Modeling" (연도 미확인). https://ccl.northwestern.edu/testsite/rp/cities/papers/midgraph.cities.pdf
4. Aliaga, Vanegas, Beneš, "Interactive Example-Based Urban Layout Synthesis," SIGGRAPH Asia 2008.
5. Nishida, Garcia-Dorado, Aliaga, "Example-Driven Procedural Urban Roads," CGF 2016.
6. Birsak et al., "Large-Scale Auto-Regressive Modeling of Street Networks," 2022. https://arxiv.org/abs/2209.00281
7. Lin et al., "InfiniCity," ICCV 2023. https://arxiv.org/abs/2301.09637
8. He & Aliaga, "GlobalMapper," ICCV 2023. https://arxiv.org/abs/2307.09693
9. Xie et al., "CityDreamer," CVPR 2024. https://arxiv.org/abs/2309.00610
10. "CityCraft," 2024. https://arxiv.org/abs/2406.04983
11. Shang et al., "UrbanWorld," 2024. https://arxiv.org/abs/2407.11965
12. Zhang et al., "CityX," 2024. https://arxiv.org/abs/2407.17572
13. Xie et al., "CityDreamer4D," 2025. https://arxiv.org/abs/2501.08983
14. Lu et al., "Yo'City," CVPR 2026. https://arxiv.org/abs/2511.18734
15. Vanegas et al., "Procedural Generation of Parcels in Urban Modeling," EG 2012.
16. Chen, Song, Ortner, "Hierarchical Co-generation of Parcels and Streets," CGF 2024.
17. Müller et al., "Procedural Modeling of Buildings," SIGGRAPH 2006.
18. van Muijden, "GPU-Based Procedural Placement in Horizon Zero Dawn," GDC 2017. https://www.guerrilla-games.com/read/gpu-based-procedural-placement-in-horizon-zero-dawn
19. Carrier, "Procedural World Generation of Far Cry 5," GDC 2018. https://gdcvault.com/play/1025557
20. Pohlmann, "Samurai Landscapes," GDC 2021. https://gdcvault.com/play/1027352
21. Hamilton, "Exploration in Ghost of Tsushima," GDC 2021. https://www.gdcvault.com/play/1027399
22. Santiago; Ruskin, Marvel's Spider-Man 발표, GDC 2019.
23. Santiago, "Procedural Tool Development for Marvel's Spider-Man 2," GDC 2024.
24. Halperin, "Marvel's Spider-Man 2: 10 Years of Procedural Content Creation," GDC 2024.
25. SideFX, "The Matrix Awakens: Generating a World." https://www.sidefx.com/learn/talks/the-matrix-awakens-generating-a-world/
26. Epic, City Sample Houdini quick start.
28. Epic, "City Sample gets a major update with PCG and Unreal MCP workflows," 2026. https://www.unrealengine.com/learning/city-sample-gets-a-major-update-with-pcg-and-unreal-mcp-workflows
29. Epic, "Unreal Engine 5.7 is now available." https://www.unrealengine.com/news/unreal-engine-5-7-is-now-available
30. Epic, "Unreal Engine 5.8 is now available." https://www.unrealengine.com/news/unreal-engine-5-8-is-now-available
31. Epic, PCG Biome Core 개요 문서.
32. Unity, "Worldbuilding Update (Q3 2024)."
33. "How Townscaper Works," Game Developer.
34. Stålberg, "Wave Function Collapse in Bad North," EPC 2018.
35. Gumin, WaveFunctionCollapse, 2016. https://github.com/mxgmn/WaveFunctionCollapse
36. Merrell, Model Synthesis (2007) / "Comparing Model Synthesis and WFC" (2021). https://paulmerrell.org/model-synthesis/
37. Merrell, "Example-Based Procedural Modeling Using Graph Grammars," SIGGRAPH 2023.
38. Smith & Mateas, "ASP for PCG," 2011.
39. Yang et al., "Holodeck," CVPR 2024. https://arxiv.org/abs/2312.09067
40. Xu & Verbrugge, FDG 2025 / arXiv 2025. https://arxiv.org/abs/2508.18533
41. Lynch, *The Image of the City*, MIT Press, 1960.
42. "What is a Wienie?" TouringPlans.
43. Fujibayashi, Takizawa, Dohta, "Change and Constant," GDC 2017. https://gdcvault.com/play/1024562
44. CEDEC 2017 BotW 필드 레벨 디자인 보도 (Famitsu 외). https://www.famitsu.com/news/201708/31140870.html
45. Dormans, "Adventures in Level Design," PCG Workshop 2010.
46. Boris the Brave, "Dungeon Generation in Unexplored," 2021. https://www.boristhebrave.com/2021/04/10/dungeon-generation-in-unexplored/
47. Ashmore & Nitsche, "The Quest in a Generated World," DiGRA 2007.
48. Hillier & Hanson, *The Social Logic of Space*, 1984.
49. Benedikt, "To Take Hold of Space: Isovists and Isovist Fields," 1979. https://doi.org/10.1068/b060047
50. Martin, Splinter Cell 공간 분석, *Entertainment Computing* 2014.
51. Hervé et al., "Automated Isovist Computation for Minecraft," 2022. https://arxiv.org/abs/2204.03752
53. Togelius et al., "Search-based PCG: A Taxonomy and Survey," 2011.
54. Mouret & Clune, MAP-Elites, 2015. https://arxiv.org/abs/1504.04909
55. Gravina et al., "PCG through Quality Diversity," 2019. https://arxiv.org/abs/1907.04053
56. Summerville et al., PCGML, 2018. https://arxiv.org/abs/1702.00539
57. Farrokhi Maleki & Zhao, AIIDE 2024.
58. Gallotta et al., "LLMs and Games: A Survey and Roadmap," 2024. https://arxiv.org/abs/2402.18659
59. Sudhakaran et al., "MarioGPT," NeurIPS 2023.
60. Khalifa et al., "The PCG Benchmark," FDG 2025. https://arxiv.org/abs/2503.21474
61. Khaleque, Cook, Gow, 2024. https://arxiv.org/abs/2409.02632
62. Genie 3 보도 (The Decoder).
63. TweakTown, Witcher 3 "40-second rule," 2017.
64. Game Informer, "More Than Just Dots on a Map," 2021.
65. GamingBolt, AC Shadows "not every 50 meters."
66. GameDev.net, Outer Worlds 2 POI 발표.

(번호 27, 52는 원 조사 목록에서 쓰이지 않거나 벤치마크 게임 출시 정보라 생략)
