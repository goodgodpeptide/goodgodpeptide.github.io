# 체중관리 매니저 — Claude 작업 컨텍스트

## 프로젝트 개요
- **URL**: https://goodgodpeptide.github.io
- **Repo**: https://github.com/goodgodpeptide/goodgodpeptide.github.io
- **구조**: 단일 파일 앱 — `index.html` 한 파일에 HTML + CSS + JS 전부 포함
- **배포**: GitHub Pages (main 브랜치 push → 자동 배포, 보통 1-2분 내)

---

## 기술 스택
- **인증**: Firebase Auth (Google OAuth, Popup → Redirect fallback)
- **DB**: Firestore (`users/{uid}` 단일 문서, setDoc 전체 덮어쓰기)
- **Firebase 프로젝트**: `goodgodpeptide` (Seoul region)
- **JS**: Vanilla ES Modules (번들러 없음, CDN import map)
- **그래프**: Canvas 2D API 직접 구현 (외부 차트 라이브러리 없음)
- **폰트**: Noto Sans KR, JetBrains Mono (Google Fonts CDN)

---

## 앱 구조 (탭 기준)

| 탭 | panel id | 주요 기능 |
|---|---|---|
| 💉 투약 | `panel-peptide` | 약물 잔류량 PK 모델, 원터치 투약, 농도 그래프, 부작용 기록 |
| ⚖️ 체중 | `panel-weight` | 체중 기록 추가, 추이 그래프, 목표 달성률 |
| 💊 영양제 | `panel-supple` | 시간대별 영양제 체크, 수분 트래커 |
| 📅 달력 | `panel-calendar` | 월간 뷰, 날짜별 투약·체중·영양제 기록 확인 및 추가 |
| 📊 분석 | `panel-analysis` | BMR/TDEE/체지방률/이상체중 계산, 목표 달성 예측 |
| 🧮 계산 | `panel-calc` | 조제계산, 체성분 역산, 미래 예측, 영양소 배분 |

---

## 약물 설정 (DRUG_CONFIG)

```js
"마운자로 (Tirzepatide)": { halfLifeDays: 5, tmaxHours: 24, defaultDoseDays: 7 }
"레타 (Retatrutide)":     { halfLifeDays: 6, tmaxHours: 48, defaultDoseDays: 7 }
"위고비 (Semaglutide)":   { halfLifeDays: 7, tmaxHours: 36, defaultDoseDays: 7 }
```

- **PK 모델**: 1-compartment oral absorption
  - `ka = ln2 / tmaxHours`, `ke = ln2 / (halfLifeDays × 24)`
  - `C(t) = dose × (ka/(ka-ke)) × (e^(-ke·t) - e^(-ka·t))` — 피크 기준 정규화
- **isOverride 기록**: 단순 반감기만 적용 (PK 흡수 모델 미적용)

---

## 데이터 구조 (Firestore: `users/{uid}`)

```js
appData = {
  records: [
    { id: number, drug: string, dose: number, time: number(UTC ms), site?: string, isOverride?: boolean }
  ],
  weightRecords: [
    { id: number, weight: number, time: number(UTC ms) }
  ],
  supplements: [
    { id: string, name: string, timing: string[], times: {아침:"08:00",...}, taken: {"YYYY-MM-DD_아침": true} }
  ],
  sideEffects: [
    { id: number, drug: string, symptoms: string[], note: string, time: number(UTC ms) }
  ],
  waterLog: [
    { id: number, ml: number, time: number(UTC ms) }
  ],
  drugCycle: { "마운자로 (Tirzepatide)": 7, ... },  // 사용자 커스텀 주기
  gender: "남성" | "여성",
  height: string,
  targetWeight: string,
  age: string,
  activity: string  // "1.2" ~ "1.9"
}
```

---

## 핵심 함수 / 컨벤션

### 시간 처리 (중요)
```js
kstInputToMs(val)   // datetime-local input → UTC ms (KST로 해석)
msToKstInput(ms)    // UTC ms → datetime-local input value (KST 표시)
toKSTString(ts)     // UTC ms → 한국어 표시 문자열
kstNow()            // 현재 시각 → KST input value
```
- **규칙**: 저장은 항상 UTC ms, 표시는 항상 KST
- `new Date()` 직접 쓰지 말고 위 헬퍼 사용

### 저장
```js
scheduleSave()  // 800ms debounce → saveData() → setDoc(users/{uid}, appData)
```
- Firestore는 전체 문서 덮어쓰기 방식 (partial update 없음)
- 데이터 변경 후 반드시 `scheduleSave()` 호출

### 렌더링
```js
renderAll()  // 모든 탭 전체 재렌더 (데이터 변경 후 일반적으로 사용)
// 개별 렌더 함수: renderRemainingCards, renderPeptideGraph, renderWeightGraph,
//               renderWeightStats, renderWeightList, renderPeptideList,
//               renderSideEffectList, renderSupplementPanel, renderWaterTracker
```

### 약물명 마이그레이션
```js
const DRUG_NAME_MIGRATION = {
  "터제파타이드": "마운자로 (Tirzepatide)",
  "레타트루타이드": "레타 (Retatrutide)",
  "세마글루타이드": "위고비 (Semaglutide)",
  "마운자로 (티제파타이드)": "마운자로 (Tirzepatide)",
  // ... (구버전 이름 → 현재 이름)
}
```
- `loadData()` 시 `migrateData()` 자동 적용

---

## UI / 스타일 규칙
- **다크모드 기본**, 라이트모드 토글 가능 (`body.light-mode` 클래스)
- 테마 저장: `localStorage("theme")`
- 색상: 마운자로 `#60a5fa` / 레타 `#f87171` / 위고비 `#4ade80`
- 모달: `.modal-overlay` + `.modal-box` 패턴
- 터치 인터렉션: `touch-action: none` + passive:false 이벤트
- 그래프 DPR 대응: `canvas.width = offsetWidth × devicePixelRatio`

---

## 인앱 브라우저 처리
- 카카오톡, 인스타그램 등 감지 → `#inapp-notice` 표시
- `isInAppBrowser()` 함수로 판별
- Chrome/Samsung/Safari 정상 브라우저는 절대 차단 안 함

---

## 현재 알려진 이슈 / TODO
- [ ] (다음 작업 내용을 여기에 기록)

---

## 작업 방식 선호도
- **전체 파일 교체**: 구조적 변경, 대규모 기능 추가
- **스니펫 + 라인 번호**: 소규모 버그픽스, 스타일 수정
- 변경 이유 한 줄 설명 포함
- 한국어로 소통
