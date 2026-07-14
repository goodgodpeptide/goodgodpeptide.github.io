/* ============================================================
   saju/saju_ui.js — 사주(四柱) 기능 UI 모듈 (독립 모듈)
   ============================================================
   목적: 체중관리매니저 앱 커뮤니티탭 안에 "사주 보기" 섹션을 렌더링.
        계정별 생년월일시 정보를 Firestore에 저장/로드하고,
        오늘(세운)/이번주/이번달/대운 운세를 탭으로 전환해서 보여준다.

   ⚠️ 이 파일은 독립 모듈이다 — index.html·다른 기존 파일을 일절 수정하지 않는다.
      메인 앱은 아래처럼 스크립트 태그만 추가하고 마운트 지점에서
      SajuUI.renderSajuSection(container)를 호출하면 된다.

   ── 노출 API (window.SajuUI) ─────────────────────────────
     SajuUI.renderSajuSection(container: HTMLElement)
        → container 안에 "입력폼" 또는 "오늘의 운세"를 렌더링(비동기).
          이미 저장된 생년월일 정보가 있으면 바로 운세 화면, 없으면 입력폼.

     SajuUI.init(opts)  ← 선택. 메인이 Firebase 인스턴스를 명시적으로
        주입하고 싶을 때만 호출(호출 안 해도 아래 "Firebase 연결" 참고해
        자동으로 동작함).
        opts = {
          db,                 // Firestore 인스턴스 (getFirestore(app) 결과)
          auth,               // Firebase Auth 인스턴스 (getAuth(app) 결과) — 선택
          uid,                // 문자열 또는 () => 문자열 함수. auth 없이 uid만 직접 줄 때
          fsFns: { doc, getDoc, setDoc, serverTimestamp }  // db와 같은 SDK 버전의 firestore 함수
        }

     SajuUI.switchTab('day'|'week'|'month'|'daewoon')  ← 탭 버튼 onclick에서 사용
     SajuUI.startEdit() / SajuUI.cancelEdit()          ← 정보 수정 폼 열기/닫기
     (그 외 _로 시작하는 함수들은 폼 내부 onclick/onchange용 내부 헬퍼 — 외부에서 직접 호출할 일 없음)

   ── Firebase 연결 방식 (2단계, index.html 수정 불필요) ──────
     1) 메인이 SajuUI.init({db, auth, ...})를 명시적으로 호출하면 그 인스턴스를 그대로 사용.
     2) 호출하지 않으면, 이 모듈이 스스로
          getApp() → 메인 index.html이 이미 initializeApp(firebaseConfig) 해 둔
                      앱 인스턴스를 "재사용"(설정 재하드코딩 없음)
          getAuth(app) / getFirestore(app) 로 같은 인증·DB 인스턴스를 얻는다.
        메인 스크립트가 이미 initializeApp을 호출한 뒤라면 이 과정은 항상 성공한다
        (커뮤니티탭은 로그인 후에만 보이는 화면이므로 실제 앱에서는 항상 이 경로가 성공).
     3) 위 두 경로 모두 실패하면(예: Firebase 없는 정적 테스트 페이지) 자동으로
        "로컬 전용 모드"(localStorage)로 폴백 — 서버 저장은 안 되지만 UI는 100% 동작.
        (mock 엔진 렌더 검증을 이 경로로 수행함 — 하단 보고 참고)

   ── 저장 스키마 ──────────────────────────────────────────
     경로: users/{uid}/saju/profile  (⚠️ users/{uid} 문서 자체가 아니라 서브컬렉션 문서 —
           메인 index.html의 saveData()가 users/{uid} 문서를 setDoc()으로 통째로
           덮어쓰기 때문에, 그 문서 안 필드로 넣으면 다음 저장 때 사라진다. 반드시
           별도 서브컬렉션 문서를 써야 안전함 — 아래 "한계/필요조치" 참고)
     필드: { year, month, day, hour(0-23|null), minute(0-59|null),
             calendar:'solar'|'lunar', leap:boolean, gender:'M'|'F', updatedAt }

   ── SajuEngine 계약 (병렬 작업 중인 saju_engine.js가 채울 인터페이스) ──
     window.SajuEngine.computeChart({year,month,day,hour,minute,calendar,gender,leap}) → chart
     window.SajuEngine.sewoon(chart, 'YYYY-MM-DD') → {ganji, interactions:[...], jisu:{...}, text:{...}}
     window.SajuEngine.sewoonWeekly(chart, weekStartISO) → {...}
     window.SajuEngine.sewoonMonthly(chart, 'YYYY-MM') → {...}
     window.SajuEngine.daewoon(chart) → [{startAge, ganji, ...}, ...]
     엔진이 아직 없으면(window.SajuEngine 미존재) 이 파일 내 _MockSajuEngine으로 자동 대체.
     실엔진이 나중에 window.SajuEngine에 붙으면 다음 렌더부터 자동으로 그쪽을 우선 사용
     (매 호출 시점에 window.SajuEngine 존재 여부를 다시 확인 — 캐시하지 않음).
   ============================================================ */

// ── 내부 상태 ────────────────────────────────────────────────
const _state = {
  containerEl: null,   // renderSajuSection에 전달된 마운트 엘리먼트
  uid: null,
  birth: null,          // 저장된 생년월일 정보 (없으면 null → 입력폼)
  chart: null,           // computeChart() 결과 캐시
  chartKey: null,        // chart 캐시 무효화 판단용 키
  chartError: null,
  currentView: 'day',    // 'day' | 'week' | 'month' | 'daewoon'
};

let _db = null;
let _auth = null;
let _fsFns = null;       // { doc, getDoc, setDoc, serverTimestamp }
let _fbReady = false;
let _explicitInit = false;
let _explicitUid = null;
let _fbConnectPromise = null;

const FIREBASE_SDK_VER = '10.12.0'; // index.html과 반드시 동일 버전 유지(모듈 URL이 같아야 getApp() 재사용 가능)
const SAJU_LOCAL_KEY_PREFIX = 'saju_profile_local_';

