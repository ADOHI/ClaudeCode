# Bust Morph Lab

스타일라이즈드(애니풍) 성인 여성 캐릭터의 바스트 형태 모프를 **블렌드 셰이프로 굽는 방법론**을 검증하는 Three.js 프로토타입입니다.
최종 파이프라인은 **Blender 셰이프 키 → FBX → Unity 블렌드 셰이프**이며, 여기서는 그 앞단의 알고리즘과 검증 도구를 다룹니다.

> 상태: 진행 중인 프로토타입. 변형 커널은 교체 가능한 구조이며, 현재 베이스라인은 Regularized Kelvinlets(2017)입니다.
> 최신 기법 리서치 결과에 따라 커널과 레이어 구성이 바뀔 수 있습니다.

## 구조

```
web/
  src/core/        엔진 비의존 순수 JS (Blender/Unity 포팅 대상)
    field.js       바인드 공간 변형 필드: 컴팩트 C2 윈도 × 브러시 합, 중앙선 분할/잠금
    kelvinlet.js   Regularized Kelvinlets (grab/scale, tri-scale 국소화, 완전 텐서형)
    bake.js        정점별 위치/노멀 델타 굽기 (노멀은 F^-T 해석적 변환)
    validate.js    단사성 det(I+J)>0, 이음새 일치, 삼각형 뒤집힘, 노멀 정확도
    autofit.js     높이맵 래스터화 + erosion으로 가슴 정점 자동 탐지
    runtime.js     본 없는 지글(감쇠 스프링 + squash&stretch), 팔 들기 포즈 보정
  src/viewer/      three.js 뷰어 (VRM/GLB/FBX 로드, 슬라이더, 히트맵, 검증 HUD)
  test/            불변식 단위 테스트 (node --test)
  scripts/         테스트 모델 다운로드, 헤드리스 스크린샷
```

## 실행

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

## 테스트 모델 라이선스

모델 파일은 저장소에 포함하지 않습니다. `npm run fetch-model`이 다음을 받습니다.
- Seed-san — [VRM Public License 1.0](https://vrm.dev/en/licenses/1.0/), VirtualCast, Inc. (가슴이 평평해서 의상/끈/이음새 테스트용)
- Michelle — three.js examples에 포함된 Mixamo 캐릭터
