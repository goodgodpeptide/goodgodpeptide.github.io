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
| 🔬 백과사전 | `panel-encyclopedia` | 72개 펩타이드 DB, 검색/필터, 상세 모달 (pep-pedia 스타일) |

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
- `cfg.short` 키 사용 (마운자로, 레타, 위고비) — 입력창 포커스/값은 건드리지 않음

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

## 백과사전 탭 (panel-encyclopedia)

### 데이터 파일
- **`peptides_v3.json`** — 72개 펩타이드, v3.0 포맷
  - 소스: `parse_peptides_v3.py` (pep-pedia.org 스크래핑 텍스트 파싱)
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
      interactions: [{ name, type }],  // type: "Synergistic"|"Compatible"|"Monitor Combination"|...
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

## 현재 알려진 이슈 / TODO
- [ ] 백과사전 카드 약어 아이콘 개선 (현재 slug에서 자동 생성)
- [ ] 일부 펩타이드 typicalDose가 빈 값 (파서 개선 여지)
- ✅ 한국어 번역: 크롬 번역 기능으로 해결 (별도 구현 불필요)
- ✅ 관리자 승인 기반 접근 제어 구현 완료
- ✅ 다중 관리자 계정 관리 (config/admins) 구현 완료
- ✅ 백업/복원 기능 구현 완료
- ✅ 라이트모드 색상 전면 수정 (모달/화면/동적 목록 모두 대응)
- ✅ 라이트모드 텍스트 가독성 개선 (투약 카드 테마 토큰 분리, 연한 회색 텍스트 진하게)
- ✅ 관리자 패널 이메일 직접 입력 승인 기능 추가 (manualApprove)
- ✅ 거절 기능 추가 (재신청 허용, 거절 타임스탬프 기반)
- ✅ 관리자 패널 대기 목록 버그 수정 (로그인 로그를 승인 체크 전에 기록)
- ✅ 카카오톡 인앱 브라우저 UA 감지 수정 (Android 카카오톡 Chrome/ 포함 문제)
- ✅ 라이트모드 stat-val 색상 수정 + html 스크롤 배경 흰색 처리
- ✅ 투약 탭 사용 약물 토글 (activeDrugs) + 1초 실시간 농도/그래프 업데이트
- ✅ 탭 7개→5개 통합 (분석+계산 제거, 체중 서브탭 3개, 인바디 신규)
- ✅ 체중 그래프 X축 = 첫 투약일 시작 / 약물 그래프 X축 끝 = 5×반감기 소실 시점
- ✅ 약물 그래프: 범위 버튼 제거(줌 초기화만), 임상 용량 기준선, 현재 농도 수평 점선
- ✅ 체중 그래프 음수 X 좌표 버그 수정 (투약 전 체중 기록이 있을 때 그래프 깨지는 문제)
- [ ] 운동 탭 추가 예정

### 약물 그래프 임상 기준선 (DRUG_CONFIG.doseSteps / clinicalMax)
- 마운자로: doseSteps [2.5,5,7.5,10,12.5,15], clinicalMax 15 (SURMOUNT)
- 레타: doseSteps [1,2,4,8,12], clinicalMax 12 (NEJM 2023 Phase 2)
- 위고비: doseSteps [0.25,0.5,1,1.7,2.4], clinicalMax 2.4 (STEP)
- Y축 최솟값 = max(실제 데이터 피크, clinicalMax) 로 스케일 고정
- 현재 체내 농도 수평 점선: `calcConcentrationAt(drug, now)` 기준

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