// ── Firebase 자동 연결 (선택 — init() 안 불렀을 때만 시도) ──────
async function _tryAutoConnectFirebase() {
  if (_fbConnectPromise) return _fbConnectPromise;
  _fbConnectPromise = (async () => {
    try {
      const base = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VER}/`;
      const [{ getApp }, authMod, fsMod] = await Promise.all([
        import(/* webpackIgnore: true */ base + 'firebase-app.js'),
        import(/* webpackIgnore: true */ base + 'firebase-auth.js'),
        import(/* webpackIgnore: true */ base + 'firebase-firestore.js'),
      ]);
      const app = getApp(); // 메인이 이미 initializeApp() 해뒀다면 그 인스턴스 재사용, 없으면 예외
      _auth = authMod.getAuth(app);
      _db = fsMod.getFirestore(app);
      _fsFns = {
        doc: fsMod.doc, getDoc: fsMod.getDoc, setDoc: fsMod.setDoc,
        serverTimestamp: fsMod.serverTimestamp,
      };
      // 로그인 상태가 바뀌면(로그인/로그아웃/다른 계정) 열려있는 섹션을 새로고침
      authMod.onAuthStateChanged(_auth, () => {
        if (_state.containerEl) renderSajuSection(_state.containerEl);
      });
      _fbReady = true;
    } catch (e) {
      console.warn('[SajuUI] Firebase 자동연결 실패 → 로컬 저장 모드로 폴백:', e && e.message);
      _fbReady = false;
    }
  })();
  return _fbConnectPromise;
}

function _getUid() {
  if (_explicitUid !== null) return typeof _explicitUid === 'function' ? _explicitUid() : _explicitUid;
  if (_auth && _auth.currentUser) return _auth.currentUser.uid;
  return 'local-guest'; // Firebase 미연결 시 기기 로컬 폴백용 고정 키
}

// ── 저장/로드 (Firestore 우선, 실패·미연결 시 localStorage 폴백) ──
async function _loadBirthInfo(uid) {
  if (_fbReady && _db && _fsFns) {
    try {
      const ref = _fsFns.doc(_db, 'users', uid, 'saju', 'profile');
      const snap = await _fsFns.getDoc(ref);
      if (snap.exists()) return snap.data();
    } catch (e) {
      console.warn('[SajuUI] Firestore 로드 실패, 로컬 캐시로 폴백:', e);
    }
  }
  try {
    const raw = localStorage.getItem(SAJU_LOCAL_KEY_PREFIX + uid);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function _saveBirthInfo(uid, data) {
  let savedToServer = false;
  if (_fbReady && _db && _fsFns) {
    try {
      const ref = _fsFns.doc(_db, 'users', uid, 'saju', 'profile');
      const ts = _fsFns.serverTimestamp ? _fsFns.serverTimestamp() : Date.now();
      await _fsFns.setDoc(ref, { ...data, updatedAt: ts });
      savedToServer = true;
    } catch (e) {
      console.warn('[SajuUI] Firestore 저장 실패, 이 기기 로컬에만 저장됨:', e);
    }
  }
  try {
    localStorage.setItem(SAJU_LOCAL_KEY_PREFIX + uid, JSON.stringify({ ...data, updatedAt: Date.now() }));
  } catch (e) { /* localStorage 불가 환경(시크릿모드 등) — 무시, 세션 내에서만 동작 */ }
  return { savedToServer };
}

// ── 한자(한글) 병기 헬퍼 — 사주 간지 표기는 한자만 나오면 못 읽는 사람이 많아
//    항상 발음을 괄호로 병기한다(10천간·12지지 고정 테이블, 외부 의존 없음). ──
const STEM_HANJA = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const STEM_HANGUL = ['갑', '을', '병', '정', '무', '기', '경', '신', '임', '계'];
const BRANCH_HANJA = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const BRANCH_HANGUL = ['자', '축', '인', '묘', '진', '사', '오', '미', '신', '유', '술', '해'];
const HANJA_TO_HANGUL = {};
STEM_HANJA.forEach((h, i) => { HANJA_TO_HANGUL[h] = STEM_HANGUL[i]; });
BRANCH_HANJA.forEach((h, i) => { HANJA_TO_HANGUL[h] = BRANCH_HANGUL[i]; });

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function _pairString(hanjaStr) {
  const hangul = hanjaStr.split('').map(c => HANJA_TO_HANGUL[c] || '').join('');
  return hangul
    ? `${escapeHtml(hanjaStr)}<span class="saju-ganji-reading">(${escapeHtml(hangul)})</span>`
    : escapeHtml(hanjaStr);
}

// ganji: 2글자 한자 문자열 | {hanja} | {stem,branch} — 엔진 구현 편차를 방어적으로 흡수
function _ganjiDisplay(ganji) {
  if (!ganji) return '—';
  if (typeof ganji === 'object') {
    if (ganji.hanja) return _pairString(String(ganji.hanja));
    if (ganji.stem && ganji.branch) return _pairString(String(ganji.stem) + String(ganji.branch));
    return escapeHtml(JSON.stringify(ganji));
  }
  return _pairString(String(ganji));
}

// ── KST 날짜 헬퍼 (index.html의 kstNow류와 동일 취지, 독립 구현) ──
function _kstNow() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}
function _pad2(n) { return String(n).padStart(2, '0'); }
function _todayISO() {
  const d = _kstNow();
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
}
function _weekStartISO() {
  const d = _kstNow();
  const day = d.getDay(); // 0=일 ~ 6=토
  const diffToMon = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diffToMon);
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
}
function _monthISO() {
  const d = _kstNow();
  return `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}`;
}
function _currentAge(birthYear, birthMonth, birthDay) {
  const now = _kstNow();
  let age = now.getFullYear() - Number(birthYear);
  const passed = (now.getMonth() + 1 > Number(birthMonth)) ||
    (now.getMonth() + 1 === Number(birthMonth) && now.getDate() >= Number(birthDay));
  if (!passed) age -= 1;
  return age;
}
function _daysInMonth(year, month, calendar) {
  if (calendar === 'lunar') return 30; // 음력은 29/30일 — 입력 편의상 30 상한, 실제 검증은 엔진 몫
  return new Date(Number(year) || 2000, Number(month) || 1, 0).getDate();
}
function _rangeOptions(min, max, selected) {
  let html = '';
  for (let i = min; i <= max; i++) html += `<option value="${i}" ${i === Number(selected) ? 'selected' : ''}>${i}</option>`;
  return html;
}

// ── 시드 기반 결정론적 mock 엔진 (같은 생년월일 → 항상 같은 값, 매 렌더 랜덤 튀지 않음) ──
function _seedFromInput(input) {
  const y = Number(input.year) || 2000, m = Number(input.month) || 1, d = Number(input.day) || 1;
  const h = Number(input.hour) || 0, mi = Number(input.minute) || 0;
  return (((y * 100 + m) * 100 + d) * 100 + h) * 100 + mi;
}
function _strHash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h >>> 0;
}
function _mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function _seededGanji(rand) {
  return STEM_HANJA[Math.floor(rand() * 10)] + BRANCH_HANJA[Math.floor(rand() * 12)];
}

const _MockSajuEngine = {
  computeChart(input) {
    if (!input || !input.year || !input.month || !input.day) {
      throw new Error('생년월일 정보가 필요합니다');
    }
    const seed = _seedFromInput(input);
    const rand = _mulberry32(seed);
    const hourKnown = !(input.hour === null || input.hour === undefined);
    const pillars = {
      year: _seededGanji(rand), month: _seededGanji(rand), day: _seededGanji(rand),
      hour: hourKnown ? _seededGanji(rand) : null,
    };
    const elements = {};
    ['목', '화', '토', '금', '수'].forEach(e => { elements[e] = Math.floor(rand() * 4); });
    return {
      _mock: true, input: { ...input }, seed,
      dayMaster: pillars.day.charAt(0), pillars, elements,
      gender: input.gender || 'M',
    };
  },

  sewoon(chart, dateISO) {
    const rand = _mulberry32((chart.seed ^ _strHash(dateISO)) >>> 0);
    const ganji = _seededGanji(rand);
    const jisu = {
      재물: 40 + Math.floor(rand() * 60), 사업: 40 + Math.floor(rand() * 60),
      애정: 30 + Math.floor(rand() * 70), 건강: 40 + Math.floor(rand() * 60),
    };
    const pool = [
      { type: '합', desc: '일지와 세운지가 합을 이뤄 대인관계·협업운이 상승합니다.' },
      { type: '충', desc: '세운이 일지를 충하여 변화·이동수가 강해지는 하루입니다.' },
      { type: '형', desc: '형살 작용으로 다소 예민해질 수 있으니 언행에 주의하세요.' },
    ];
    const n = 1 + Math.floor(rand() * 2);
    const interactions = Array.from({ length: n }, () => pool[Math.floor(rand() * pool.length)]);
    const avg = Math.round((jisu.재물 + jisu.사업 + jisu.애정 + jisu.건강) / 4);
    const tone = avg >= 70 ? '전반적으로 활기차고 순조로운 흐름' : avg >= 50 ? '무난하고 안정적인 흐름' : '한 박자 쉬어가며 신중함이 필요한 흐름';
    return {
      _mock: true, date: dateISO, ganji, interactions, jisu,
      text: {
        summary: `오늘(${dateISO})은 ${tone}입니다. (예시 데이터 — 사주 엔진 연결 전 임시 표시)`,
        재물: '지출보다 계획적인 관리가 유리한 흐름입니다.',
        사업: '꾸준함이 성과로 이어지는 시기입니다.',
        애정: '솔직한 표현이 좋은 반응을 얻습니다.',
        건강: '무리한 일정보다 충분한 휴식을 챙기세요.',
      },
    };
  },

  sewoonWeekly(chart, weekStartISO) {
    const rand = _mulberry32((chart.seed ^ _strHash(weekStartISO) ^ 0x11) >>> 0);
    const start = new Date(weekStartISO + 'T00:00:00');
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const iso = `${d.getFullYear()}-${_pad2(d.getMonth() + 1)}-${_pad2(d.getDate())}`;
      return { date: iso, ganji: _seededGanji(rand), score: 40 + Math.floor(rand() * 60) };
    });
    const jisu = {
      재물: 40 + Math.floor(rand() * 60), 사업: 40 + Math.floor(rand() * 60),
      애정: 30 + Math.floor(rand() * 70), 건강: 40 + Math.floor(rand() * 60),
    };
    return {
      _mock: true, rangeLabel: `${weekStartISO} 주`, ganji: _seededGanji(rand),
      interactions: [{ type: '합', desc: '이번 주는 주변과의 협력에서 좋은 결과가 따릅니다.' }],
      jisu, days,
      text: { summary: `이번 주(${weekStartISO}~)는 전반적으로 안정적인 흐름입니다. (예시 데이터)` },
    };
  },

  sewoonMonthly(chart, yyyyMm) {
    const rand = _mulberry32((chart.seed ^ _strHash(yyyyMm) ^ 0x22) >>> 0);
    const jisu = {
      재물: 40 + Math.floor(rand() * 60), 사업: 40 + Math.floor(rand() * 60),
      애정: 30 + Math.floor(rand() * 70), 건강: 40 + Math.floor(rand() * 60),
    };
    const [y, m] = yyyyMm.split('-').map(Number);
    const highlights = [1, 2].map(() => {
      const day = 1 + Math.floor(rand() * 27);
      return { date: `${y}-${_pad2(m)}-${_pad2(day)}`, label: '합충 작용이 두드러지는 주요일' };
    });
    return {
      _mock: true, rangeLabel: yyyyMm, ganji: _seededGanji(rand),
      interactions: [{ type: '충', desc: '월 중반 이후 변화·이동수에 대비하면 좋습니다.' }],
      jisu, highlights,
      text: { summary: `${yyyyMm}은 전체적으로 무난한 흐름 속에 몇 차례 변화 포인트가 있는 달입니다. (예시 데이터)` },
    };
  },

  daewoon(chart) {
    const rand = _mulberry32((chart.seed ^ 0x5AEBFA) >>> 0);
    const startAge0 = 1 + Math.floor(rand() * 9); // 대운수 1~9 (실제 산출은 엔진 몫, mock은 근사)
    const themes = ['성장과 확장', '내실 다지기', '새로운 전환', '안정과 결실'];
    return Array.from({ length: 9 }, (_, i) => {
      const startAge = startAge0 + i * 10;
      return {
        startAge, endAge: startAge + 9, ganji: _seededGanji(rand),
        summary: `이 시기는 ${themes[i % themes.length]}의 기운이 두드러집니다. (예시 데이터)`,
        _mock: true,
      };
    });
  },
};

function _getEngine() {
  const real = (typeof window !== 'undefined') ? window.SajuEngine : null;
  if (real && typeof real.computeChart === 'function') return real;
  return _MockSajuEngine;
}

// ============================================================
// ── 실엔진(saju_engine.js) ↔ UI 필드 어댑터 (2026-07 통합) ──
// ============================================================
// 엔진과 UI는 병렬로 개발되어 sewoon()/sewoonWeekly()/sewoonMonthly()/daewoon()의
// 실제 반환 필드명이 위 문서 주석(⚠ SajuEngine 계약)과 다르다(실측 확인).
// 예) sewoon()은 {ganji,jisu,text,interactions} 대신 {dayPillar,scores,
//     interactionsExplained,protagonist,huigi,...}를 반환한다.
// 🔴 엔진 반환 구조는 검증됨(팔자 정확) → 변경하지 않고, 여기서만 위 렌더 함수들
// (_renderSewoonHTML/_renderDaewoonHTML)이 원래 기대하던 {ganji,jisu,interactions,
// text,days?,highlights?} 형태로 변환한다. 목 엔진은 이미 그 형태로 반환하므로
// 이 어댑터들은 실엔진 사용 시에만 호출된다(_renderView에서 분기).
// 🔴 지어내지 않는다 — 엔진이 실제로 계산한 값(scores/interactionsExplained/huigi 등)만
// 재배열·서술 조립하며, 엔진이 제공하지 않는 세부(예: 주간·월간의 4영역 분리 지수)는
// 없는 데이터를 꾸며내는 대신 '종합' 단일 지표로 정직하게 축약한다.

// 엔진 pillarView({gan,zhi,name,hangeul,...}) → UI _ganjiDisplay가 읽는 {stem,branch}
function _pillarToGanjiObj(pillar) {
  if (!pillar || !pillar.gan) return null;
  return { stem: pillar.gan, branch: pillar.zhi };
}

// 엔진 합충 타입(한자 조합: 天干合/地支冲/三刑 등) → UI 칩 색상표 키(합/충/형/파/해)로 축약.
// 대응 안 되는 유형(공망/원진/귀문 등)은 원문 그대로 둬 기본색 칩으로 표시(정보 손실 없음).
function _shortInteractionType(rawType) {
  if (!rawType) return '작용';
  if (rawType.indexOf('合') >= 0) return '합';
  // 🔴 실측 확인: 엔진(CLASH_TYPES)은 '沖'(U+6C96, 삼수변)이 아니라 '冲'(U+51B2, 이수변)을 쓴다
  // (예: "天干冲"/"地支冲") — 둘 다 검사해 향후 표기 변경에도 안전하게 대응.
  if (rawType.indexOf('沖') >= 0 || rawType.indexOf('冲') >= 0) return '충';
  if (rawType.indexOf('刑') >= 0) return '형';
  if (rawType.indexOf('破') >= 0) return '파';
  if (rawType.indexOf('害') >= 0) return '해';
  return rawType;
}

function _toneFromAvg(avg) {
  if (avg >= 70) return '전반적으로 활기차고 순조로운 흐름';
  if (avg >= 50) return '무난하고 안정적인 흐름';
  return '한 박자 쉬어가며 신중함이 필요한 흐름';
}

function _huigiLabel(huigi) {
  if (huigi === '희신') return '희신(喜神)—도움이 되는 기운';
  if (huigi === '기신') return '기신(忌神)—부담이 되는 기운';
  return '한신(閑神)—중립적인 기운';
}

// engine.sewoon(chart, dateStr) 반환(오늘/특정일) → UI 세운 카드 형태
function _adaptSewoonDay(raw, dateLabel) {
  if (!raw) return null;
  const jisu = raw.scores || null; // {재물,사업,애정,건강} — 엔진·UI 키 이름이 그대로 일치
  const vals = jisu ? [jisu.재물, jisu.사업, jisu.애정, jisu.건강] : [60];
  const avg = Math.round(vals.reduce((a, b) => a + (b || 0), 0) / vals.length);
  const interactions = (raw.interactionsExplained || []).map(it => ({
    type: _shortInteractionType(it.type),
    desc: it.reason || it.explainLine || '',
  }));
  const focusLine = (raw.protagonist && raw.protagonist.hasFocus)
    ? ` 오늘의 주인공 작용 영역: ${(raw.protagonist.focusDomains || ['종합']).join('·')}.`
    : '';
  const sinsalLine = (raw.protagonist && raw.protagonist.sinsalNotes && raw.protagonist.sinsalNotes.length)
    ? ' ' + raw.protagonist.sinsalNotes.map(s => `${s.name}${s.note ? '(' + s.note + ')' : ''}`).join(', ')
    : '';
  const hangeul = raw.dayPillar ? raw.dayPillar.hangeul : '';
  return {
    date: dateLabel,
    ganji: _pillarToGanjiObj(raw.dayPillar),
    jisu,
    interactions,
    text: {
      summary: `오늘(${dateLabel})은 일진 ${hangeul} · ${_huigiLabel(raw.huigi)}. ${_toneFromAvg(avg)}입니다.${focusLine}${sinsalLine}`,
    },
  };
}

// engine.sewoonWeekly(chart, weekStartISO) 반환 → UI 세운 카드 형태
function _adaptSewoonWeek(raw, weekStartISO) {
  if (!raw) return null;
  const daily = raw.daily || [];
  const days = daily.map(d => ({ date: d.date, ganji: _pillarToGanjiObj(d.pillar), score: d.score }));
  // 요일별 상위 작용(daySummary가 이미 일자당 상위 3개로 추려둠)을 severity 절대값 기준
  // 상위 5개만 모아 어느 날짜의 작용인지 표기해서 보여준다(엔진이 준 detail 원문 그대로 사용).
  const flat = [];
  daily.forEach(d => (d.interactions || []).forEach(it => flat.push(Object.assign({}, it, { _date: d.date }))));
  flat.sort((a, b) => Math.abs(b.severity || 0) - Math.abs(a.severity || 0));
  const interactions = flat.slice(0, 5).map(it => ({
    type: _shortInteractionType(it.type),
    desc: `[${(it._date || '').slice(5)}] ${it.detail || it.typeKo || ''}`,
  }));
  const avg = Math.round(raw.avgScore || 60);
  const bestLabel = raw.bestDay ? `최고의 날은 ${(raw.bestDay.date || '').slice(5)}(${raw.bestDay.pillar ? raw.bestDay.pillar.hangeul : ''})` : '';
  const worstLabel = raw.worstDay ? `주의할 날은 ${(raw.worstDay.date || '').slice(5)}(${raw.worstDay.pillar ? raw.worstDay.pillar.hangeul : ''})` : '';
  return {
    rangeLabel: `${weekStartISO} 주`,
    ganji: raw.bestDay ? _pillarToGanjiObj(raw.bestDay.pillar) : null,
    // 엔진이 주간 단위로는 일자별 종합점수만 산출한다(4영역 분리지수는 일단위 sewoon()만 제공) —
    // 없는 걸 지어내지 않고 '종합' 단일 게이지로 정직하게 표시.
    jisu: { 종합: avg },
    interactions,
    text: {
      summary: `이번 주(${weekStartISO}~)는 평균 ${avg}점, ${_toneFromAvg(avg)}입니다. ${bestLabel} ${worstLabel}`.trim(),
    },
    days,
  };
}

// engine.sewoonMonthly(chart, yyyyMm) 반환 → UI 세운 카드 형태
function _adaptSewoonMonth(raw, yyyyMm) {
  if (!raw) return null;
  const avg = Math.round(raw.avgScore || 60);
  const highlights = (raw.luckyDays || []).slice(0, 3).map(d => ({
    date: d.date, label: `길한 흐름(${d.score}점) — 일진 ${d.pillar ? d.pillar.hangeul : ''}`,
  })).concat((raw.riskDays || []).slice(0, 2).map(d => ({
    date: d.date, label: `신중할 흐름(${d.score}점) — 일진 ${d.pillar ? d.pillar.hangeul : ''}`,
  })));
  highlights.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  return {
    rangeLabel: yyyyMm,
    ganji: null, // 명리학상 '월간 세운'을 대표하는 단일 간지 개념이 없어(일진 단위로만 존재) 비움 — UI가 '—'로 정직하게 표시
    jisu: { 종합: avg },
    interactions: [],
    text: {
      summary: `${yyyyMm}은 평균 ${avg}점, ${_toneFromAvg(avg)}입니다. 아래 주요일을 참고하세요.`,
    },
    highlights,
  };
}

// engine.daewoon(chart) 반환(배열) → UI 대운 리스트 형태
function _adaptDaewoonList(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map(dw => ({
    startAge: dw.ageStart,
    endAge: dw.ageEnd,
    ganji: dw.ganji, // 이미 2글자 한자 문자열(예: "甲子") — _ganjiDisplay 문자열 분기가 그대로 처리
    summary: `${_huigiLabel(dw.huigi)} · 십성 ${dw.sipsungGan || '?'}(천간)/${dw.sipsungZhi || '?'}(지지) 방향의 흐름입니다.`,
  }));
}

// Toitjeong.compute() 반환 → 토정비결 카드 HTML (사주 엔진과 무관한 별도 체계라 어댑터가 아니라
// 전용 렌더 함수로 분리 — _renderView/_renderToitjeongHTML에서 사용)
function _renderToitjeongHTML(data) {
  if (!data) return _errorCardHTML('토정비결 정보를 계산할 수 없습니다.');
  const gwaeNo = data.괘번호 || '';
  const gwaeRaw = (typeof window !== 'undefined' && window.Toitjeong && window.Toitjeong.GWAE_DATA)
    ? window.Toitjeong.GWAE_DATA[gwaeNo] : null;
  const targetYear = (data.입력 && data.입력.targetYear) || '';
  const detail = data.detail || {};

  let html = `<div class="saju-card saju-ganji-card">
    <div class="saju-section-title">🎍 ${escapeHtml(String(targetYear))}년 토정비결 · 괘 ${escapeHtml(gwaeNo)} (${escapeHtml(String(data.상괘))}-${escapeHtml(String(data.중괘))}-${escapeHtml(String(data.하괘))})</div>
    <div class="saju-birth-summary">세는나이 ${escapeHtml(String(data.나이 != null ? data.나이 : '?'))}세 · 연간지 ${escapeHtml(detail.연간지 || '')}</div>
  </div>`;

  html += `<div class="saju-card"><div class="saju-section-title">📝 총운(總運)</div>`;
  if (data.총운) {
    html += `<div class="saju-text-summary">${escapeHtml(data.총운)}</div>`;
  } else if (gwaeRaw && gwaeRaw.hanja) {
    // 144괘 중 한글 번역이 검증된 것은 아직 없음(원문 한문만 확보된 표본 존재) — 정직하게 원문+미검증 표기로 노출
    html += `<div class="saju-text-summary">${escapeHtml(gwaeRaw.hanja)}</div>
      <div class="saju-mock-badge" title="한글 번역이 아직 검증되지 않아 한문 원문만 표시합니다">한문 원문 · 번역 준비중</div>`;
  } else {
    html += `<div class="saju-text-summary">이 괘(卦)의 해석문은 아직 준비중입니다. (144괘 중 순차적으로 채워질 예정)</div>`;
  }
  html += `</div>`;

  const monthly = Array.isArray(data.월별운) ? data.월별운 : [];
  if (monthly.some(m => !!m)) {
    html += `<div class="saju-card"><div class="saju-section-title">📅 월별운</div><div class="saju-text-detail-list">` +
      monthly.map((m, i) => m ? `<div class="saju-text-detail"><b>${i + 1}월</b>${escapeHtml(m)}</div>` : '').join('') +
      `</div></div>`;
  }

  const notes = detail.notes || [];
  if (notes.length) {
    html += `<div class="saju-card"><div class="saju-section-title">⚠️ 참고</div>` +
      notes.map(n => `<div class="saju-text-detail">${escapeHtml(n)}</div>`).join('') + `</div>`;
  }

  return html;
}

// ── 스타일 자동 주입 (index.html 수정 없이 saju.css 로드) ──────
let _stylesInjected = false;
function _injectStyles() {
  if (_stylesInjected) return;
  _stylesInjected = true;
  try {
    if (document.querySelector('link[data-saju-style]')) return;
    const href = new URL('./saju.css', import.meta.url).href;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.setAttribute('data-saju-style', '1');
    document.head.appendChild(link);
  } catch (e) { console.warn('[SajuUI] 스타일 로드 실패:', e); }
}

// ── 차트 계산 캐시 ───────────────────────────────────────
function _computeChartIfNeeded() {
  const b = _state.birth;
  if (!b) { _state.chart = null; return; }
  const key = JSON.stringify([b.year, b.month, b.day, b.hour, b.minute, b.calendar, b.gender, b.leap]);
  if (_state.chart && _state.chartKey === key) return;
  const engine = _getEngine();
  try {
    _state.chart = engine.computeChart({
      year: b.year, month: b.month, day: b.day, hour: b.hour, minute: b.minute,
      calendar: b.calendar, gender: b.gender, leap: !!b.leap,
      // 🔴 엔진↔UI 필드명 불일치 어댑터: saju_engine.js의 normalizeBirthToSolar()는
      // 윤달 여부를 input.isLeapMonth로 읽는다(leap이 아님) — 이름이 달라 그냥 두면
      // 음력 윤달생 사용자의 윤달 정보가 조용히 무시된 채 평달로 계산된다.
      // leap은 하위호환/문서화용으로 남기고 isLeapMonth를 실제로 추가 전달한다.
      isLeapMonth: !!b.leap,
    });
    _state.chartKey = key;
    _state.chartError = null;
  } catch (e) {
    console.error('[SajuUI] computeChart 실패:', e);
    _state.chart = null;
    _state.chartError = e;
  }
}

// ── 공통 조각 HTML ───────────────────────────────────────
function _loadingHTML() { return `<div class="saju-wrap"><div class="saju-loading">🔮 사주 정보를 불러오는 중...</div></div>`; }
function _spinnerHTML() { return `<div class="saju-loading">불러오는 중...</div>`; }
function _errorCardHTML(msg) {
  return `<div class="saju-card"><div class="saju-error">${escapeHtml(msg)}</div>
    <div style="text-align:center"><button type="button" class="saju-retry-btn" onclick="SajuUI.switchTab('${escapeHtml(_state.currentView)}')">다시 시도</button></div></div>`;
}
function _formError(msg) {
  const el = document.getElementById('saju-form-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function _gaugeRow(label, value, color) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return `<div class="saju-gauge-row">
    <div class="saju-gauge-label">${escapeHtml(label)}</div>
    <div class="saju-gauge-track"><div class="saju-gauge-fill" style="width:${v}%;background:${color}"></div></div>
    <div class="saju-gauge-val">${v}</div>
  </div>`;
}

function _interactionChip(it) {
  const type = (it && (it.type || it.kind)) || '작용';
  const desc = (it && (it.desc || it.text || it.description)) || (typeof it === 'string' ? it : '');
  const COLORS = { 합: '#22c55e', 충: '#ef4444', 형: '#f59e0b', 파: '#a78bfa', 해: '#94a3b8' };
  const c = COLORS[type] || '#60a5fa';
  return `<div class="saju-chip" style="border-color:${c}55">
    <span class="saju-chip-type" style="color:${c}">${escapeHtml(type)}</span>
    <span class="saju-chip-desc">${escapeHtml(desc)}</span>
  </div>`;
}

const JISU_COLORS = { 재물: '#f59e0b', 사업: '#3b82f6', 애정: '#f472b6', 건강: '#22c55e' };

// ── 세운(오늘/주간/월간) 렌더 — 엔진 반환 형태 편차를 필드 존재 여부로 방어적으로 흡수 ──
function _renderSewoonHTML(data, view) {
  if (!data) return _errorCardHTML('운세 정보가 없습니다.');
  const labelMap = { day: '오늘', week: '이번주', month: '이번달' };
  const dateLabel = data.date || data.rangeLabel || data.range ||
    (view === 'month' ? _monthISO() : view === 'week' ? `${_weekStartISO()} 주` : _todayISO());

  let html = `<div class="saju-card saju-ganji-card">
    <div class="saju-section-title">${labelMap[view] || ''} 세운 · ${escapeHtml(String(dateLabel))}</div>
    <div class="saju-ganji-badge">${_ganjiDisplay(data.ganji)}</div>
  </div>`;

  if (data.jisu && typeof data.jisu === 'object') {
    html += `<div class="saju-card"><div class="saju-section-title">📊 영역 지수</div>`;
    Object.keys(data.jisu).forEach(k => { html += _gaugeRow(k, data.jisu[k], JISU_COLORS[k] || '#60a5fa'); });
    html += `</div>`;
  }

  if (Array.isArray(data.interactions) && data.interactions.length) {
    html += `<div class="saju-card"><div class="saju-section-title">🔗 합충 작용</div>
      <div class="saju-chip-list">${data.interactions.map(_interactionChip).join('')}</div></div>`;
  }

  if (data.text && typeof data.text === 'object') {
    const summary = data.text.summary;
    const rest = Object.keys(data.text).filter(k => k !== 'summary');
    html += `<div class="saju-card"><div class="saju-section-title">📝 풀이</div>`;
    if (summary) html += `<div class="saju-text-summary">${escapeHtml(summary)}</div>`;
    if (rest.length) {
      html += `<div class="saju-text-detail-list">${rest.map(k =>
        `<div class="saju-text-detail"><b>${escapeHtml(k)}</b>${escapeHtml(data.text[k])}</div>`).join('')}</div>`;
    }
    html += `</div>`;
  } else if (typeof data.text === 'string' && data.text) {
    html += `<div class="saju-card"><div class="saju-section-title">📝 풀이</div>
      <div class="saju-text-summary">${escapeHtml(data.text)}</div></div>`;
  }

  if (Array.isArray(data.days) && data.days.length) {
    html += `<div class="saju-card"><div class="saju-section-title">📅 요일별 흐름</div><div class="saju-day-strip">` +
      data.days.map(d => `<div class="saju-day-chip">
        <div class="saju-day-date">${escapeHtml((d.date || '').slice(5))}</div>
        <div class="saju-day-ganji">${_ganjiDisplay(d.ganji)}</div>
        ${d.score !== undefined ? `<div class="saju-day-score">${escapeHtml(String(d.score))}</div>` : ''}
      </div>`).join('') + `</div></div>`;
  }

  if (Array.isArray(data.highlights) && data.highlights.length) {
    html += `<div class="saju-card"><div class="saju-section-title">✨ 이달의 주요일</div><div class="saju-highlight-list">` +
      data.highlights.map(h => `<div class="saju-highlight-item">${escapeHtml(h.date || '')} — ${escapeHtml(h.label || h.desc || '')}</div>`).join('') +
      `</div></div>`;
  }

  return html;
}

function _renderDaewoonHTML(list) {
  if (!Array.isArray(list) || !list.length) return _errorCardHTML('대운 정보를 계산할 수 없습니다.');
  const b = _state.birth || {};
  const age = _currentAge(b.year, b.month, b.day);
  const items = list.map(it => {
    const isCurrent = age >= it.startAge && (it.endAge === undefined || age <= it.endAge);
    return `<div class="saju-daewoon-item ${isCurrent ? 'current' : ''}">
      <div class="saju-daewoon-age">${it.startAge}${it.endAge !== undefined ? `~${it.endAge}세` : '세~'}</div>
      <div class="saju-daewoon-ganji">${_ganjiDisplay(it.ganji)}</div>
      <div class="saju-daewoon-summary">${escapeHtml(it.summary || it.text || '')}</div>
      ${isCurrent ? '<span class="saju-daewoon-current-badge">현재</span>' : ''}
    </div>`;
  }).join('');
  return `<div class="saju-card"><div class="saju-section-title">🌊 대운(10년 단위 큰 흐름) · 현재 만 ${age}세</div>
    <div class="saju-daewoon-list">${items}</div></div>`;
}

// ── 탭 전환 / 뷰 렌더 ───────────────────────────────────
function _updateTabActiveClasses() {
  document.querySelectorAll('.saju-tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === _state.currentView));
}

async function _renderView(view) {
  _state.currentView = view;
  _updateTabActiveClasses();
  const host = document.getElementById('saju-view-content');
  if (!host) return;
  host.innerHTML = _spinnerHTML();

  if (_state.chartError || !_state.chart) {
    host.innerHTML = _errorCardHTML('사주 계산에 실패했습니다. 생년월일 정보를 다시 확인해주세요.');
    return;
  }
  const engine = _getEngine();
  const isMock = engine === _MockSajuEngine; // 목 엔진은 이미 UI 기대 형태로 반환 → 어댑터 스킵
  try {
    let data;
    if (view === 'day') {
      const dateLabel = _todayISO();
      const raw = await engine.sewoon(_state.chart, dateLabel);
      data = isMock ? raw : _adaptSewoonDay(raw, dateLabel);
    } else if (view === 'week') {
      const weekStart = _weekStartISO();
      const raw = await engine.sewoonWeekly(_state.chart, weekStart);
      data = isMock ? raw : _adaptSewoonWeek(raw, weekStart);
    } else if (view === 'month') {
      const yyyyMm = _monthISO();
      const raw = await engine.sewoonMonthly(_state.chart, yyyyMm);
      data = isMock ? raw : _adaptSewoonMonth(raw, yyyyMm);
    } else if (view === 'daewoon') {
      const raw = await engine.daewoon(_state.chart);
      data = isMock ? raw : _adaptDaewoonList(raw);
    } else if (view === 'toitjeong') {
      const toit = (typeof window !== 'undefined') ? window.Toitjeong : null;
      if (!toit || typeof toit.compute !== 'function') {
        host.innerHTML = _errorCardHTML('토정비결 엔진이 로드되지 않았습니다.');
        return;
      }
      const b = _state.birth || {};
      const targetYear = _kstNow().getFullYear();
      data = toit.compute({
        year: b.year, month: b.month, day: b.day,
        lunar: b.calendar === 'lunar', leap: !!b.leap, // 🔴 필드명 어댑터: UI 저장 스키마는 calendar/leap, Toitjeong.compute는 lunar(boolean)/leap을 기대
        targetYear,
      });
      host.innerHTML = _renderToitjeongHTML(data);
      return;
    } else return;
    host.innerHTML = view === 'daewoon' ? _renderDaewoonHTML(data) : _renderSewoonHTML(data, view);
  } catch (e) {
    console.error(`[SajuUI] 운세 조회 실패 (${view}):`, e);
    host.innerHTML = _errorCardHTML(view === 'toitjeong' ? '토정비결 정보를 불러오지 못했습니다.' : '운세 정보를 불러오지 못했습니다.');
  }
}

function _renderFortuneShell(container) {
  const b = _state.birth || {};
  const calLabel = b.calendar === 'lunar' ? '음력' : '양력';
  const hourLabel = (b.hour === null || b.hour === undefined) ? '시간 모름' : `${_pad2(b.hour)}:${_pad2(b.minute || 0)}`;
  const genderLabel = b.gender === 'F' ? '여성' : '남성';
  const mockBadge = (_state.chart && _state.chart._mock)
    ? `<span class="saju-mock-badge" title="사주 계산 엔진이 아직 연결되지 않아 예시 데이터로 표시됩니다">예시 데이터</span>` : '';

  container.innerHTML = `
    <div class="saju-wrap">
      <div class="saju-header-row">
        <div class="saju-birth-summary">
          🔮 ${escapeHtml(String(b.year))}.${_pad2(b.month)}.${_pad2(b.day)} (${calLabel}) · ${hourLabel} · ${genderLabel}${mockBadge}
        </div>
        <button type="button" class="saju-edit-btn" onclick="SajuUI.startEdit()">정보 수정</button>
      </div>
      <div class="saju-tab-bar">
        <button type="button" class="saju-tab-btn" data-view="day" onclick="SajuUI.switchTab('day')">오늘</button>
        <button type="button" class="saju-tab-btn" data-view="week" onclick="SajuUI.switchTab('week')">이번주</button>
        <button type="button" class="saju-tab-btn" data-view="month" onclick="SajuUI.switchTab('month')">이번달</button>
        <button type="button" class="saju-tab-btn" data-view="daewoon" onclick="SajuUI.switchTab('daewoon')">대운</button>
        <button type="button" class="saju-tab-btn" data-view="toitjeong" onclick="SajuUI.switchTab('toitjeong')">토정비결</button>
      </div>
      <div id="saju-view-content" class="saju-view-content"></div>
    </div>`;
  _updateTabActiveClasses();
}

// ── 입력 폼 ──────────────────────────────────────────────
function _renderForm(container, prefill) {
  const b = prefill || {};
  const year = b.year || '';
  const month = b.month || '';
  const day = b.day || '';
  const calendar = b.calendar || 'solar';
  // prefill이 없는 최초 입력(신규)에는 "시간 모름"을 기본 체크하지 않는다(대부분 시간을 알고 입력하므로
  // 필드를 활성 상태로 시작하는 게 자연스러움). 수정 모드에서 이전에 "모름"으로 저장했을 때만 체크 유지.
  const hourKnown = prefill ? !(b.hour === null || b.hour === undefined) : true;
  const hour = hourKnown ? (b.hour !== undefined && b.hour !== null ? b.hour : 12) : 12;
  const minute = (b.minute !== undefined && b.minute !== null) ? b.minute : 0;
  const gender = b.gender || 'M';
  const isEdit = !!prefill;
  const thisYear = new Date().getFullYear();

  const yearOpts = _rangeOptions(1930, thisYear, year || (thisYear - 30));
  const monthOpts = _rangeOptions(1, 12, month || 1);
  const dayOpts = _rangeOptions(1, _daysInMonth(year || 2000, month || 1, calendar), day || 1);
  const hourOpts = Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === hour ? 'selected' : ''}>${_pad2(h)}시</option>`).join('');
  const minuteOpts = [0, 10, 20, 30, 40, 50].map(m => `<option value="${m}" ${m === minute ? 'selected' : ''}>${_pad2(m)}분</option>`).join('');

  container.innerHTML = `
    <div class="saju-wrap">
      <div class="saju-card">
        <div class="saju-form-title">${isEdit ? '🔮 사주 정보 수정' : '🔮 사주 보기 — 생년월일 입력'}</div>
        <div class="saju-form-desc">${isEdit
      ? '정보를 수정하면 오늘/주간/월간/대운이 새로 계산됩니다.'
      : '생년월일시를 입력하면 오늘의 운세부터 대운까지 볼 수 있어요. 정보는 계정에 안전하게 저장되고 언제든 수정할 수 있습니다.'}</div>
        <div id="saju-form-error" class="saju-form-error" style="display:none"></div>

        <div class="saju-toggle-group saju-cal-toggle">
          <button type="button" class="saju-toggle-btn ${calendar === 'solar' ? 'active' : ''}" data-val="solar" onclick="SajuUI._setCalendarType('solar')">양력</button>
          <button type="button" class="saju-toggle-btn ${calendar === 'lunar' ? 'active' : ''}" data-val="lunar" onclick="SajuUI._setCalendarType('lunar')">음력</button>
        </div>
        <input type="hidden" id="saju-f-calendar" value="${calendar}"/>

        <div class="saju-field-row">
          <select id="saju-f-year" class="saju-select" onchange="SajuUI._syncDayOptions()">${yearOpts}</select>
          <select id="saju-f-month" class="saju-select" onchange="SajuUI._syncDayOptions()">${monthOpts}</select>
          <select id="saju-f-day" class="saju-select">${dayOpts}</select>
        </div>

        <div id="saju-leap-row" class="saju-checkbox-row" style="display:${calendar === 'lunar' ? 'flex' : 'none'}">
          <label><input type="checkbox" id="saju-f-leap" ${b.leap ? 'checked' : ''}/> 윤달</label>
        </div>

        <div class="saju-field-row">
          <select id="saju-f-hour" class="saju-select" ${!hourKnown ? 'disabled' : ''}>${hourOpts}</select>
          <select id="saju-f-minute" class="saju-select" ${!hourKnown ? 'disabled' : ''}>${minuteOpts}</select>
        </div>
        <div class="saju-checkbox-row">
          <label><input type="checkbox" id="saju-f-unknown-time" ${!hourKnown ? 'checked' : ''} onchange="SajuUI._toggleUnknownTime(this.checked)"/> 출생시간 모름</label>
        </div>

        <div class="saju-toggle-group saju-gender-toggle">
          <button type="button" class="saju-toggle-btn ${gender === 'M' ? 'active' : ''}" data-val="M" onclick="SajuUI._setGender('M')">남성</button>
          <button type="button" class="saju-toggle-btn ${gender === 'F' ? 'active' : ''}" data-val="F" onclick="SajuUI._setGender('F')">여성</button>
        </div>
        <input type="hidden" id="saju-f-gender" value="${gender}"/>

        <div class="saju-form-actions">
          ${isEdit ? `<button type="button" class="saju-btn-secondary" onclick="SajuUI.cancelEdit()">취소</button>` : ''}
          <button type="button" id="saju-submit-btn" class="saju-btn-primary" onclick="SajuUI._submitForm()">저장</button>
        </div>
      </div>
    </div>`;
}

