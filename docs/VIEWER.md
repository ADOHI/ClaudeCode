# 뷰어 통합 (2026-10-18)

## 실행과 검증

Node 22 이상에서 저장소의 `web/`을 작업 폴더로 사용합니다.

```powershell
npm ci
npm run fetch-model
npx playwright install chromium
npm test
npm run test:viewer
npm run build
npm run dev
```

`test:viewer`는 자체 Vite 서버를 127.0.0.1:5178에서 실행하고 종료 시 정리합니다.
기본값은 Michelle.glb와 Seed-san.vrm입니다. 실제로 모델을 로드한 뒤 params 전환,
잘못된 입력 거부, 캐릭터 프로필, VRM 팔 본 덮어쓰기와 포즈, 전용 지글 셰이프,
250 ms 프레임, 형태계측 HUD를 검사합니다. `.cache/viewer-check/`에 스크린샷과 JSON
결과를 남깁니다. 파일을 내려받는 `fetch-model` 단계와 테스트 단계는 별개입니다.

직접 보유한 PMX 배포본은 텍스처를 포함한 원래 폴더 구조로
`web/public/models/<캐릭터>/`에 놓습니다. 예시:

```powershell
npm run test:viewer -- --model /models/Changli/Changli.pmx --out .cache/changli-check
```

이 경로는 예시입니다. 실제 PMX 파일명에 맞춰 바꿔야 합니다.
원본 모델, 텍스처, teacher 결과와 렌더는 git에 넣지 않습니다.

## 필드 결과 불러오기와 A/B

`Params / character → load params JSON…`으로 Python distill/profile-fit이 출력한
일반 params 객체를 불러옵니다. 뷰어의 `export params JSON`이 출력한
`{format:"bust-morph-params/1", params: {...}}`도 읽습니다. JSON 한 개를 드롭해도 됩니다.

불러오기 전에 길이·윈도·필수 타깃·brush 벡터/행렬·parity를 검사합니다. 잘못된 입력은
활성 params를 바꾸지 않습니다. 런타임의 linear/parity brush도 허용합니다.
슬라이더가 참조하는 일곱 표준 타깃을 모두 포함해야 합니다.

파일명별로 preset이 생기고 `Hand tuned`와 전환할 수 있습니다. 각 슬롯의 편집값을
보존합니다. 불러온 결과의 anchor/window는 그대로 사용하며 자동 맞춤으로 덮어쓰지
않습니다. 다른 캐릭터에 맞춘 필드를 적용할 때는 직접 anchor를 맞추거나 다시 피팅해야
합니다. JSON 안의 sliders/dynamics/pose는 필드 불러오기로 변경하지 않습니다.

## 형태계측

HUD는 250 ms 간격으로 현재 블렌드 가중치를 반영한 **바인드 공간 형상**을 측정합니다.
같은 가중치의 결과는 캐시합니다. 자세와 중력으로 움직인 월드 좌표를 측정하지 않습니다.

- `outer`: 피부와 착의 표면, 얼굴·머리카락·장신구 등 기본 제외
- `skin`: 이름이 skin/body인 머티리얼 또는 프로필에서 지정한 피부
- `all`: 프로필의 제외 영역과 본 마스크를 제외한 표면

프로필의 명시적 역할은 이름 휴리스틱보다 우선합니다. `skin`에 선택된 삼각형이 없으면
다른 표면을 피부처럼 측정하지 않고 결측/경고를 표시합니다. 옷 아래 피부가 없거나
곡면이 평평하고 열린 경우에는 일부 값이 결측일 수 있습니다. 거리 점수는 유효한 지표만
사용합니다. anime 대역은 아직 미검증 가설입니다.

## 캐릭터 프로필

`load character profile…` 또는 JSON 드롭으로 다음 형식을 읽습니다.
아래 본/메시/머티리얼 이름은 형식 예시이며 실제 모델에 맞춰 바꿔야 합니다.

```json
{
  "format": "bust-character-profile/1",
  "name": "My adult character",
  "bones": {"chest": "Chest", "leftUpperArm": "UpperArm.L"},
  "materials": [
    {"material": "Body", "role": "skin"},
    {"material": "Top", "role": "garment", "tier": 0, "thickness": 0.005},
    {"mesh": "Accessories", "material": "Metal", "role": "exclude"}
  ],
  "region": {
    "anchor": {"x": 0.24, "y": 0.05, "z": 0.2},
    "depth": 0.2,
    "window": {"x": 0.32, "yUp": 0.44, "yDown": 0.42}
  }
}
```

본 매핑의 키는 hips/chest/neck/head/leftUpperArm/rightUpperArm/leftLowerArm/
rightLowerArm이며, 값은 완전 일치하는 본 이름입니다. 존재하지 않는 본은 오류로 처리합니다.

본 매핑은 자동 탐지 결과를 덮어씁니다. VRM의 기존 humanoid 본 이름을 명시해도
정규화 본을 통해 포즈를 구동하므로 `vrm.update()`가 팔 동작을 덮어쓰지 않습니다.
`region`은 S 단위이며 생략한 값은 현재 필드에서 유지합니다.

머티리얼 이름은 완전 일치입니다. `mesh`가 있으면 해당 메시만, 없으면 같은 이름의
머티리얼 전체에 적용합니다. 메시별 지정이 우선합니다. `exclude` 전용 정점은 베이크
마스크를 0으로 만듭니다. 허용/제외 재질이 공유하는 정점은 허용해 경계가 찢어지는 것을
피합니다. `tier`와 `thickness`는 후속 의상 도구를 위한 메타데이터입니다. 현재는
공유 필드 전송(Tier 0)이며 Tier 1 브리징/접촉 솔버를 실행하지 않습니다.

## 런타임과 현재 한계

뷰어는 기본 일곱 타깃에 `withRuntimeTargets`의 17개 전용 타깃을 더해 베이크합니다.
`BustDynamics.update`에는 실제 dt와 현재 흉부 위치/회전 축을 전달하고, `bustWeights`로
슬라이더·포즈·동역학 가중치를 합칩니다. 전용 타깃은 음수 가중치도 사용합니다.
모델/필드 변경 시 동역학을 초기화합니다. 계측은 이 전용 셰이프까지 반영합니다.

진동은 여전히 pseudo-mode입니다. FEM `modes.npz`를 브라우저에서 직접 읽는 기능이나
실제 FEM 모드 셰이프 증류는 이번 통합에 포함되지 않습니다. UI의 validation은 슬라이더
영역 검사이며 모든 동적 상태의 충돌 보증이 아닙니다. `combinationCheck`는 별도 오프라인
분석 API입니다. 자세한 수식과 이식 규칙은 [METHOD.md](METHOD.md)를 참고합니다.

검증 결과: JS 72개 통과, Python bustfield/teacher 101개 통과·6개 모델 데이터 부재로
생략, morpho 14개 통과·1개 생략. 기본 공개 모델 2개 브라우저 검사와 production build 통과.
이 수치는 명조 모델별 품질 또는 미완성 의상/스타일화 패키지의 합격을 뜻하지 않습니다.
