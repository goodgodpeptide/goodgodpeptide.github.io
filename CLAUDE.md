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
| 🔬 백과사전 | `panel-encyclopedia` | 72개 펩타이드 DB, 검색/필터, 상세 모달 (pep-pedia 스타일) |

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
login_logs/            → 모든 로그인 시도 기록 (관리자 패널 대기자 추출용)
```

### 관리자 패널 (`#admin-modal`)
- 상단 바 👑 버튼 → `openAdminPanel()` 호출 (관리자만 표시)
- **대기 중**: login_logs에서 미승인 이메일 추출 → 승인 버튼
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

---

## 작업 방식 선호도
- **전체 파일 교체**: 구조적 변경, 대규모 기능 추가
- **스니펫 + 라인 번호**: 소규모 버그픽스, 스타일 수정
- 변경 이유 한 줄 설명 포함
- **한국어로 소통** (필수)
- rate limit으로 작업이 끊길 수 있으므로 작업 단위를 나누어 커밋
- 세션 종료 전 CLAUDE.md 업데이트 필수

---

## 유저 프로필
- GitHub Pages 단일 파일 앱 직접 운영
- Claude Code (Sonnet 4.6) 사용
- 화면 캡처를 공유하며 목표 UI를 명확히 설명하는 스타일
- pep-pedia.org 같은 레퍼런스 UI를 목표로 함