// ── 메인 진입점 ───────────────────────────────────────────
async function renderSajuSection(container) {
  if (!container) return;
  _state.containerEl = container;
  _injectStyles();
  if (!_explicitInit) await _tryAutoConnectFirebase();

  const uid = _getUid();
  _state.uid = uid;
  container.innerHTML = _loadingHTML();

  let birth = null;
  try { birth = await _loadBirthInfo(uid); } catch (e) { console.warn('[SajuUI] 로드 오류:', e); }
  _state.birth = birth;

  if (!birth) { _renderForm(container, null); return; }

  _computeChartIfNeeded();
  _state.currentView = _state.currentView || 'day';
  _renderFortuneShell(container);
  _renderView(_state.currentView);
}

function init(opts) {
  opts = opts || {};
  _explicitInit = true;
  if (opts.db) _db = opts.db;
  if (opts.auth) _auth = opts.auth;
  if (opts.fsFns) _fsFns = opts.fsFns;
  if (opts.uid !== undefined) _explicitUid = opts.uid;
  _fbReady = !!(_db && _fsFns);
}

// ── window.SajuUI 노출 ────────────────────────────────────
window.SajuUI = {
  renderSajuSection,
  init,

  switchTab(view) { _renderView(view); },
  startEdit() { if (_state.containerEl) _renderForm(_state.containerEl, _state.birth); },
  cancelEdit() {
    if (!_state.containerEl) return;
    if (_state.birth) { _renderFortuneShell(_state.containerEl); _renderView(_state.currentView || 'day'); }
    else { _renderForm(_state.containerEl, null); }
  },

  // ↓ 입력폼 내부 onclick/onchange 전용 헬퍼 (외부에서 직접 호출할 일 없음)
  _setCalendarType(type) {
    document.querySelectorAll('.saju-cal-toggle .saju-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.val === type));
    const hidden = document.getElementById('saju-f-calendar');
    if (hidden) hidden.value = type;
    const leapRow = document.getElementById('saju-leap-row');
    if (leapRow) leapRow.style.display = type === 'lunar' ? 'flex' : 'none';
    // 음력↔양력 전환 시 월별 일수 상한이 달라질 수 있어 day 옵션 재동기화
    window.SajuUI._syncDayOptions();
  },
  _setGender(g) {
    document.querySelectorAll('.saju-gender-toggle .saju-toggle-btn').forEach(b => b.classList.toggle('active', b.dataset.val === g));
    const hidden = document.getElementById('saju-f-gender');
    if (hidden) hidden.value = g;
  },
  _toggleUnknownTime(checked) {
    const h = document.getElementById('saju-f-hour'), m = document.getElementById('saju-f-minute');
    if (h) h.disabled = checked;
    if (m) m.disabled = checked;
  },
  _syncDayOptions() {
    const yEl = document.getElementById('saju-f-year'), mEl = document.getElementById('saju-f-month');
    const calEl = document.getElementById('saju-f-calendar'), daySel = document.getElementById('saju-f-day');
    if (!yEl || !mEl || !daySel) return;
    const y = Number(yEl.value), m = Number(mEl.value), cal = calEl ? calEl.value : 'solar';
    const prev = Number(daySel.value) || 1;
    const max = _daysInMonth(y, m, cal);
    daySel.innerHTML = _rangeOptions(1, max, Math.min(prev, max));
  },
  async _submitForm() {
    const $ = id => document.getElementById(id);
    const year = Number($('saju-f-year').value);
    const month = Number($('saju-f-month').value);
    const day = Number($('saju-f-day').value);
    const calendar = ($('saju-f-calendar') || {}).value || 'solar';
    const leap = calendar === 'lunar' && $('saju-f-leap') ? !!$('saju-f-leap').checked : false;
    const unknownTime = $('saju-f-unknown-time') ? !!$('saju-f-unknown-time').checked : false;
    const hour = unknownTime ? null : Number($('saju-f-hour').value);
    const minute = unknownTime ? null : Number($('saju-f-minute').value);
    const gender = ($('saju-f-gender') || {}).value || 'M';
    const thisYear = new Date().getFullYear();

    if (!year || year < 1900 || year > thisYear) return _formError('출생연도를 확인해주세요.');
    if (!month || month < 1 || month > 12) return _formError('출생월을 확인해주세요.');
    if (!day || day < 1 || day > 31) return _formError('출생일을 확인해주세요.');
    if (!unknownTime && (isNaN(hour) || hour < 0 || hour > 23)) return _formError('출생시간을 확인해주세요.');
    if (gender !== 'M' && gender !== 'F') return _formError('성별을 선택해주세요.');

    const btn = $('saju-submit-btn');
    if (btn) { btn.disabled = true; btn.textContent = '저장 중...'; }

    const uid = _getUid();
    const data = { year, month, day, hour, minute, calendar, leap, gender };
    try {
      const r = await _saveBirthInfo(uid, data);
      _state.birth = data;
      _state.chart = null; // 강제 재계산
      _computeChartIfNeeded();
      if (!r.savedToServer) console.warn('[SajuUI] 서버(Firestore) 저장 실패 — 이 기기 로컬에만 저장됨');
      _renderFortuneShell(_state.containerEl);
      _renderView(_state.currentView || 'day');
    } catch (e) {
      console.error('[SajuUI] 저장 오류:', e);
      _formError('저장 중 오류가 발생했습니다. 다시 시도해주세요.');
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
    }
  },
};
