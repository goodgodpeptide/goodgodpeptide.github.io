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
| 💉 투약 | `panel-peptide` | 약물 잔류량 PK 모델, 원터치 투약, 농도 그래프, 부작용 기록, 조제 계산 |
| ⚖️ 체중 | `panel-weight` | 서브탭 3개: 기록/그래프, 🏋️ 인바디, 📊 분석 |
| 💊 영양제 | `panel-supple` | 시간대별 영양제 체크, 수분 트래커, 영양소 배분 |
| 📅 달력 | `panel-calendar` | 월간 뷰, 날짜별 투약·체중·영양제 기록 확인 및 추가 |
| 🔬 백과사전 | `panel-encyclopedia` | 76개 펩타이드 DB, 검색/필터, 상세 모달 (pep-pedia 스타일) |

### 체중 탭 서브탭 구조
| 서브탭 | id | 내용 |
|---|---|---|
| ⚖️ 기록/그래프 | `wtab-record` | 체중 기록 추가, 추이 그래프 (X축=첫 투약일~현재) |
| 🏋️ 인바디 | `wtab-inbody` | 인바디 기록 추가·목록·골격근량/체지방 추이 그래프 |
| 📊 분석 | `wtab-analysis` | BMR/TDEE/체지방률/이상체중, 체성분역산, 미래예측 |

---

## 접근 제어 / 관리자 시스템

### 인증 흐름
1. Google OAuth 로그인 (`signInWithPopup` → `signInWithRedirect` fallback)
2. `config/approved_users` Firestore 문서에 이메일이 있어야 앱 진입 가능
3. 없으면 `#pending-screen` (승인 대기 화면) 표시

### Firestore 구조
```
config/approved_users  → { emails: ["user@gmail.com", ...] }
config/admins          → { emails: ["admin@gmail.com", ...] }  // 관리자 목록
config/rejected_users  → { "email@gmail.com": rejectedAtMs, ... }  // 거절 타임스탬프
login_logs/            → 모든 로그인 시도 기록 (승인 여부 무관하게 항상 기록)
```

### 거절 동작 방식
- 거절 시 `config/rejected_users`에 `{ email: Date.now() }` 저장
- 거절 이후 재로그인하면 대기 목록에 다시 표시 (재신청 가능, 영구 차단 아님)
- 대기 목록: `lastLoginTime > rejectedAtMs` 이면 재표시

### 관리자 패널 (`#admin-modal`)
- 상단 바 👑 버튼 → `openAdminPanel()` 호출 (관리자만 표시)
- **대기 중**: login_logs에서 미승인 이메일 추출 → 승인/거절 버튼
- **승인됨 (일반)**: approved_users 목록 (관리자 제외) → 취소 버튼
- **관리자 계정**: admins 목록 → 추가/제거 가능, 본인 삭제 불가
- 관리자 추가 시 approved_users에도 자동 등록됨

### 관련 함수
```js
openAdminPanel()       // 패널 열기 + 목록 렌더
approveUser(email)     // approved_users에 arrayUnion
revokeUser(email)      // approved_users에 arrayRemove
addAdmin(email)        // admins + approved_users에 arrayUnion
removeAdmin(email)     // admins에서 arrayRemove (본인 불가)
```

### 최초 seed
- `config/admins` 문서가 없을 때 `kingshotgoodgod1@gmail.com` 첫 로그인 시 자동 생성
- `config/approved_users` 문서도 같은 방식으로 자동 생성

### 인증 방식 결정
- 구글 OAuth + 관리자 승인으로 확정
- 이메일/비밀번호 방식 추가 불필요 (복잡도 대비 이점 없음)

---

## 백업 / 복원

- 상단 바 💾 버튼 → `openBackupModal()`
- **내보내기**: `exportBackup()` → `backup_YYYYMMDD.json` 다운로드
- **불러오기**: `loadBackupFile(event)` → JSON 파싱 → 경고 확인 후 `confirmRestore()`
- 복원 시 `appData` 전체 덮어쓰기 → `scheduleSave()` → `renderAll()`
- 계정 변경 시 데이터 이전 용도로 활용

---

## 약물 설정 (DRUG_CONFIG)

```js
// GLP-1 / 아밀린 (파라미터: FDA 라벨 / 임상논문 기반)
"마운자로 (Tirzepatide)":         { halfLifeDays: 5,     tmaxHours: 8,    defaultDoseDays: 7,  encyclopediaId: "tirzepatide" }   // FDA NDA215866
"레타 (Retatrutide)":             { halfLifeDays: 6,     tmaxHours: 24,   defaultDoseDays: 7,  encyclopediaId: "retatrutide" }   // NEJM 2023 Phase2
"위고비 (Semaglutide)":           { halfLifeDays: 7,     tmaxHours: 24,   defaultDoseDays: 7,  encyclopediaId: "semaglutide" }   // FDA Ozempic 라벨
"카그릴린타이드 (Cagrilintide)":   { halfLifeDays: 7,     tmaxHours: 24,   defaultDoseDays: 7,  encyclopediaId: "cagrilintide" }  // Lau 2021 Phase1b
// 복합/재생
"KLOW (GHK-Cu+TB500+BPC157+KPV)": { halfLifeDays: 0.2,  tmaxHours: 1.5,  defaultDoseDays: 1,  encyclopediaId: "klow" }
"에피탈론 (Epithalon)":            { halfLifeDays: 0.125,tmaxHours: 1,    defaultDoseDays: 1,  encyclopediaId: "epitalon" }
"티모신알파1 (Thymosin α1)":       { halfLifeDays: 0.083,tmaxHours: 2,    defaultDoseDays: 3,  encyclopediaId: "thymosin-alpha-1" } // Goldstein 1981, Zadaxin 라벨
"GHK-Cu (구리펩타이드)":           { halfLifeDays: 0.083,tmaxHours: 1,    defaultDoseDays: 1,  encyclopediaId: "ghk-cu" }
// 뇌/인지
"세맥스 (Semax)":                  { halfLifeDays: 0.021,tmaxHours: 0.25, defaultDoseDays: 1,  encyclopediaId: "semax" }
"셀랑크 (Selank)":                 { halfLifeDays: 0.021,tmaxHours: 0.25, defaultDoseDays: 1,  encyclopediaId: "selank" }
// GH 축
"CJC-1295+Ipamorelin":            { halfLifeDays: 0.083,tmaxHours: 0.5,  defaultDoseDays: 1,  encyclopediaId: "cjc-ipa-protocol" }
"테사모렐린 (Tesamorelin)":        { halfLifeDays: 0.005,tmaxHours: 0.15, defaultDoseDays: 1,  encyclopediaId: "tesamorelin" }    // FDA NDA022505 (t½~7min, Tmax~9min)
// 미토콘드리아
"SS-31 (Elamipretide)":           { halfLifeDays: 0.083,tmaxHours: 0.5,  defaultDoseDays: 1,  encyclopediaId: "ss-31" }
"MOTS-c":                         { halfLifeDays: 0.125,tmaxHours: 1,    defaultDoseDays: 3,  encyclopediaId: "mots-c" }
"NAD+":                           { halfLifeDays: 0.083,tmaxHours: 0.5,  defaultDoseDays: 3,  encyclopediaId: "nad-plus" }
```
- **단기 반감기**: fractional halfLifeDays 사용 (세맥스 0.021일 = ~30분). PK 계산은 시간 단위라 수학적으로 정상 동작
- **encyclopediaId**: peptides_v3.json의 slug ID. 투약 카드 📖 버튼으로 직접 모달 연동

- **PK 모델**: 1-compartment oral absorption
  - `ke = ln2 / (halfLifeDays × 24)`
  - `ka = computeKa(ke, tmaxHours)` — Newton-Raphson 수치풀이로 모델이 정확히 tmaxHours에서 피크가 되도록 ka 계산
    - 풀이: `ln(u)/(u-1) = tmaxHours × ke`, `u = ka/ke`
    - 기존 `ka = ln2/tmaxHours` 공식은 실제 피크 시간이 tmaxHours와 달라지는 버그 있었음 (수정됨)
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
    { id: string, name: string, timing: string[], times: {아침:"08:00",...}, taken: {"YYYY-MM-DD_아침": true},
      stock?: { remaining: number, perDose: number } }  // 재고: 남은 정수, 회당 소모량
  ],
  sideEffects: [
    { id: number, drug: string, symptoms: string[], note: string, time: number(UTC ms) }
  ],
  waterLog: [
    { id: number, ml: number, time: number(UTC ms) }
  ],
  drugCycle: { "마운자로 (Tirzepatide)": 7, ... },  // 사용자 커스텀 주기
  activeDrugs: ["마운자로 (Tirzepatide)", ...],     // 표시할 약물 목록 (없으면 전체)
  inbodyRecords: [
    { id: number, time: UTC ms, weight: number, sm: number, bfm: number,
      bfp: number, vfl: number, bmr: number }
    // sm=골격근량, bfm=체지방량, bfp=체지방률%, vfl=내장지방레벨, bmr=기기측정BMR
  ],
  gender: "남성" | "여성",
  height: string,
  targetWeight: string,
  age: string,
  activity: string,  // "1.2" ~ "1.9"
  costCalc: {        // 비용 계산기 설정 (저장됨)
    currency: string,          // 구매 가격 통화
    price: string,             // 구매 가격
    intervalDays: string,      // 투여 간격 (일)
    purchaseUnit: string,      // 'vial'|'kit'
    vialsPerKit: string,
    shipping: string,          // 배송비 금액
    shippingCurrency: string,  // 배송비 통화
    syringe: string,           // 주사기 가격
    syringeCurrency: string,
    syringeQty: string,        // 박스당 개수
    bac: string,               // BAC Water 박스/묶음 가격
    bacCurrency: string,
    bacQty: string,            // 박스당 BAC 바이알 수
    swab: string,              // 알코올솜 가격
    swabCurrency: string,
    swabQty: string,           // 박스당 개수
    customConsumables: [{ id, label, price, currency, qty }]  // 기타 소모품
  }
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
renderActiveDrugToggles()  // 사용 약물 토글 버튼 재렌더 (renderRemainingCards 내부에서 자동 호출)
renderInbodyPanel()        // 인바디 목록 + 그래프 렌더 (switchWeightTab('inbody') 시 호출)
renderInbodyGraph()        // 인바디 캔버스 그래프 (골격근량↑ #60a5fa / 체지방량↓ #f87171)
```

### 체중 탭 서브탭 전환
```js
switchWeightTab(tab)  // 'record' | 'inbody' | 'analysis'
// - record  → renderWeightGraph() + initWeightTouch()
// - inbody  → renderInbodyPanel()
// - analysis → renderAnalysis()
```
- `.wtab-btn` 버튼 클래스, `.wtab-panel` 패널 클래스, `currentWeightSubTab` 변수

### 그래프 X축 범위
- **체중 그래프 전체 뷰**: X 시작 = 첫 투약일 (투약 기록 없으면 첫 체중 기록일)
- **약물 농도 그래프 전체 뷰**: X 끝 = 마지막 투약 + 5×반감기 (약물 소실 시점)

### 실시간 업데이트 (투약 탭)
```js
startLiveUpdate()   // 1초 interval 시작 (switchTab('peptide') 및 renderAll() 에서 자동 호출)
stopLiveUpdate()    // interval 정지 (다른 탭 전환 시 자동)
_tickLiveUpdate()   // 매초: 농도 수치/D-day/진행바 DOM 직접 업데이트 + renderPeptideGraph()
```
- 라이브 업데이트 요소: `#live-rem-{short}`, `#live-dday-{short}`, `#live-bar-{short}`, `#live-nextconc-{short}`
- `cfg.short` 키 사용 (모든 DRUG_CONFIG 약물) — 입력창 포커스/값은 건드리지 않음

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

## 커뮤니티 탭 (panel-community)

### Firestore 구조
```
user_profiles/{uid}  → { nickname, email, updatedAt }   // 닉네임 공개 프로필
posts/{postId}       → { uid, nickname, content, time, likes: [uid...] }
posts/{postId}/comments/{commentId} → { uid, nickname, content, time }
```

### 핵심 함수
```js
loadCommunity()          // 탭 전환 시 호출 → renderCommunityTab() + onSnapshot 리스닝
renderCommunityTab()     // 패널 전체 재렌더 (글쓰기폼 + post-list)
renderPostList(posts)    // 글 목록 렌더
loadComments(postId)     // 댓글 로드 (getDocs, 댓글창 펼칠 때 호출)
toggleComments(postId)   // 댓글창 토글
submitPost()             // 글 작성 → Firestore addDoc
submitComment(postId)    // 댓글 작성
toggleLike(postId)       // 좋아요 arrayUnion/arrayRemove
deletePost(postId, uid)  // 글 삭제 (본인 or 관리자)
deleteComment(...)       // 댓글 삭제
openNicknameModal()      // 닉네임 설정 모달 열기
saveNickname()           // user_profiles + appData.nickname 저장
```

### 닉네임 시스템
- `appData.nickname` — 자기 Firestore doc에 저장 (loadData/scheduleSave 연동)
- `user_profiles/{uid}` — 공개용 (이메일 + 닉네임, 관리자 패널에서 참조)
- 관리자 패널 승인/관리자 목록에 닉네임 표시 (미설정 시 "닉네임 미설정")
- 관리자는 글/댓글에 uid 앞 6자 표시

### 상태 변수
```js
let communityUnsubscribe = null;  // onSnapshot cleanup 함수
let currentUserIsAdmin = false;   // auth listener에서 설정
```

### Firebase 임포트 추가분
`deleteDoc, onSnapshot, query, orderBy, limit`

---

## 백과사전 탭 (panel-encyclopedia)

### 데이터 파일
- **`peptides_v3.json`** — 76개 펩타이드, v3.0 포맷 (2026-04-06 pep-pedia API 전량 보완)
  - 소스: `parse_peptides_v3.py` (pep-pedia.org 스크래핑 텍스트 파싱) + pep-pedia.org/api/peptides
  - 원본: `C:/Users/JuneK/Downloads/peptides.txt` (4.3MB)

### JSON v3.0 구조
```js
{
  version: "3.0",
  totalCount: 72,
  index: [{ id, nameEn, nameKo, subtitle, routes, researchStatus, isApproved, tags, typicalDose, cycle }],
  peptides: {
    "slug-id": {
      id, nameEn, nameKo, subtitle,
      routes: string[],           // ["Oral","Injectable"]
      researchStatus: string,     // "Extensively Studied"|"Well Researched"|"Emerging Research"|"Limited Research"
      isApproved: boolean,
      typicalDose: string,
      frequency: string,
      cycle: string,
      storage: string,            // "실온"|"냉장 (2-8°C)"|"냉동 (-20°C)"
      routeDetail: string,
      descriptionEn: string,      // "What is X?" 설명
      keyBenefits: string,
      mechanism: string,
      pharmacokinetics: { peak, halfLife, cleared },
      researchIndications: [{ name, effectiveness, level }],
      protocols: [{ goal, dose, frequency, route }],
      protocolTiming: string,
      interactions: [{ name, type, description }],  // type: "Synergistic"|"Compatible"|"Monitor Combination"|... (pep-pedia API로 description 추가)
      researchIndicationsDetailed: { [catKey]: [{title, description}] },  // 카테고리별 상세 (pep-pedia API)
      latestResearch: [{ title, excerpt, date, source, link }],           // 참고 연구 (doi 링크)
      relatedSlugs: string[],          // 관련 펩타이드 slug 목록
      safetyNotes: string[],           // 안전주의사항
      stopSigns: string[],             // 중단 신호
      reconstitute: string[],
      qualityGood: string[],
      qualityBad: string[],
      effectsTimeline: string[],
      sideEffects: string[],
      quickStart: { dose, frequency, howToTake, bestTiming, effectsTimeline, breakBetween, cycleLength, storageNote },
      tags: string[],
      sourceUrl: string
    }
  }
}
```

### 백과사전 핵심 함수
```js
loadEncyclopedia()         // 탭 전환 시 peptides_v3.json fetch
renderEncyclopedia()       // 검색/정렬/필터 후 카드 목록 렌더
setEncFilter(btn, status)  // 연구 상태별 필터
openEncyclopediaModal(id)  // 상세 정보 바텀시트 모달
```

### CSS 클래스
- `.enc-filter-btn` / `.enc-filter-btn.active` — 필터 버튼
- `.enc-section` / `.enc-section-title` — 모달 내 섹션 구분

### ENC_STATUS 매핑
```js
'Extensively Studied' → 광범위 연구 (#4ade80)
'Well Researched'     → 충분한 연구 (#60a5fa)
'Clinical Research'   → 임상 연구   (#a78bfa)
'Emerging Research'   → 신흥 연구   (#fbbf24)
'Limited Research'    → 제한적 연구 (#94a3b8)
```

---

## 투여 경로 (Route of Administration)

```js
const ADMIN_ROUTES = [
  { id: 'SC', label: '피하주사', emoji: '💉', color: '#60a5fa' },
  { id: 'IM', label: '근육주사', emoji: '💪', color: '#f87171' },
  { id: 'IN', label: '비강',    emoji: '👃', color: '#a78bfa' },
  { id: 'PO', label: '경구',    emoji: '💊', color: '#4ade80' },
  { id: 'IV', label: '정맥',    emoji: '🩸', color: '#fbbf24' },
];
```
- DRUG_CONFIG에 `defaultRoute` 필드: 세맥스/셀랑크 → IN, 나머지 → SC
- records에 `route` 필드 저장
- 투약 추가 모달에 경로 선택 버튼 행 (`renderRouteSelector()`, `selectRoute()`)
- 투약 목록 경로 뱃지: `routeInfo.id`(SC) 대신 `routeInfo.label`(피하주사) 표시

---

## 사이클 스케줄 시스템

```js
appData.drugSchedules = {
  "약물명": {
    type: 'daily'|'interval'|'weekdays'|'cycle'|'course',
    intervalDays: 7,          // interval
    weekdays: [0,2,4],        // weekdays (0=일요일)
    onDays: 5, offDays: 2,    // cycle
    courseDays: 30, restDays: 30, startDate: timestamp  // course
  }
}
appData.suppSchedules = { "suppId": { ...same } }
```

핵심 함수:
```js
isDrugDueOnDate(drug, dateStr)       // 약물 투약 예정일 판단 (주기 기반, records 참조)
shouldTakeOnDate(schedule, dateStr)  // 영양제 스케줄 복용 여부 (schedule 객체 직접)
getScheduledItemsForDate(dateStr)    // 날짜별 예정 항목 목록
openDrugScheduleModal(drug)          // 약물 스케줄 설정 모달
openSuppScheduleModal(suppId)        // 영양제 스케줄 설정 모달
```

---

## 조제 재고 / 약 재고

```js
appData.reconVials = [{
  id, drug, vialMg, waterMl, doseMg, reconDate, injDone, notes
}]
// totalInj = floor(vialMg*1000/doseMg), remaining = totalInj - injDone
// 소진예상일 = reconDate + remaining * intervalDays * 86400000

appData.inventory = [{
  id, drug, unit('vial'|'kit'|'정'|'ml'|'기타'),
  vialsPerUnit, mgPerVial, quantity, purchaseDate, notes
}]
// 남은mg = quantity × (kit?vialsPerUnit:1) × mgPerVial
```

핵심 함수:
```js
renderReconSection()     // 조제 재고 섹션 렌더 (injDone은 records에서 자동 계산)
openReconModal(drug)     // 새 조제 기록 모달
openEditReconModal(id)   // 조제 기록 수정 모달
deleteRecon(id)          // 조제 기록 삭제
renderInventorySection() // 약 재고 섹션 렌더
openInventoryModal()     // 새 재고 추가 모달
adjustInventory(id,delta)
// 영양제 재고
updateSuppStock(sup, nowChecked)  // 체크/해제 시 stock.remaining 차감/복원
openSuppStockModal(id)            // 영양제 입고(재고 추가) 모달
submitSuppStock(id)               // 입고 저장
// 기록 수정
openEditRecordModal(id)   // 투약 기록 수정 모달 (add-modal 재활용, pre-fill)
openEditWeightModal(id)   // 체중 기록 수정 모달 (weight-modal 재활용, pre-fill)
```

---

## 달력 체크리스트

```js
appData.calendarChecks = {
  "YYYY-MM-DD": { "약물명": true, "suppId_타이밍": true }
}
```

- `getDateIndicator(dateStr)` → ✅(전체완료) / ⚠️(일부누락) / 🔵(예정있음)
- 달력 날짜 셀에 인디케이터 표시 + 하단 범례 (색상 도트 설명 포함)
- 날짜 모달에 "📋 오늘 할 일" 체크리스트 (실제 records 있으면 자동 체크)
- `toggleCalendarCheck(dateStr, key)` → appData.calendarChecks 저장

### 약물 예정일 계산 (`isDrugDueOnDate`)
```js
isDrugDueOnDate(drug, dateStr)  // 해당 날짜가 약물 투약 예정일인지 판단
```
- `daily` 스케줄: 항상 true
- `weekdays` 스케줄: 요일 매칭
- `cycle/course` 스케줄: startDate 기준 주기 계산
- **`interval` 또는 스케줄 없음**: 마지막 투약 기록 + `intervalDays`(또는 `defaultDoseDays`) 기준으로 계산
  - 투약 기록 없으면 `false` (달력에 미표시)
  - `diff % intervalDays === 0` 인 날만 예정일로 표시
- `shouldTakeOnDate`는 영양제 스케줄 판단용으로 계속 사용

---

## 비용 계산기 (개선됨)

- 투여 빈도: "X일에 한번" (`cost-interval`, 기본 7일)
- 구매 단위: 바이알/키트 (`setCostUnit()`, `cost-vials-per-kit`)
- 배송비: 금액 + **통화 선택** (`cost-shipping` + `cost-shipping-currency`)
- 소모품별 **통화 선택** + **박스당 개수** 입력 → `가격 ÷ 개수 = 회당 자동 계산`
  - 주사기: `cost-syringe` + `cost-syringe-currency` + `cost-syringe-qty`
  - BAC Water: `cost-bac` + `cost-bac-currency` (바이알당 총비용, 회당 자동배분)
  - 알코올 솜: `cost-swab` + `cost-swab-currency` + `cost-swab-qty`
  - 기타 소모품: `appData.costCalc.customConsumables[]` 동적 추가/삭제
- 계산: 총비용 = 구매가(환산KRW) + 배송비(환산KRW), 바이알당 = 총비용/(키트면 바이알수), 회당 = 바이알당/injPerVial + 소모품합계

### 기타 소모품 (`customConsumables`)
```js
appData.costCalc.customConsumables = [
  { id: string, label: string, price: number, currency: string, qty: number }
]
```
- `addCustomConsumable()`: `prompt()`로 이름 입력 → 배열에 추가
- `removeCustomConsumable(id)`: 배열에서 제거
- `renderCustomConsumables()`: `#custom-consumables` div 재렌더

---

## ⚠️ 데이터 안전 규칙 (CRITICAL — 반드시 준수)
- **saveData() 직접 호출 금지**: 항상 `scheduleSave()` 경유. 단, nickname 저장은 `updateDoc({nickname})` 부분 업데이트만 사용
- **닉네임 저장**: `saveNickname()`은 `updateDoc(users/{uid}, {nickname})` 으로만 — `scheduleSave()` 절대 금지
- **자동 팝업 금지**: 로그인 후 자동으로 모달/팝업 띄우는 기능 추가 금지 (auth 이중 실행 시 데이터 덮어쓰기 위험)
- **saveData 빈 데이터 가드**: `records + weightRecords = 0`이고 Firestore에 기존 데이터 있으면 저장 차단
- **localStorage 자동백업**: `saveData()` 성공 시 `localStorage["goodgod_backup_{uid}"]`에 동시 저장
- **복구 UI**: 💾 백업 모달에 UID 표시 + UID 직접 입력 복구 기능

## 현재 알려진 이슈 / TODO
- [ ] 백과사전 카드 약어 아이콘 개선 (현재 slug에서 자동 생성)
- [ ] 운동 탭 추가 예정
- [ ] Firestore 보안 규칙 업데이트 (posts, user_profiles 컬렉션 추가됨)
- ✅ 백과사전 상호작용 뱃지 한국어 변환 (Synergistic→시너지, Compatible→호환, Monitor Combination→주의 필요, Avoid Combination→병용 금지)
- ✅ 펩타이드 전량 typicalDose 보완 (32개 누락 → 전량 채움)
- ✅ 펩타이드 전량 protocols 보완 (66개 누락 → 76개 전량 채움, 한국어)
- ✅ 그래프 핀치줌 튐 버그 수정 (getFullRange() 공식 불일치 → _graphFullRange 공유 변수로 통일)
- ✅ 그래프 핀치줌 피벗포인트 수정 (두 손가락 중간점 기준 줌, ratio 방향 수정 — 반감기 짧은 펩타이드 이퀄라이저 버그 해결)
- ✅ 펩타이드 4개 신규 추가 (72→76개): GHRP-6 / Bromantane / Cardiogen / PNC-27 (pep-pedia.org 기준)
- ✅ 백과사전 모달 전면 개선 (pep-pedia.org 수준 UI): 연구결과 카테고리별 아코디언 + effectiveness 배지(한국어) / 상호작용 설명 아코디언 / 부작용 3탭(부작용·안전주의·중단신호) / 참고연구 카드+링크 / 관련 펩타이드 그리드
- ✅ peptides_v3.json pep-pedia API 전량 보완: interactions 설명 / researchIndicationsDetailed / latestResearch / relatedSlugs / safetyNotes / stopSigns / sideEffects 71개 실데이터 교체
- ✅ 참고연구 링크 클릭 수정 (a href → window.open onclick, 모바일 터치 이슈)
- ✅ 연구결과 effectiveness 배지 복원 (researchIndications ↔ researchIndicationsDetailed 카테고리 매핑)
- ✅ 초기 로딩 속도 개선: preconnect 3개(fonts.googleapis/gstatic/www.gstatic) + Firebase modulepreload 3개 + Noto Sans KR 300(미사용) 제거
- ✅ Auth 초기화 병렬화: approved_users+admins getDoc → Promise.all 동시 실행 / login_logs await 제거(fire-and-forget) / setPersistence 명시 호출
- ✅ 투약 이력 바 차트 추가: 메인 그래프 아래 별도 캔버스(dose-history-chart), 실투여량 바 시각화, x축·zoom·pan 자동 싱크, 숨기기/보기 토글
- ✅ 투약 이력 차트 UX 개선: 레이블 겹침 → ctx.measureText 실제 너비 기준 2-pass 렌더 / 캔버스 높이 90px·상단 패딩 16px 확보 / 약물별 총 투여량 합계 헤더 표시
- ✅ 투약 이력 차트 독립 줌/팬: initDoseHistoryTouch() 추가 — 핀치줌·드래그·휠, graphZoom 공유로 메인 그래프와 양방향 완전 연동
- ✅ Firebase API 키 도메인 제한 (goodgodpeptide.github.io/* + goodgodpeptide.firebaseapp.com/* 허용 — GCP Console HTTP referrers 설정, firebaseapp.com 누락 시 Auth 리다이렉트 오류 발생)
- ✅ PK 모델 ka 수식 근본 수정: `ka=ln2/tmaxHours` → `computeKa()` Newton-Raphson 풀이 (모델이 정확히 tmaxHours에서 피크)
- ✅ DRUG_CONFIG 파라미터 논문/FDA 라벨 기반 업데이트 (마운자로 tmax 8hr, 레타/위고비/카그릴 tmax 24hr, 티모신알파1 halfLife 2hr, 테사모렐린 halfLife 7min/tmax 9min)
- ✅ 백업 모달 스크롤 수정 (max-height:85vh + overflow-y:auto) + 뒤로가기 지원 추가
- ✅ 설정 드롭다운 테마 버튼 '다크 / 라이트' → '다크 모드'/'라이트 모드' 명확하게 수정
- ✅ 다약제 그래프 농도 점선 레이블 % + mg 동시 표시 (다크/라이트 색상 분기)
- ✅ 그래프 툴팁 다약제 뷰에서 % + mg 동시 표시 (└ X.XXXmg 서브라인)
- ✅ 그래프 캔버스 하단 % 기준 안내 박스 추가 (다약제 뷰 시만 표시, 라이트/다크 색상 분기)
- ✅ 달력 D-day 약물 커스텀 주기 버그 수정 (isDrugDueOnDate: cfg.defaultDoseDays → getDoseCycle(drug))
- ✅ 탭 새로고침 시 마지막 탭 유지 (localStorage "lastTab" 저장/복원)
- ✅ 동적 생성 모달 뒤로가기 지원 — sched/supp-sched/add-supp/supp-stock/inventory/recon 6종 (closeTopModal + MutationObserver body childList)
- ✅ saveData 빈 데이터 가드 + localStorage 자동백업 + 복구 UID 입력 UI
- ✅ 닉네임 저장 버그 수정: scheduleSave() → updateDoc({nickname}) 부분 업데이트
- ✅ 로그인 자동 닉네임 팝업 제거 (데이터 손실 원인)
- ✅ 거절 사용자 재표시 버그: rejectUser updateDoc→setDoc+merge (이메일 점(.) 경로 해석 버그)
- ✅ 관리자 패널 뒤로가기 지원 (admin-modal / nickname-modal MutationObserver 추가)
- ✅ 뒤로가기 키 → 모달 닫기 (History API, popstate, MutationObserver)
- ✅ 탑바 구글 아바타 → 닉네임 아바타 버튼 (첫글자+색상 원, 클릭으로 닉네임 변경)
- ✅ 체중 서브탭 이모지 제거 + 탑바 줄바꿈 방지 (white-space:nowrap, flex-shrink:0)
- ✅ 탑바 타이틀 이모지 제거 + 클릭 시 투약 탭 이동
- ✅ 거절 사용자 시간 비교 버그: Date.now()→serverTimestamp() (클라이언트/서버 시간 차이)
- ✅ 커뮤니티 탭 추가 (글/댓글/좋아요 + 닉네임 시스템, Firestore posts/user_profiles)
- ✅ 탭 바 클린 리디자인 (이모지 제거, 텍스트만, 세로 구분선, overflow-x 스크롤)
- ✅ 그래프 현재 농도 실시간 도트 추가 (현재 시각선 × 약물 곡선 교차점, 3겹 글로우)
- ✅ 그래프 D-day 레이블 KST 날짜 기준 수정 (renderPeptideGraph 내 calDiff)
- ✅ 체중 목표 달성률 시각화 개선 (두꺼운 진행바 + 25/50/75% 마커 + 현재 위치 도트, 분석탭 여정 진행바 + 달성% 대형 표시)
- ✅ 달력 과거 날짜 ⚠️ 과다 표시 수정 (getScheduledItemsForDate — 첫 기록 이전 날짜 예정 표시 제외)
- ✅ D-day 달력 기준 계산 수정 (24시간 단위 → KST 날짜 기준 calDiff, renderRemainingCards + _tickLiveUpdate 두 곳)
- ✅ 관리자 패널 거절/취소 후 목록 안 사라지는 버그 (Firestore 캐시 불일치 → DOM 직접 제거, _removeAdminListRow)
- ✅ 달력 체크리스트 약물 주기 버그 수정 (isDrugDueOnDate — 마지막 투약일 기준 계산)
- ✅ 투약 목록 경로 뱃지 한국어 표시 (SC→피하주사, IM→근육주사, IN→비강)
- ✅ 달력 하단 범례 추가 (✅⚠️🔵 인디케이터 + 도트 색상 설명)
- ✅ 영양제 추가 모달 개편 (아침/점심/저녁 버튼 제거 → 시간 직접 입력, timeToTiming() 자동 분류)
- ✅ 비용 계산기: 소모품 박스 단위 UI (박스 가격 + 박스당 개수 → 회당 비용 자동 계산 + hint 표시)
- ✅ 투여 경로 시스템 (ADMIN_ROUTES, defaultRoute, 모달 선택, 뱃지 표시)
- ✅ 사이클 스케줄 (5종: daily/interval/weekdays/cycle/course)
- ✅ 달력 영양제 체크리스트 ↔ 영양제탭 통일 (toggleCalendarCheck → supplements[].taken 직접 저장)
- ✅ 달력 체크리스트 연동 (인디케이터 + 오늘 할 일 + calendarChecks)
- ✅ 조제 재고 계산 버그 수정 (totalInj: vialMg*1000/doseMg → vialMg/doseMg, 단위 mg 통일)
- ✅ 조제 재고 수정/삭제 버튼 추가 (openEditReconModal, deleteRecon)
- ✅ 조제 모달 1회 용량 단위 mg 명시 + 실시간 횟수 미리보기
- ✅ 달력 조제 재고 예상 소진일 연동 (주황 마름모 도트 + 날짜 상세 섹션 + 범례)
- ✅ 달력 월간 요약 카드 클릭 → 상세 목록 모달 (투약/체중/영양제)
- ✅ 약물 구매 비용 박스/키트 UI 통합 (바이알1개 ↔ 박스/키트 토글, 바이알당 hint)
- ✅ BAC Water 소모품 비용 박스/묶음 단위 추가 (bacQty, 바이알당·회당 hint)
- ✅ 조제 재고 관리 (reconVials, 투약기록 자동연동, 소진 예상일)
- ✅ 달력 투약/체중 기록 수정(✏️) 버튼 추가 — openEditRecordModal/openEditWeightModal 연동
- ✅ 달력 삭제 confirm → customConfirm 전역 등록으로 교체 (window.customConfirm)
- ✅ 달력 기록추가 메뉴에 "➕ 영양제 새로 추가" 버튼 추가 (openAddSuppModal 연동)
- ✅ 달력 cal-supp-modal에 "+ 영양제 추가" 버튼 추가
- ✅ 달력 calAddDrug(): 약물 드롭다운 innerHTML 누락 버그 수정 + 최근용량 자동채우기
- ✅ 관리자 패널 거절/취소 confirm → customConfirm 커스텀 모달로 교체 (클릭 충돌 방지)
- ✅ 투약 카드 📊 버튼 추가 → jumpToGraph(drug): 필터 적용 + 그래프 스크롤 + 하이라이트
- ✅ 영양제 추가 모달 ✕/시간변경 버튼 버그 수정 (window.removeSuppTime, window.updateSuppTime 전역 등록)
- ✅ 투약 기록 수정 기능 (openEditRecordModal — 약물/용량/시간/투여경로 pre-fill)
- ✅ 체중 기록 수정 기능 (openEditWeightModal — 체중/시간 pre-fill)
- ✅ 달력 양방향 편집 — 날짜 상세에서 투약/체중 기록 삭제 버튼 (record id 연동)
- ✅ 영양제 재고 관리 (s.stock.remaining/perDose, 입고 모달, 체크 시 자동 차감)
- ✅ 달력 영양제 소진 예상일 (청록 마름모 도트 #22d3ee + 날짜 상세 섹션)
- ✅ 조제 재고 injDone 자동 계산 — records에서 reconDate 이후 비-override 기록 수 계산
- ✅ 약 재고 관리 (inventory, 키트 단위, 14일 경고)
- ✅ 영양제 상세 스케줄 + 코스 진행 상태
- ✅ 비용 계산기 개선 (X일에 한번, 키트, 배송비)
- ✅ 펩타이드 15종 DRUG_CONFIG 추가 (GLP-1 3+카그릴 / KLOW / 에피탈론 / Tα1 / GHK-Cu / 세맥스 / 셀랑크 / CJC+Ipa / 테사모렐린 / SS-31 / MOTS-c / NAD+)
- ✅ 다약제 동시 그래프 정규화 (0-100%) — NAD+ 1000mg vs Tirzepatide 15mg 혼합 표시 해결
- ✅ 투약 카드 SC 표시 → 피하주사 한국어 표시 (renderRemainingCards 부가정보행 ri.label)
- ✅ 조제 재고 새 조제 버튼: drug null 가드 + 모달 내 약물 선택 드롭다운으로 개선
- ✅ 사용 약물 목록 접기/펼치기 (toggleDrugListPanel, drugListExpanded, 요약 표시)
- ✅ 투약 카드 📖 버튼 → 백과사전 직접 연동 (encyclopediaId 필드)
- ✅ 백과사전 모달 라이트모드 색상 대응 (C 색상 객체 분기)
- ✅ 날짜 표기 버그 수정 (toKSTString.slice → msToKstInput.slice)
- ✅ 비용 계산기 추가 (Frankfurter 환율 API, 5개 통화, 소모품 포함)
- ✅ 투약 추가 모달 약물 드롭다운 DRUG_CONFIG 동적 생성
- ✅ 투약 목록 필터 바 동적 렌더링 (기록 있는 약물만)
- ✅ 한국어 번역: 크롬 번역 기능으로 해결 (별도 구현 불필요)
- ✅ 관리자 승인 기반 접근 제어 구현 완료
- ✅ 다중 관리자 계정 관리 (config/admins) 구현 완료
- ✅ 백업/복원 기능 구현 완료
- ✅ 라이트모드 색상 전면 수정 (모달/화면/동적 목록 모두 대응)
- ✅ 투약 탭 사용 약물 토글 (activeDrugs) + 1초 실시간 농도/그래프 업데이트
- ✅ 탭 7개→5개 통합 (분석+계산 제거, 체중 서브탭 3개, 인바디 신규)
- ✅ 체중 그래프 X축 = 첫 투약일 시작 / 약물 그래프 X축 끝 = 5×반감기 소실 시점
- ✅ 체중 그래프 음수 X 좌표 버그 수정
- ✅ D-day 표시 불일치 수정 (Math.floor 통일)

### 약물 그래프 Y축 스케일
- **단독 약물 뷰**: Y축 = max(실제 데이터 피크, clinicalMax) 절대값(mg)
- **다약제 동시 뷰** (`curves.length > 1`): **정규화 모드** — 각 약물을 `val/clinicalMax` (0~100%) 로 표시
  - 이유: NAD+(1000mg)와 Tirzepatide(15mg)를 함께 표시 시 스케일 차이 문제 해결
  - Y축 레이블: 0%/25%/50%/75%/100%
  - 현재 농도 점선 레이블: `${short} XX.X%`
- `plotRatio(val, clinicalMax)` 함수로 분기 처리

### 투약 탭 핵심 함수 추가분
```js
renderPeptideFilterBar()     // 기록 있는 약물만 필터 버튼 동적 생성
openEncyclopediaFromCard(id) // 투약 카드 📖 버튼 → 백과사전 모달 (탭 전환 없이)
fetchFxRates(force?)         // Frankfurter API 환율 fetch (1시간 캐시)
calcCost()                   // 비용 계산기 렌더 (구매가 + 소모품 → 회/일/주/월 비용)
saveCostSettings()           // appData.costCalc 저장
loadCostSettings()           // 저장된 설정 복원
renderCustomConsumables()    // 기타 소모품 동적 렌더 (#custom-consumables)
addCustomConsumable()        // 기타 소모품 추가 (prompt 입력)
removeCustomConsumable(id)   // 기타 소모품 제거
```

### 영양제 탭 핵심 함수 추가분
```js
openAddSuppModal()           // 영양제 추가 모달 (이름 + 시간 직접 입력)
addSuppTime()                // 시간 추가 버튼 → _suppModalTimes[] 배열에 push
removeSuppTime(i)            // 시간 항목 삭제 (window 전역 — 인라인 onclick용)
updateSuppTime(i, val)       // 시간 값 변경 (window 전역 — 인라인 oninput용)
renderSuppTimeList()         // 시간 목록 렌더 (각 시간 옆에 자동 분류 뱃지)
submitAddSupp()              // 모달 확인 → timeToTiming() 변환 → appData.supplements에 추가
timeToTiming(timeStr)        // HH:MM → 아침(5-10시)/점심(11-13시)/저녁(14-19시)/자기전
timingToEmoji(timing)        // 타이밍 → 이모지
jumpToGraph(drug)            // 투약 카드 📊 버튼 — 필터 적용 + 그래프 스크롤 + 하이라이트
customConfirm(msg)           // window.customConfirm — confirm() 대체 커스텀 모달 (Promise 반환)
```
- 영양제 추가 UX: `+ 영양제 추가` 버튼 → 모달 (이름 + 복수 시간 입력) → 저장
- 시간 자동 분류: `timeToTiming()` 로 아침/점심/저녁/자기전 결정, 중복 제거
- `_suppModalTimes[]` 배열로 복수 시간 관리

### 달력 체크리스트 ↔ 영양제탭 통일
- `toggleCalendarCheck(dateStr, key)`: 영양제 키(`s_`로 시작)이면 `supplements[].taken[dateStr+'_'+timing]` 직접 토글
- `getScheduledItemsForDate()`: 영양제 done 판단 = `s.taken`만 참조 (calendarChecks 중복 제거)
- 약물 체크는 `calendarChecks` 유지 (실제 records와 구분된 수동 체크용)

### 날짜 표시 규칙 (중요)
- **날짜만 표시**: `msToKstInput(ts).slice(0,10)` → `"YYYY-MM-DD"` ✅
- **시간만 표시**: `msToKstInput(ts).slice(11,16)` → `"HH:mm"` ✅
- **`toKSTString(ts).slice(X,Y)` 패턴 금지** — Korean locale string 길이가 날짜/월에 따라 변동해서 잘림 버그 발생

### 비용 계산기 (조제계산 섹션 하단)
- **환율 API**: `https://api.frankfurter.app/latest?from=USD&to=KRW,JPY,CNY,INR` (무료, 키 불필요)
- `fxRates` 객체에 캐시, 1시간마다 자동갱신, 🔄 버튼으로 강제갱신
- 입력: 구매가격(통화선택) + 배송비(통화선택) + 소모품별(통화+박스개수) + 기타 항목
- 출력: 5개 통화 회당 비용 + 일/주/월 원화 합산
- `appData.costCalc`에 설정 저장 (scheduleSave)
- `renderCustomConsumables()`: `#custom-consumables` div 동적 렌더

### 백과사전 모달 라이트모드
- `openEncyclopediaModal()`에서 `isLight` 감지 후 `C` 색상 객체로 모든 인라인 스타일 분기
- `.enc-section`, `.enc-section-title`, `.enc-filter-btn`에 `body.light-mode` CSS 오버라이드

---

## 작업 방식 선호도
- **전체 파일 교체**: 구조적 변경, 대규모 기능 추가
- **스니펫 + 라인 번호**: 소규모 버그픽스, 스타일 수정
- 변경 이유 한 줄 설명 포함
- **한국어로 소통** (필수)
- rate limit으로 작업이 끊길 수 있으므로 작업 단위를 나누어 커밋

## 세션 관리 규칙 (IMPORTANT)
- **세션 시작 시**: `git log --oneline -5` 확인 → CLAUDE.md에 반영 안 된 변경사항 있으면 자동으로 업데이트
- **작업 마무리 시**: 코드 변경이 있었으면 반드시 "CLAUDE.md 업데이트하고 저장할까요?" 라고 먼저 물어볼 것
- CLAUDE.md 업데이트 후 git push까지 완료해야 세션 종료

---

## 유저 프로필
- GitHub Pages 단일 파일 앱 직접 운영
- Claude Code (Sonnet 4.6) 사용
- 화면 캡처를 공유하며 목표 UI를 명확히 설명하는 스타일
- pep-pedia.org 같은 레퍼런스 UI를 목표로 함
