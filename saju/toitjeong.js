/*!
 * toitjeong.js — 체중관리매니저 토정비결(土亭祕訣) 계산·해석 엔진 (독립 모듈)
 *
 * 목적: 생년월일(+대상연도)로 그 해의 신수(身數) 괘(卦)를 뽑는 전통 토정비결 계산기.
 *   saju_engine.js(사주/명리, 주역과 무관)와는 완전히 다른 체계다 — 토정비결은
 *   태세수(太歲數)·월건수(月建數)·일진수(日辰數) 조견표를 나이·생월·생일에 더해
 *   8·6·3으로 나눈 나머지로 상괘(上卦)·중괘(中卦)·하괘(下卦)를 뽑는 독자적인 작괘법(作卦法)이다.
 *   백엔드 없는 정적 PWA이므로 전 계산을 브라우저(또는 Node) JS로 수행한다.
 *
 * 구성:
 *   SECTION 1 — 음력·양력 변환 백엔드: usingsky/korean_lunar_calendar_js(MIT) vendored
 *               (한국천문연구원 KASI 계산 기반, 음력 1000-01-01 ~ 2050-11-18 지원)
 *   SECTION 2 — 육십갑자(六十甲子) 조견표: 태세수·월건수·일진수 (아래 '조사 결과' 참고)
 *   SECTION 3 — 상괘·중괘·하괘 작괘 로직 (compute)
 *   SECTION 4 — 144괘 해석문 데이터 스텁 (완성도: 극히 일부 — 아래 '한계' 참고)
 *   SECTION 5 — window.Toitjeong 전역 노출 (+ Node: module.exports)
 *
 * 사용법 (브라우저): <script src="saju/toitjeong.js"></script> 후 Toitjeong.compute({...})
 * 사용법 (Node):     const Toitjeong = require('./saju/toitjeong.js');
 *
 * ============================================================================
 * 조사한 정확한 토정비결 계산법 (착수 전 GitHub·커뮤니티 선행조사 결과 요약)
 * ============================================================================
 * 출처: CHUNUN.COM 티스토리 블로그(2009-11-22 작성, 전통 조견표 게재)
 *   - "토정비결 볼때 상괘,중괘,하괘 계산하는 방법"
 *     https://chunun.com/entry/토정비결-볼때-상괘-중괘-하괘-계산하는-방법
 *   - "토정비결 조견표"(60갑자별 태세수·월건수·일진수 전체표)
 *     https://chunun.com/entry/토정비결-조견표
 *
 * ▶ 상괘(上卦, 1~8) = (한국 나이 + 태세수) % 8   → 나머지 0이면 8
 *     · "한국 나이" = 대상연도(그 해) - 태어난 음력 연도 + 1 (세는나이)
 *     · "태세수"는 그 해(대상연도)의 음력 연간지(年干支)로 조견표에서 조회
 * ▶ 중괘(中卦, 1~6) = (그 해의 생월에 해당하는 음력월 '일수(29 또는 30)' + 월건수) % 6   → 나머지 0이면 6
 *     · "그 해의 생월 일수"는 태어난 연도가 아니라 대상연도(=그 해)의 음력 달력에서
 *       생월과 같은 월 번호가 크달(30일)인지 작은달(29일)인지를 뜻함 — 이 부분이 가장 흔한 오해 지점.
 *     · "월건수"는 대상연도의 그 생월에 해당하는 월간지(月干支, 오호둔법五虎遁法으로 결정)로 조견표에서 조회
 * ▶ 하괘(下卦, 1~3) = (음력 생일 + 일진수) % 3   → 나머지 0이면 3
 *     · "일진수"는 대상연도의 [생월,생일]에 해당하는 일진(日辰, 그날의 60갑자)으로 조견표에서 조회
 * ▶ 괘번호 = 상괘·중괘·하괘를 이어붙인 3자리 숫자(예: 212) — 8×6×3 = 144가지
 *
 * [실측 검증 — chunun.com 예시 재현]
 *   "음력 1976년 8월 26일생의 2005년 토정비결"
 *   나이 30, 대상연도 2005년(을유년, 태세수 20) → 상괘=(30+20)%8=2
 *   2005년 음력 8월은 작은달(29일), 그 달은 乙酉月(월건수 14) → 중괘=(29+14)%6=1
 *   생일 26, 2005년 음력 8월 26일=丙辰日(일진수 18) → 하괘=(26+18)%3=2
 *   → 최종 괘 "212" — 원문 예시와 100% 일치. 아래 SECTION 2 조견표로 이 모듈에서도
 *   동일하게 재현됨을 Node에서 assert 검증함(리포트 참고).
 *
 * [독립 2차 검증 — 6tail/lunar-javascript(MIT, 이 저장소 saju/saju_engine.js에 이미 내장)와 대조]
 *   Solar.fromYmd(2005,9,29).getLunar() → 음력 2005-8-26 / 년주 乙酉 / 월주 乙酉 / 일주 丙辰
 *   → chunun.com 예시와 완전히 일치. 서로 무관한 두 오픈소스 자료(수기 조견표 vs 천문 계산
 *   라이브러리)가 정확히 같은 결과를 냄으로써 연간지·일진 산출 로직의 정확성을 교차확인함.
 *   (오늘 2026-07-15 일진=庚寅도 별도 웹검색 2건 + 6tail 계산이 모두 일치, 3중 확인.)
 *
 * [★중요 발견 — 토정비결 '월건' ≠ 사주(四柱) '월주' 임을 실측으로 확인]
 *   6tail 교차검증 중 임의 6개 표본에서 연간지·일진은 6/6 100% 일치했지만 월건만 3/6에서
 *   불일치가 나왔다(예: 음력 2026-2-19 → 이 모듈은 辛卯, 6tail getMonthInGanZhi()는 壬辰).
 *   원인을 파고들어 보니 버그가 아니라 **두 체계가 애초에 다른 규칙**이었다:
 *     · 6tail(사주/BaZi 전용)의 월주는 절기(節氣) 절입 시각 기준 — 음력 2월 중이라도 청명
 *       절입을 지나면 그 순간부터 월주가 바뀐다(실측: 음력2026-2-1=辛卯, 2026-2-19=壬辰,
 *       같은 음력 2월인데 절기가 그 사이에 넘어가 이미 바뀜).
 *     · 토정비결의 '월건'은 chunun.com 원문 예시가 명시하듯("8월은 乙酉月 이므로") 음력월
 *       번호 하나 전체에 월건 하나가 통째로 대응하는 민간 술서식 관습 — 절기와 무관하다.
 *   따라서 이 모듈은 토정비결 원전 정의대로 '음력월 번호 기준'을 채택했다(사주 절기 기준과
 *   다른 것은 설계상 의도된 차이이며 버그가 아님). 상세 재현은 Node 검증 스크립트 결과 참고.
 *
 * ============================================================================
 * 육십갑자 조견표 출처와 정정 사항 (정직하게 명시)
 * ============================================================================
 * CHUNUN.COM "토정비결 조견표" 원본 HTML 표를 직접 파싱해 60갑자 전체(태세수·월건수·
 * 일진수)를 추출했다. 원본 표에 라벨 복사 오류가 2건 있어 다음과 같이 정정했다(수치는
 * 원본 그대로 유지 — 60갑자 정순서 상 그 칸이 반드시 그 간지여야 하므로 라벨만 바로잡음):
 *   · 8행(辛) 6번째 칸: 원본 "辛卯(신묘)" 중복 표기 → 정순서상 "辛酉(신유)"가 맞음(정정)
 *   · 9행(壬) 6번째 칸: 원본 "壬辰(임진)" 중복 표기 → 정순서상 "壬戌(임술)"가 맞음(정정)
 *   정정 근거: 표 안에서 동일 천간 행 내 '辰-戌'(진술) 조합은 30갑자 간격 대칭 위치에서
 *   태세수·월건수·일진수 3개 값이 항상 완전히 일치하는 패턴이 다른 8개 행(甲戌=甲辰,
 *   丙戌=丙辰, 戊辰=戊戌, 壬辰=?)에서 예외 없이 확인되어, 정정한 두 칸의 수치 자체는
 *   신뢰할 수 있다고 판단했다(라벨 오타일 뿐 수치는 유효). 다만 이 두 값은 별도의
 *   독립 소스로 재대조하지 못했으므로 참고 바람(아래 '한계' 참고).
 *
 * ============================================================================
 * 한계·불확실 지점 (정직하게 표기 — 추측·환각 금지 원칙)
 * ============================================================================
 * 1) 육십갑자 조견표(태세수·월건수·일진수) 60개 값 중 58개(신유·임술 제외)는 CHUNUN.COM
 *    원본 표를 그대로 옮겼다. 이 중 연간지·일진에 실제로 쓰이는 간지 산출(60갑자 자체가
 *    맞는지)은 6tail/lunar-javascript와 6개 임의표본 교차검증 6/6 일치로 검증됐지만,
 *    조견표의 '숫자'(태세수·월건수·일진수 값 자체)는 을유(20,14)·병진(18) 3개 숫자만
 *    chunun.com 원문 예시로 실측 대조했다 — 나머지 값들은 원본 표를 신뢰해 그대로 썼을
 *    뿐 개별 대조는 못 했다. 다른 조견표(만세력·플러스만세력 등)와 재대조를 권장한다
 *    (본 조사 중 해당 사이트들은 접속 실패 — ECONNRESET/403).
 * 2) 윤달(閏月) 생월의 '월건수' 처리: 이 모듈이 쓰는 라이브러리의 월간지 계산식은
 *    윤달과 그 앞/뒤 평달을 같은 월간지로 계산한다(오호둔법의 월지가 윤달에서도
 *    이어지는 전통 규칙과 부합하나, 윤달 자체를 별도 월로 셈하는 유파도 있어 완전히
 *    통일된 정설은 아님) — 윤달 출생자의 결과는 참고용으로만 쓸 것.
 * 2-1) 월건은 '음력월 번호 기준'(절기 무관)으로 채택했다 — 위 [★중요 발견] 참고. 만약
 *    특정 만세력 사이트가 절기 기준 월건을 쓴다면(사주식 월주를 그대로 가져다 쓰는 경우)
 *    그 생월에 절기 절입이 낀 사람은 그 사이트와 월건·중괘가 다를 수 있다.
 * 3) 나이 계산은 "대상연도 - 태어난 음력 연도 + 1"(세는나이)로 구현했다. 이는 실측
 *    예시(30세)와 일치하지만, 만약 GG가 알고 있는 특정 만세력 사이트가 다른 나이
 *    계산법(예: 양력 생년 기준)을 쓴다면 그 사이트와 다를 수 있다 — 대조 권장.
 * 4) 144괘 해석문(총운·월별운)은 방대한 문헌 데이터라 이번 조사에서 실제 원문을
 *    확보한 것은 "111" 괘 총운 한문 원문 1건뿐이다(출처 주석 있음, 한글 번역은
 *    검증 안 됐으므로 비워둠). 나머지 143개는 완전히 비어 있다 — SECTION 4 참고.
 */
;(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.Toitjeong = factory();
  }
})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this), function () {
  'use strict';

  // ================================================================
  // SECTION 1. 음력·양력 변환 백엔드 — vendored usingsky/korean_lunar_calendar_js (MIT License)
  //   https://github.com/usingsky/korean_lunar_calendar_js
  //   Copyright (c) 2022 Jinil Lee — 원본 TypeScript를 타입 제거 후 그대로 이식.
  //   한국천문연구원(KASI) 계산 기반, 음력 1000-01-01 ~ 2050-11-18 / 양력 1000-02-13 ~ 2050-12-31 지원.
  // ================================================================
  var LUNAR_CALENDAR_DATA = {
    KOREAN_LUNAR_MIN_VALUE: 10000101,
    KOREAN_LUNAR_MAX_VALUE: 20501118,
    KOREAN_SOLAR_MIN_VALUE: 10000213,
    KOREAN_SOLAR_MAX_VALUE: 20501231,

    KOREAN_LUNAR_BASE_YEAR: 1000,
    SOLAR_LUNAR_DAY_DIFF: 43,

    LUNAR_SMALL_MONTH_DAY: 29,
    LUNAR_BIG_MONTH_DAY: 30,
    SOLAR_SMALL_YEAR_DAY: 365,
    SOLAR_BIG_YEAR_DAY: 366,

    SOLAR_DAYS: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31, 29],

    KOREAN_CHEONGAN: [
      0xac11, 0xc744, 0xbcd1, 0xc815, 0xbb34, 0xae30, 0xacbd, 0xc2e0, 0xc784,
      0xacc4,
    ].map(function (c) { return String.fromCharCode(c); }),
    KOREAN_GANJI: [
      0xc790, 0xcd95, 0xc778, 0xbb18, 0xc9c4, 0xc0ac, 0xc624, 0xbbf8, 0xc2e0,
      0xc720, 0xc220, 0xd574,
    ].map(function (c) { return String.fromCharCode(c); }),
    KOREAN_GAPJA_UNIT: [0xb144, 0xc6d4, 0xc77c].map(function (c) {
      return String.fromCharCode(c);
    }),

    CHINESE_CHEONGAN: [
      0x7532, 0x4e59, 0x4e19, 0x4e01, 0x620a, 0x5df1, 0x5e9a, 0x8f9b, 0x58ec,
      0x7678,
    ].map(function (c) { return String.fromCharCode(c); }),
    CHINESE_GANJI: [
      0x5b50, 0x4e11, 0x5bc5, 0x536f, 0x8fb0, 0x5df3, 0x5348, 0x672a, 0x7533,
      0x9149, 0x620c, 0x4ea5,
    ].map(function (c) { return String.fromCharCode(c); }),
    CHINESE_GAPJA_UNIT: [0x5e74, 0x6708, 0x65e5].map(function (c) {
      return String.fromCharCode(c);
    }),

    INTERCALATION_STR: [0xc724, 0x958f].map(function (c) { return String.fromCharCode(c); }),

    KOREAN_LUNAR_DATA: [
      0x82c60a57, 0x82fec52b, 0x82c40d2a, 0x82c60d55, 0xc30095ad, 0x82c4056a,
      0x82c6096d, 0x830054dd, 0xc2c404ad, 0x82c40a4d, 0x83002e4d, 0x82c40b26,
      0xc300ab56, 0x82c60ad5, 0x82c4035a, 0x8300697a, 0xc2c6095b, 0x82c4049b,
      0x83004a9b, 0x82c40a4b, 0xc301caa5, 0x82c406aa, 0x82c60ad5, 0x830092dd,
      0xc2c402b5, 0x82c60957, 0x82fe54ae, 0x82c60c97, 0xc2c4064b, 0x82ff254a,
      0x82c60da9, 0x8300a6b6, 0xc2c6066d, 0x82c4026e, 0x8301692e, 0x82c4092e,
      0xc2c40c96, 0x83004d95, 0x82c40d4a, 0x8300cd69, 0xc2c40b58, 0x82c80d6b,
      0x8301926b, 0x82c4025d, 0xc2c4092b, 0x83005aab, 0x82c40a95, 0x82c40b4a,
      0xc3021eab, 0x82c402d5, 0x8301b55a, 0x82c604bb, 0xc2c4025b, 0x83007537,
      0x82c4052b, 0x82c40695, 0xc3003755, 0x82c406aa, 0x8303cab5, 0x82c40275,
      0xc2c404b6, 0x83008a5e, 0x82c40a56, 0x82c40d26, 0xc3005ea6, 0x82c60d55,
      0x82c405aa, 0x83001d6a, 0xc2c6096d, 0x8300b4af, 0x82c4049d, 0x82c40a4d,
      0xc3007d2d, 0x82c40aa6, 0x82c60b55, 0x830045d5, 0xc2c4035a, 0x82c6095d,
      0x83011173, 0x82c4045b, 0xc3009a4f, 0x82c4064b, 0x82c40aa5, 0x83006b69,
      0xc2c606b5, 0x82c402da, 0x83002ab6, 0x82c60937, 0xc2fec497, 0x82c60c97,
      0x82c4064b, 0x82fe86aa, 0xc2c60da5, 0x82c405b4, 0x83034a6d, 0x82c402ae,
      0xc2c40e61, 0x83002d2e, 0x82c40c96, 0x83009d4d, 0x82c40d4a, 0x82c60d65,
      0x83016595, 0x82c6055d, 0xc2c4026d, 0x83002a5d, 0x82c4092b, 0x8300aa97,
      0xc2c40a95, 0x82c40b4a, 0x83008b5a, 0x82c60ad5, 0xc2c6055b, 0x830042b7,
      0x82c40457, 0x82c4052b, 0xc3001d2b, 0x82c40695, 0x8300972d, 0x82c405aa,
      0xc2c60ab5, 0x830054ed, 0x82c404b6, 0x82c60a57, 0xc2ff344e, 0x82c40d26,
      0x8301be92, 0x82c60d55, 0xc2c405aa, 0x830089ba, 0x82c6096d, 0x82c404ae,
      0xc3004a9d, 0x82c40a4d, 0x82c40d25, 0x83002f25, 0xc2c40b54, 0x8303ad69,
      0x82c402da, 0x82c6095d, 0xc301649b, 0x82c4049b, 0x82c40a4b, 0x83004b4b,
      0xc2c406a5, 0x8300bb53, 0x82c406b4, 0x82c60ab6, 0xc3018956, 0x82c60997,
      0x82c40497, 0x83004697, 0xc2c4054b, 0x82fec6a5, 0x82c60da5, 0x82c405ac,
      0xc303aab5, 0x82c4026e, 0x82c4092e, 0x83006cae, 0xc2c40c96, 0x82c40d4a,
      0x83002f4a, 0x82c60d55, 0xc300b56b, 0x82c6055b, 0x82c4025d, 0x8300793d,
      0xc2c40927, 0x82c40a95, 0x83015d15, 0x82c40b4a, 0xc2c60b55, 0x830112d5,
      0x82c604db, 0x82fe925e, 0xc2c60a57, 0x82c4052b, 0x83006aab, 0x82c40695,
      0xc2c406aa, 0x83003baa, 0x82c60ab5, 0x8300b4b7, 0xc2c404ae, 0x82c60a57,
      0x82fe752e, 0x82c40d26, 0xc2c60e93, 0x830056d5, 0x82c405aa, 0x82c609b5,
      0xc300256d, 0x82c404ae, 0x8301aa4d, 0x82c40a4d, 0xc2c40d26, 0x83006d65,
      0x82c40b52, 0x82c60d6a, 0xc30026da, 0x82c6095d, 0x8301c49d, 0x82c4049b,
      0xc2c40a4b, 0x83008aab, 0x82c406a5, 0x82c40b54, 0xc3004bb4, 0x82c60ab6,
      0x82c6095b, 0x83002537, 0xc2c40497, 0x8300964f, 0x82c4054b, 0x82c406a5,
      0xc30176c5, 0x82c405ac, 0x82c60ab6, 0x8301386e, 0xc2c4092e, 0x8300cc97,
      0x82c40c96, 0x82c40d4a, 0xc3008daa, 0x82c60b55, 0x82c4056a, 0x83025adb,
      0xc2c4025d, 0x82c4092e, 0x83002d2b, 0x82c40a95, 0xc3009d4d, 0x82c40b2a,
      0x82c60b55, 0x83007575, 0xc2c404da, 0x82c60a5b, 0x83004557, 0x82c4052b,
      0xc301ca93, 0x82c40693, 0x82c406aa, 0x83008ada, 0xc2c60ae5, 0x82c404b6,
      0x83004aae, 0x82c60a57, 0xc2c40527, 0x82ff2526, 0x82c60e53, 0x8300a6cb,
      0xc2c405aa, 0x82c605ad, 0x830164ad, 0x82c404ae, 0xc2c40a4e, 0x83004d4d,
      0x82c40d26, 0x8300bd53, 0xc2c40b52, 0x82c60b6a, 0x8301956a, 0x82c60557,
      0xc2c4049d, 0x83015a1b, 0x82c40a4b, 0x82c40aa5, 0xc3001ea5, 0x82c40b52,
      0x8300bb5a, 0x82c60ab6, 0xc2c6095b, 0x830064b7, 0x82c40497, 0x82c4064b,
      0xc300374b, 0x82c406a5, 0x8300b6b3, 0x82c405ac, 0xc2c60ab6, 0x830182ad,
      0x82c4049e, 0x82c40a4d, 0xc3005d4b, 0x82c40b25, 0x82c40b52, 0x83012e52,
      0xc2c60b5a, 0x8300a95e, 0x82c6095b, 0x82c4049b, 0xc3006a57, 0x82c40a4b,
      0x82c40aa5, 0x83004ba5, 0xc2c406d4, 0x8300cad6, 0x82c60ab6, 0x82c60937,
      0x8300849f, 0x82c40497, 0x82c4064b, 0x82fe56ca, 0xc2c60da5, 0x82c405aa,
      0x83001d6c, 0x82c60a6e, 0xc300b92f, 0x82c4092e, 0x82c40c96, 0x83007d55,
      0xc2c40d4a, 0x82c60d55, 0x83013555, 0x82c4056a, 0xc2c60a6d, 0x83001a5d,
      0x82c4092b, 0x83008a5b, 0xc2c40a95, 0x82c40b2a, 0x83015b2a, 0x82c60ad5,
      0xc2c404da, 0x83001cba, 0x82c60a57, 0x8300952f, 0xc2c40527, 0x82c40693,
      0x830076b3, 0x82c406aa, 0xc2c60ab5, 0x83003575, 0x82c404b6, 0x8300ca67,
      0xc2c40a2e, 0x82c40d16, 0x83008e96, 0x82c40d4a, 0xc2c60daa, 0x830055ea,
      0x82c6056d, 0x82c404ae, 0xc301285d, 0x82c40a2d, 0x8300ad17, 0x82c40aa5,
      0xc2c40b52, 0x83007d74, 0x82c60ada, 0x82c6055d, 0xc300353b, 0x82c4045b,
      0x82c40a2b, 0x83011a2b, 0xc2c40aa5, 0x83009b55, 0x82c406b2, 0x82c60ad6,
      0xc3015536, 0x82c60937, 0x82c40457, 0x83003a57, 0xc2c4052b, 0x82feaaa6,
      0x82c60d95, 0x82c405aa, 0xc3017aac, 0x82c60a6e, 0x82c4052e, 0x83003cae,
      0xc2c40a56, 0x8300bd2b, 0x82c40d2a, 0x82c60d55, 0xc30095ad, 0x82c4056a,
      0x82c60a6d, 0x8300555d, 0xc2c4052b, 0x82c40a8d, 0x83002e55, 0x82c40b2a,
      0xc300ab56, 0x82c60ad5, 0x82c404da, 0x83006a7a, 0xc2c60a57, 0x82c4051b,
      0x83014a17, 0x82c40653, 0xc301c6a9, 0x82c405aa, 0x82c60ab5, 0x830092bd,
      0xc2c402b6, 0x82c60a37, 0x82fe552e, 0x82c40d16, 0x82c60e4b, 0x82fe3752,
      0x82c60daa, 0x8301b5b4, 0xc2c6056d, 0x82c402ae, 0x83007a3d, 0x82c40a2d,
      0xc2c40d15, 0x83004d95, 0x82c40b52, 0x8300cb69, 0xc2c60ada, 0x82c6055d,
      0x8301925b, 0x82c4045b, 0xc2c40a2b, 0x83005aab, 0x82c40a95, 0x82c40b52,
      0xc3001eaa, 0x82c60ab6, 0x8300c55b, 0x82c604b7, 0xc2c40457, 0x83007537,
      0x82c4052b, 0x82c40695, 0xc3014695, 0x82c405aa, 0x8300cab5, 0x82c60a6e,
      0xc2c404ae, 0x83008a5e, 0x82c40a56, 0x82c40d2a, 0xc3006eaa, 0x82c60d55,
      0x82c4056a, 0x8301295a, 0xc2c6095d, 0x8300b4af, 0x82c4049b, 0x82c40a4d,
      0xc3007d2d, 0x82c40b2a, 0x82c60b55, 0x830045d5, 0xc2c402da, 0x82c6095b,
      0x83011157, 0x82c4049b, 0xc3009a4f, 0x82c4064b, 0x82c406a9, 0x83006aea,
      0xc2c606b5, 0x82c402b6, 0x83002aae, 0x82c60937, 0xc2ffb496, 0x82c40c96,
      0x82c60e4b, 0x82fe76b2, 0xc2c60daa, 0x82c605ad, 0x8300336d, 0x82c4026e,
      0xc2c4092e, 0x83002d2d, 0x82c40c95, 0x83009d4d, 0xc2c40b4a, 0x82c60b69,
      0x8301655a, 0x82c6055b, 0xc2c4025d, 0x83002a5b, 0x82c4092b, 0x8300aa97,
      0xc2c40695, 0x82c4074a, 0x83008b5a, 0x82c60ab6, 0xc2c6053b, 0x830042b7,
      0x82c40257, 0x82c4052b, 0xc3001d2b, 0x82c40695, 0x830096ad, 0x82c405aa,
      0xc2c60ab5, 0x830054ed, 0x82c404ae, 0x82c60a57, 0xc2ff344e, 0x82c40d2a,
      0x8301bd94, 0x82c60b55, 0x82c4056a, 0x8300797a, 0x82c6095d, 0x82c404ae,
      0xc3004a9b, 0x82c40a4d, 0x82c40d25, 0x83011aaa, 0xc2c60b55, 0x8300956d,
      0x82c402da, 0x82c6095b, 0xc30054b7, 0x82c40497, 0x82c40a4b, 0x83004b4b,
      0xc2c406a9, 0x8300cad5, 0x82c605b5, 0x82c402b6, 0xc300895e, 0x82c6092f,
      0x82c40497, 0x82fe4696, 0xc2c40d4a, 0x8300cea5, 0x82c60d69, 0x82c6056d,
      0xc301a2b5, 0x82c4026e, 0x82c4092e, 0x83006cad, 0xc2c40c95, 0x82c40d4a,
      0x83002f4a, 0x82c60b59, 0xc300c56d, 0x82c6055b, 0x82c4025d, 0x8300793b,
      0xc2c4092b, 0x82c40a95, 0x83015b15, 0x82c406ca, 0xc2c60ad5, 0x830112b6,
      0x82c604bb, 0x8300925f, 0xc2c40257, 0x82c4052b, 0x82fe6aaa, 0x82c60e95,
      0xc2c406aa, 0x83003baa, 0x82c60ab5, 0x8300b4b7, 0xc2c404ae, 0x82c60a57,
      0x82fe752d, 0x82c40d26, 0xc2c60d95, 0x830055d5, 0x82c4056a, 0x82c6096d,
      0xc300255d, 0x82c404ae, 0x8300aa4f, 0x82c40a4d, 0xc2c40d25, 0x83006d69,
      0x82c60b55, 0x82c4035a, 0xc3002aba, 0x82c6095b, 0x8301c49b, 0x82c40497,
      0xc2c40a4b, 0x83008b2b, 0x82c406a5, 0x82c406d4, 0xc3034ab5, 0x82c402b6,
      0x82c60937, 0x8300252f, 0xc2c40497, 0x82fe964e, 0x82c40d4a, 0x82c60ea5,
      0xc30166a9, 0x82c6056d, 0x82c402b6, 0x8301385e, 0xc2c4092e, 0x8300bc97,
      0x82c40a95, 0x82c40d4a, 0xc3008daa, 0x82c60b4d, 0x82c6056b, 0x830042db,
      0xc2c4025d, 0x82c4092d, 0x83002d2b, 0x82c40a95, 0xc3009b4d, 0x82c406aa,
      0x82c60ad5, 0x83006575, 0xc2c604bb, 0x82c4025b, 0x83013457, 0x82c4052b,
      0xc2ffba94, 0x82c60e95, 0x82c406aa, 0x83008ada, 0xc2c609b5, 0x82c404b6,
      0x83004aae, 0x82c60a4f, 0xc2c20526, 0x83012d26, 0x82c60d55, 0x8301a5a9,
      0xc2c4056a, 0x82c6096d, 0x8301649d, 0x82c4049e, 0xc2c40a4d, 0x83004d4d,
      0x82c40d25, 0x8300bd53, 0xc2c40b54, 0x82c60b5a, 0x8301895a, 0x82c6095b,
      0xc2c4049b, 0x83004a97, 0x82c40a4b, 0x82c40aa5, 0xc3001ea5, 0x82c406d4,
      0x8302badb, 0x82c402b6, 0xc2c60937, 0x830064af, 0x82c40497, 0x82c4064b,
      0xc2fe374a, 0x82c60da5, 0x8300b6b5, 0x82c6056d, 0xc2c402ae, 0x8300793e,
      0x82c4092e, 0x82c40c96, 0xc3015d15, 0x82c40d4a, 0x82c60da5, 0x83013555,
      0xc2c4056a, 0x83007a7a, 0x82c60a5d, 0x82c4092d, 0xc3006aab, 0x82c40a95,
      0x82c40b4a, 0x83004baa, 0xc2c60ad5, 0x82c4055a, 0x830128ba, 0x82c60a5b,
      0xc3007537, 0x82c4052b, 0x82c40693, 0x83015715, 0xc2c406aa, 0x82c60ad5,
      0x830035b5, 0x82c404b6, 0xc3008a5e, 0x82c40a4e, 0x82c40d26, 0x83006ea6,
      0xc2c40d52, 0x82c60daa, 0x8301466a, 0x82c6056d, 0xc2c404ae, 0x83003a9d,
      0x82c40a4d, 0x83007d2b, 0xc2c40b25, 0x82c40d52, 0x83015d54, 0x82c60b5a,
      0xc2c6055d, 0x8300355b, 0x82c4049b, 0x83007657, 0x82c40a4b, 0x82c40aa5,
      0x83006b65, 0x82c406d2, 0xc2c60ada, 0x830045b6, 0x82c60937, 0x82c40497,
      0xc3003697, 0x82c4064d, 0x82fe76aa, 0x82c60da5, 0xc2c405aa, 0x83005aec,
      0x82c60aae, 0x82c4092e, 0xc3003d2e, 0x82c40c96, 0x83018d45, 0x82c40d4a,
      0xc2c60d55, 0x83016595, 0x82c4056a, 0x82c60a6d, 0xc300455d, 0x82c4052d,
      0x82c40a95, 0x83013c95, 0xc2c40b4a, 0x83017b4a, 0x82c60ad5, 0x82c4055a,
      0xc3015a3a, 0x82c60a5b, 0x82c4052b, 0x83014a17, 0xc2c40693, 0x830096ab,
      0x82c406aa, 0x82c60ab5, 0xc30064f5, 0x82c404b6, 0x82c60a57, 0x82fe452e,
      0xc2c40d16, 0x82c60e93, 0x82fe3752, 0x82c60daa, 0xc30175aa, 0x82c6056d,
      0x82c404ae, 0x83015a1d, 0xc2c40a2d, 0x82c40d15, 0x83004da5, 0x82c40b52,
      0xc3009d6a, 0x82c60ada, 0x82c6055d, 0x8301629b, 0xc2c4045b, 0x82c40a2b,
      0x83005b2b, 0x82c40a95, 0xc2c40b52, 0x83012ab2, 0x82c60ad6, 0x83017556,
      0xc2c60537, 0x82c40457, 0x83005657, 0x82c4052b, 0xc2c40695, 0x83003795,
      0x82c405aa, 0x8300aab6, 0xc2c60a6d, 0x82c404ae, 0x83006a6e, 0x82c40a56,
      0xc2c40d2a, 0x83005eaa, 0x82c60d55, 0x82c405aa, 0xc3003b6a, 0x82c60a6d,
      0x830074bd, 0x82c404ab, 0xc2c40a8d, 0x83005d55, 0x82c40b2a, 0x82c60b55,
      0xc30045d5, 0x82c404da, 0x82c6095d, 0x83002557, 0xc2c4049b, 0x83006a97,
      0x82c4064b, 0x82c406a9, 0x83004baa, 0x82c606b5, 0x82c402ba, 0x83002ab6,
      0xc2c60937, 0x82fe652e, 0x82c40d16, 0x82c60e4b, 0xc2fe56d2, 0x82c60da9,
      0x82c605b5, 0x8300336d, 0xc2c402ae, 0x82c40a2e, 0x83002e2d, 0x82c40c95,
      0xc3006d55, 0x82c40b52, 0x82c60b69, 0x830045da, 0xc2c6055d, 0x82c4025d,
      0x83003a5b, 0x82c40a2b, 0xc3017a8b, 0x82c40a95, 0x82c40b4a, 0x83015b2a,
      0xc2c60ad5, 0x82c6055b, 0x830042b7, 0x82c40257, 0xc300952f, 0x82c4052b,
      0x82c40695, 0x830066d5, 0xc2c405aa, 0x82c60ab5, 0x8300456d, 0x82c404ae,
      0xc2c60a57, 0x82ff3456, 0x82c40d2a, 0x83017e8a, 0xc2c60d55, 0x82c405aa,
      0x83005ada, 0x82c6095d, 0xc2c404ae, 0x83004aab, 0x82c40a4d, 0x83008d2b,
      0xc2c40b29, 0x82c60b55, 0x83007575, 0x82c402da, 0xc2c6095d, 0x830054d7,
      0x82c4049b, 0x82c40a4b, 0xc3013a4b, 0x82c406a9, 0x83008ad9, 0x82c606b5,
      0xc2c402b6, 0x83015936, 0x82c60937, 0x82c40497, 0xc2fe4696, 0x82c40e4a,
      0x8300aea6, 0x82c60da9, 0xc2c605ad, 0x830162ad, 0x82c402ae, 0x82c4092e,
      0xc3005cad, 0x82c40c95, 0x82c40d4a, 0x83013d4a, 0xc2c60b69, 0x8300757a,
      0x82c6055b, 0x82c4025d, 0xc300595b, 0x82c4092b, 0x82c40a95, 0x83004d95,
      0xc2c40b4a, 0x82c60b55, 0x830026d5, 0x82c6055b, 0xc3006277, 0x82c40257,
      0x82c4052b, 0x82fe5aaa, 0xc2c60e95, 0x82c406aa, 0x83003baa, 0x82c60ab5,
      0x830084bd, 0x82c404ae, 0x82c60a57, 0x82fe554d, 0xc2c40d26, 0x82c60d95,
      0x83014655, 0x82c4056a, 0xc2c609ad, 0x8300255d, 0x82c404ae, 0x83006a5b,
      0xc2c40a4d, 0x82c40d25, 0x83005da9, 0x82c60b55, 0xc2c4056a, 0x83002ada,
      0x82c6095d, 0x830074bb, 0xc2c4049b, 0x82c40a4b, 0x83005b4b, 0x82c406a9,
      0xc2c40ad4, 0x83024bb5, 0x82c402b6, 0x82c6095b, 0xc3002537, 0x82c40497,
      0x82fe6656, 0x82c40e4a, 0xc2c60ea5, 0x830156a9, 0x82c605b5, 0x82c402b6,
      0xc30138ae, 0x82c4092e, 0x83017c8d, 0x82c40c95, 0xc2c40d4a, 0x83016d8a,
      0x82c60b69, 0x82c6056d, 0xc301425b, 0x82c4025d, 0x82c4092d, 0x83002d2b,
      0xc2c40a95, 0x83007d55, 0x82c40b4a, 0x82c60b55, 0xc3015555, 0x82c604db,
      0x82c4025b, 0x83013857, 0xc2c4052b, 0x83008a9b, 0x82c40695, 0x82c406aa,
      0xc3006aea, 0x82c60ab5, 0x82c404b6, 0x83004aae, 0xc2c60a57, 0x82c40527,
      0x82fe3726, 0x82c60d95, 0xc30076b5, 0x82c4056a, 0x82c609ad, 0x830054dd,
      0xc2c404ae, 0x82c40a4e, 0x83004d4d, 0x82c40d25, 0xc3008d59, 0x82c40b54,
      0x82c60d6a, 0x8301695a, 0xc2c6095b, 0x82c4049b, 0x83004a9b, 0x82c40a4b,
      0xc300ab27, 0x82c406a5, 0x82c406d4, 0x83026b75, 0xc2c402b6, 0x82c6095b,
      0x830054b7, 0x82c40497, 0xc2c4064b, 0x82fe374a, 0x82c60ea5, 0x830086d9,
      0xc2c605ad, 0x82c402b6, 0x8300596e, 0x82c4092e, 0xc2c40c96, 0x83004e95,
      0x82c40d4a, 0x82c60da5, 0xc3002755, 0x82c4056c, 0x83027abb, 0x82c4025d,
      0xc2c4092d, 0x83005cab, 0x82c40a95, 0x82c40b4a, 0xc3013b4a, 0x82c60b55,
      0x8300955d, 0x82c404ba, 0xc2c60a5b, 0x83005557, 0x82c4052b, 0x82c40a95,
      0xc3004b95, 0x82c406aa, 0x82c60ad5, 0x830026b5, 0xc2c404b6, 0x83006a6e,
      0x82c60a57, 0x82c40527, 0xc2fe56a6, 0x82c60d93, 0x82c405aa, 0x83003b6a,
      0xc2c6096d, 0x8300b4af, 0x82c404ae, 0x82c40a4d, 0xc3016d0d, 0x82c40d25,
      0x82c40d52, 0x83005dd4, 0xc2c60b6a, 0x82c6096d, 0x8300255b, 0x82c4049b,
      0xc3007a57, 0x82c40a4b, 0x82c40b25, 0x83015b25, 0xc2c406d4, 0x82c60ada,
      0x830138b6,
    ],
  };

  // 육십갑자 위상(位相) 오프셋: 기준연도(1000)에 대한 천간(길이10)·지지(길이12) 시작 위치.
  var GAPJA_OFFSET = {
    YEAR_CHEONGAN: 6,
    YEAR_GANJI: 0,
    MONTH_CHEONGAN: 3,
    MONTH_GANJI: 1,
    DAY_CHEONGAN: 4,
    DAY_GANJI: 2,
  };

  function KoreanLunarCalendar() {
    this.solarCalendar = { year: 0, month: 0, day: 0 };
    this.lunarCalendar = { year: 0, month: 0, day: 0, intercalation: false };
    this.cumulativeLunarYearDays = {};
    this.cumulativeSolarYearDays = {};
    var today = new Date();
    this.setSolarDate(today.getFullYear(), today.getMonth() + 1, today.getDate());
  }

  KoreanLunarCalendar.prototype.getLunarData = function (year) {
    return LUNAR_CALENDAR_DATA.KOREAN_LUNAR_DATA[year - LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR];
  };

  KoreanLunarCalendar.prototype.getLunarIntercalationMonth = function (lunarData) {
    return (lunarData >> 12) & 0x000f;
  };

  KoreanLunarCalendar.prototype.getLunarYearDays = function (year) {
    return (this.getLunarData(year) >> 17) & 0x01ff;
  };

  KoreanLunarCalendar.prototype.getLunarMonthDays = function (year, month, isIntercalation) {
    var lunarData = this.getLunarData(year);
    var isBigMonth =
      isIntercalation && this.getLunarIntercalationMonth(lunarData) === month
        ? ((lunarData >> 16) & 0x01) > 0
        : ((lunarData >> (12 - month)) & 0x01) > 0;
    return isBigMonth
      ? LUNAR_CALENDAR_DATA.LUNAR_BIG_MONTH_DAY
      : LUNAR_CALENDAR_DATA.LUNAR_SMALL_MONTH_DAY;
  };

  KoreanLunarCalendar.prototype.getLunarDaysBeforeBaseYear = function (year) {
    return this.accumulateYearDays(year, this.cumulativeLunarYearDays, function (y) {
      return this.getLunarYearDays(y);
    }.bind(this));
  };

  KoreanLunarCalendar.prototype.getLunarDaysBeforeBaseMonth = function (year, month, isIntercalation) {
    var days = 0;
    if (year >= LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR && month > 0) {
      for (var baseMonth = 1; baseMonth < month + 1; baseMonth++) {
        days += this.getLunarMonthDays(year, baseMonth, false);
      }
      if (isIntercalation) {
        var intercalationMonth = this.getLunarIntercalationMonth(this.getLunarData(year));
        if (intercalationMonth > 0 && intercalationMonth < month + 1) {
          days += this.getLunarMonthDays(year, intercalationMonth, true);
        }
      }
    }
    return days;
  };

  KoreanLunarCalendar.prototype.getLunarAbsDays = function (year, month, day, isIntercalation) {
    var days =
      this.getLunarDaysBeforeBaseYear(year - 1) +
      this.getLunarDaysBeforeBaseMonth(year, month - 1, true) +
      day;
    if (isIntercalation && this.getLunarIntercalationMonth(this.getLunarData(year)) === month) {
      days += this.getLunarMonthDays(year, month, false);
    }
    return days;
  };

  KoreanLunarCalendar.prototype.isSolarIntercalationYear = function (lunarData) {
    return ((lunarData >> 30) & 0x01) > 0;
  };

  KoreanLunarCalendar.prototype.getSolarYearDays = function (year) {
    return this.isSolarIntercalationYear(this.getLunarData(year))
      ? LUNAR_CALENDAR_DATA.SOLAR_BIG_YEAR_DAY
      : LUNAR_CALENDAR_DATA.SOLAR_SMALL_YEAR_DAY;
  };

  KoreanLunarCalendar.prototype.getSolarMonthDays = function (year, month) {
    if (month === 2 && this.isSolarIntercalationYear(this.getLunarData(year))) {
      return LUNAR_CALENDAR_DATA.SOLAR_DAYS[12];
    }
    return LUNAR_CALENDAR_DATA.SOLAR_DAYS[month - 1];
  };

  KoreanLunarCalendar.prototype.getSolarDaysBeforeBaseYear = function (year) {
    return this.accumulateYearDays(year, this.cumulativeSolarYearDays, function (y) {
      return this.getSolarYearDays(y);
    }.bind(this));
  };

  KoreanLunarCalendar.prototype.accumulateYearDays = function (year, cache, perYear) {
    if (cache[year] !== undefined) return cache[year];
    var baseYear = LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR;
    var previous = cache[year - 1];
    var days = 0;
    if (previous !== undefined && year > baseYear) {
      days = previous + perYear(year);
    } else {
      for (var y = baseYear; y < year + 1; y++) {
        days += perYear(y);
      }
    }
    cache[year] = days;
    return days;
  };

  KoreanLunarCalendar.prototype.getSolarDaysBeforeBaseMonth = function (year, month) {
    var days = 0;
    for (var baseMonth = 1; baseMonth < month + 1; baseMonth++) {
      days += this.getSolarMonthDays(year, baseMonth);
    }
    return days;
  };

  KoreanLunarCalendar.prototype.getSolarAbsDays = function (year, month, day) {
    return (
      this.getSolarDaysBeforeBaseYear(year - 1) +
      this.getSolarDaysBeforeBaseMonth(year, month - 1) +
      day -
      LUNAR_CALENDAR_DATA.SOLAR_LUNAR_DAY_DIFF
    );
  };

  KoreanLunarCalendar.prototype.setSolarDateByLunarDate = function (lunarYear, lunarMonth, lunarDay, isIntercalation) {
    var absDays = this.getLunarAbsDays(lunarYear, lunarMonth, lunarDay, isIntercalation);
    var solarYear =
      absDays < this.getSolarAbsDays(lunarYear + 1, 1, 1) ? lunarYear : lunarYear + 1;
    var solarMonth = 0;
    var solarDay = 0;
    for (var month = 12; month > 0; month--) {
      var absDaysByMonth = this.getSolarAbsDays(solarYear, month, 1);
      if (absDays >= absDaysByMonth) {
        solarMonth = month;
        solarDay = absDays - absDaysByMonth + 1;
        break;
      }
    }
    this.solarCalendar = { year: solarYear, month: solarMonth, day: solarDay };
  };

  KoreanLunarCalendar.prototype.setLunarDateBySolarDate = function (solarYear, solarMonth, solarDay) {
    var absDays = this.getSolarAbsDays(solarYear, solarMonth, solarDay);
    var lunarYear =
      absDays >= this.getLunarAbsDays(solarYear, 1, 1, false) ? solarYear : solarYear - 1;
    var lunarMonth = 0;
    var lunarDay = 0;
    var isIntercalation = false;
    for (var month = 12; month > 0; month--) {
      var absDaysByMonth = this.getLunarAbsDays(lunarYear, month, 1, false);
      if (absDays >= absDaysByMonth) {
        lunarMonth = month;
        if (this.getLunarIntercalationMonth(this.getLunarData(lunarYear)) === month) {
          isIntercalation = absDays >= this.getLunarAbsDays(lunarYear, month, 1, true);
        }
        lunarDay = absDays - this.getLunarAbsDays(lunarYear, lunarMonth, 1, isIntercalation) + 1;
        break;
      }
    }
    this.lunarCalendar = { year: lunarYear, month: lunarMonth, day: lunarDay, intercalation: isIntercalation };
  };

  KoreanLunarCalendar.prototype.checkValidDate = function (isLunar, isIntercalation, year, month, day) {
    var isValid = false;
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return false;
    }
    var dateValue = year * 10000 + month * 100 + day;
    if (
      (isLunar ? LUNAR_CALENDAR_DATA.KOREAN_LUNAR_MIN_VALUE : LUNAR_CALENDAR_DATA.KOREAN_SOLAR_MIN_VALUE) <= dateValue &&
      (isLunar ? LUNAR_CALENDAR_DATA.KOREAN_LUNAR_MAX_VALUE : LUNAR_CALENDAR_DATA.KOREAN_SOLAR_MAX_VALUE) >= dateValue
    ) {
      if (month > 0 && month < 13 && day > 0) {
        if (isLunar && isIntercalation && this.getLunarIntercalationMonth(this.getLunarData(year)) !== month) {
          return false;
        }
        var dayLimit = isLunar
          ? this.getLunarMonthDays(year, month, isIntercalation)
          : this.getSolarMonthDays(year, month);
        // 1582.10.5~10.14는 그레고리력 개정으로 결번(양력 전용)
        if (!isLunar && year === 1582 && month === 10 && day > 4 && day < 15) {
          return false;
        }
        if (day <= dayLimit) isValid = true;
      }
    }
    return isValid;
  };

  KoreanLunarCalendar.prototype.setLunarDate = function (lunarYear, lunarMonth, lunarDay, isIntercalation) {
    var isValid = false;
    if (this.checkValidDate(true, isIntercalation, lunarYear, lunarMonth, lunarDay)) {
      this.lunarCalendar = {
        year: lunarYear,
        month: lunarMonth,
        day: lunarDay,
        intercalation:
          isIntercalation && this.getLunarIntercalationMonth(this.getLunarData(lunarYear)) === lunarMonth,
      };
      this.setSolarDateByLunarDate(lunarYear, lunarMonth, lunarDay, isIntercalation);
      isValid = true;
    }
    return isValid;
  };

  KoreanLunarCalendar.prototype.setSolarDate = function (solarYear, solarMonth, solarDay) {
    var isValid = false;
    if (this.checkValidDate(false, false, solarYear, solarMonth, solarDay)) {
      this.solarCalendar = { year: solarYear, month: solarMonth, day: solarDay };
      this.setLunarDateBySolarDate(solarYear, solarMonth, solarDay);
      isValid = true;
    }
    return isValid;
  };

  KoreanLunarCalendar.prototype.computeGapJa = function () {
    var lunar = this.lunarCalendar;
    var absDays = this.getLunarAbsDays(lunar.year, lunar.month, lunar.day, !!lunar.intercalation);
    if (absDays <= 0) {
      return { cheongan: { year: 0, month: 0, day: 0 }, ganji: { year: 0, month: 0, day: 0 } };
    }
    var baseYear = LUNAR_CALENDAR_DATA.KOREAN_LUNAR_BASE_YEAR;
    var cheonganLen = LUNAR_CALENDAR_DATA.KOREAN_CHEONGAN.length;
    var ganjiLen = LUNAR_CALENDAR_DATA.KOREAN_GANJI.length;
    var monthCount = lunar.month + 12 * (lunar.year - baseYear);
    return {
      cheongan: {
        year: (lunar.year + GAPJA_OFFSET.YEAR_CHEONGAN - baseYear) % cheonganLen,
        month: (monthCount + GAPJA_OFFSET.MONTH_CHEONGAN) % cheonganLen,
        day: (absDays + GAPJA_OFFSET.DAY_CHEONGAN) % cheonganLen,
      },
      ganji: {
        year: (lunar.year + GAPJA_OFFSET.YEAR_GANJI - baseYear) % ganjiLen,
        month: (monthCount + GAPJA_OFFSET.MONTH_GANJI) % ganjiLen,
        day: (absDays + GAPJA_OFFSET.DAY_GANJI) % ganjiLen,
      },
    };
  };

  KoreanLunarCalendar.prototype.getGapJaIndex = function () { return this.computeGapJa(); };
  KoreanLunarCalendar.prototype.getLunarCalendar = function () {
    var l = this.lunarCalendar;
    return { year: l.year, month: l.month, day: l.day, intercalation: l.intercalation };
  };
  KoreanLunarCalendar.prototype.getSolarCalendar = function () {
    var s = this.solarCalendar;
    return { year: s.year, month: s.month, day: s.day };
  };

  // ================================================================
  // SECTION 2. 육십갑자(六十甲子) 조견표 — 태세수·월건수·일진수
  //   출처: CHUNUN.COM "토정비결 조견표"(수기 정리표). 배열 색인 i(0~59)는 표준
  //   60갑자 순서(0=갑자, 1=을축, ... 59=계해) — 천간=i%10, 지지=i%12.
  //   [태세수, 월건수, 일진수] — 8행(신유)·9행(임술)은 라벨 오타 정정(위 헤더 설명 참고).
  // ================================================================
  var SIXTY_GAPJA_TABLE = [
    /* 0  갑자 */ [20, 18, 18],
    /* 1  을축 */ [20, 16, 19],
    /* 2  병인 */ [17, 14, 15],
    /* 3  정묘 */ [16, 12, 14],
    /* 4  무진 */ [18, 10, 16],
    /* 5  기사 */ [18, 13, 16],
    /* 6  경오 */ [17, 17, 15],
    /* 7  신미 */ [20, 15, 18],
    /* 8  임신 */ [18, 13, 16],
    /* 9  계유 */ [17, 11, 15],
    /* 10 갑술 */ [22, 14, 20],
    /* 11 을해 */ [19, 12, 17],
    /* 12 병자 */ [18, 16, 16],
    /* 13 정축 */ [19, 14, 17],
    /* 14 무인 */ [15, 12, 13],
    /* 15 기묘 */ [19, 15, 17],
    /* 16 경진 */ [21, 13, 19],
    /* 17 신사 */ [16, 11, 14],
    /* 18 임오 */ [15, 15, 13],
    /* 19 계미 */ [18, 13, 16],
    /* 20 갑신 */ [21, 16, 19],
    /* 21 을유 */ [20, 14, 18],
    /* 22 병술 */ [20, 12, 18],
    /* 23 정해 */ [17, 10, 15],
    /* 24 무자 */ [16, 14, 14],
    /* 25 기축 */ [22, 17, 20],
    /* 26 경인 */ [18, 15, 16],
    /* 27 신묘 */ [17, 13, 15],
    /* 28 임진 */ [19, 11, 17],
    /* 29 계사 */ [14, 9, 12],
    /* 30 갑오 */ [18, 18, 16],
    /* 31 을미 */ [21, 16, 19],
    /* 32 병신 */ [19, 14, 17],
    /* 33 정유 */ [18, 12, 16],
    /* 34 무술 */ [18, 10, 16],
    /* 35 기해 */ [20, 13, 18],
    /* 36 경자 */ [19, 17, 17],
    /* 37 신축 */ [20, 15, 18],
    /* 38 임인 */ [16, 13, 14],
    /* 39 계묘 */ [15, 11, 13],
    /* 40 갑진 */ [22, 14, 20],
    /* 41 을사 */ [17, 12, 15],
    /* 42 병오 */ [16, 16, 14],
    /* 43 정미 */ [19, 14, 17],
    /* 44 무신 */ [17, 12, 15],
    /* 45 기유 */ [21, 15, 19],
    /* 46 경술 */ [21, 13, 19],
    /* 47 신해 */ [18, 11, 16],
    /* 48 임자 */ [17, 15, 15],
    /* 49 계축 */ [18, 13, 16],
    /* 50 갑인 */ [19, 16, 17],
    /* 51 을묘 */ [18, 14, 16],
    /* 52 병진 */ [20, 12, 18],
    /* 53 정사 */ [15, 10, 13],
    /* 54 무오 */ [14, 14, 12],
    /* 55 기미 */ [22, 17, 20],
    /* 56 경신 */ [20, 15, 18],
    /* 57 신유 */ [19, 13, 17], // 라벨 정정(원본 "辛卯" 중복 표기 → 정순서상 辛酉)
    /* 58 임술 */ [19, 11, 17], // 라벨 정정(원본 "壬辰" 중복 표기 → 정순서상 壬戌)
    /* 59 계해 */ [16, 9, 14],
  ];

  var PAIR_TO_INDEX = {};
  for (var _i = 0; _i < 60; _i++) {
    PAIR_TO_INDEX[(_i % 10) + '_' + (_i % 12)] = _i;
  }
  function idx60FromPair(cheonganIdx, ganjiIdx) {
    var key = cheonganIdx + '_' + ganjiIdx;
    var idx = PAIR_TO_INDEX[key];
    if (idx === undefined) {
      throw new Error('잘못된 간지 조합입니다: cheongan=' + cheonganIdx + ', ganji=' + ganjiIdx);
    }
    return idx;
  }
  function gapjaName(idx) {
    return LUNAR_CALENDAR_DATA.KOREAN_CHEONGAN[idx % 10] + LUNAR_CALENDAR_DATA.KOREAN_GANJI[idx % 12];
  }
  function gapjaNameHanja(idx) {
    return LUNAR_CALENDAR_DATA.CHINESE_CHEONGAN[idx % 10] + LUNAR_CALENDAR_DATA.CHINESE_GANJI[idx % 12];
  }

  // ================================================================
  // SECTION 3. 상괘·중괘·하괘 작괘(作卦) 로직
  // ================================================================

  /**
   * 토정비결 괘 산출 + (있는 경우) 해석문을 반환한다.
   * @param {Object} opts
   *   opts.year, opts.month, opts.day : 생년월일 숫자
   *   opts.lunar : true(기본값)면 위 년월일을 음력으로, false면 양력으로 해석
   *   opts.leap  : lunar=true일 때 그 달이 윤달(閏月)이면 true (기본 false)
   *   opts.targetYear : 신수를 볼 연도(양력 연도 숫자, 필수) — 예: 2026
   * @returns {Object} 결과 (아래 SECTION 3 하단 반환 형태 주석 참고)
   */
  function compute(opts) {
    opts = opts || {};
    var year = opts.year, month = opts.month, day = opts.day;
    var lunar = opts.lunar !== false; // 기본값 true(음력 입력)
    var leap = !!opts.leap;
    var targetYear = opts.targetYear;
    var notes = [];

    if (!targetYear || !Number.isInteger(targetYear)) {
      throw new Error('targetYear(신수를 볼 연도)를 숫자로 지정해야 합니다. 예: targetYear: 2026');
    }
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      throw new Error('year, month, day는 정수여야 합니다.');
    }

    // 1) 생년월일 확정 (입력이 양력이면 음력으로 변환)
    var birthCal = new KoreanLunarCalendar();
    var birthOk = lunar
      ? birthCal.setLunarDate(year, month, day, leap)
      : birthCal.setSolarDate(year, month, day);
    if (!birthOk) {
      throw new Error(
        '유효하지 않은 생년월일입니다(지원 범위: 음력 1000-01-01~2050-11-18 / 양력 1000-02-13~2050-12-31). 입력: ' +
          JSON.stringify(opts)
      );
    }
    var lunarBirth = birthCal.getLunarCalendar(); // {year, month, day, intercalation}

    // 2) 나이(한국 나이, 세는나이) = 대상연도 - 태어난 음력 연도 + 1
    var age = targetYear - lunarBirth.year + 1;
    if (age < 1) {
      throw new Error('targetYear(' + targetYear + ')가 태어난 음력 연도(' + lunarBirth.year + ')보다 앞섭니다.');
    }

    // 3) 연간지(태세) — 대상연도의 세차(歲次). 음력 새해(1/1) 아무 날이나 세팅해도 연 정보는 동일.
    var yearCal = new KoreanLunarCalendar();
    if (!yearCal.setLunarDate(targetYear, 1, 1, false)) {
      throw new Error('targetYear(' + targetYear + ')가 지원 범위를 벗어났습니다(1000~2050).');
    }
    var yearGapja = yearCal.getGapJaIndex();
    var yearIdx60 = idx60FromPair(yearGapja.cheongan.year, yearGapja.ganji.year);
    var taeseSu = SIXTY_GAPJA_TABLE[yearIdx60][0];

    // 4) 월건 — 대상연도의 [생월]월. 생일이 윤달생이면 그 윤달이 대상연도에도 있는지 확인.
    var monthIsIntercalation = !!lunarBirth.intercalation;
    var monthCal = new KoreanLunarCalendar();
    var monthOk = monthCal.setLunarDate(targetYear, lunarBirth.month, 1, monthIsIntercalation);
    if (!monthOk && monthIsIntercalation) {
      // 대상연도에는 그 윤달이 없는 경우 — 평달로 대체(전통적으로 흔히 쓰는 대체 관습, 근사치)
      notes.push(
        '생일이 윤' + lunarBirth.month + '월인데 ' + targetYear + '년에는 같은 윤달이 없어 평달(' +
          lunarBirth.month + '월) 기준으로 근사 계산했습니다.'
      );
      monthIsIntercalation = false;
      monthOk = monthCal.setLunarDate(targetYear, lunarBirth.month, 1, false);
    }
    if (!monthOk) {
      throw new Error('월건 계산에 실패했습니다(targetYear=' + targetYear + ', month=' + lunarBirth.month + ').');
    }
    var monthGapja = monthCal.getGapJaIndex();
    var monthIdx60 = idx60FromPair(monthGapja.cheongan.month, monthGapja.ganji.month);
    var wolgeonSu = SIXTY_GAPJA_TABLE[monthIdx60][1];

    // 5) 그 해(대상연도) 생월의 대소월(29일/30일) — 중괘 계산의 '음력월 달수'
    var monthDayCount = monthCal.getLunarMonthDays(targetYear, lunarBirth.month, monthIsIntercalation);

    // 6) 일진 — 대상연도의 [생월,생일]
    var dayCal = new KoreanLunarCalendar();
    var dayOk = dayCal.setLunarDate(targetYear, lunarBirth.month, lunarBirth.day, monthIsIntercalation);
    if (!dayOk) {
      // 생일이 대소월 경계를 넘는 극히 드문 경우(예: 생일 30일인데 그 해엔 29일까지만 있음) 마지막 날로 보정
      notes.push('대상연도의 생월 일수 범위를 벗어나 마지막 날로 보정했습니다.');
      dayOk = dayCal.setLunarDate(targetYear, lunarBirth.month, monthDayCount, monthIsIntercalation);
    }
    var dayGapja = dayCal.getGapJaIndex();
    var dayIdx60 = idx60FromPair(dayGapja.cheongan.day, dayGapja.ganji.day);
    var iljinSu = SIXTY_GAPJA_TABLE[dayIdx60][2];

    // 7) 상괘·중괘·하괘 (나머지가 0이면 각 모듈러스 값으로 치환)
    var sanggwe = (age + taeseSu) % 8; if (sanggwe === 0) sanggwe = 8;
    var junggwe = (monthDayCount + wolgeonSu) % 6; if (junggwe === 0) junggwe = 6;
    var hagwe = (lunarBirth.day + iljinSu) % 3; if (hagwe === 0) hagwe = 3;
    var gwaeNumber = '' + sanggwe + junggwe + hagwe;

    var gwaeData = GWAE_DATA[gwaeNumber] || null;

    return {
      입력: { year: year, month: month, day: day, lunar: lunar, leap: leap, targetYear: targetYear },
      나이: age,
      음력생일: { 년: lunarBirth.year, 월: lunarBirth.month, 일: lunarBirth.day, 윤달: !!lunarBirth.intercalation },
      상괘: sanggwe,
      중괘: junggwe,
      하괘: hagwe,
      괘번호: gwaeNumber,
      총운: gwaeData ? gwaeData.korean || null : null,
      월별운: gwaeData ? gwaeData.monthly || new Array(12).fill(null) : new Array(12).fill(null),
      detail: {
        태세수: taeseSu, 월건수: wolgeonSu, 일진수: iljinSu,
        연간지: gapjaName(yearIdx60) + '(' + gapjaNameHanja(yearIdx60) + ')',
        월간지: gapjaName(monthIdx60) + '(' + gapjaNameHanja(monthIdx60) + ')',
        일진: gapjaName(dayIdx60) + '(' + gapjaNameHanja(dayIdx60) + ')',
        대상연도_생월_대소: monthDayCount === 30 ? '큰달(30일)' : '작은달(29일)',
        해석문_확보여부: !!gwaeData,
        notes: notes,
      },
    };
  }

  // ================================================================
  // SECTION 4. 144괘 해석문 데이터 (스텁 — 완성도: 1/144, 정직하게 미완성 표기)
  //   키: "상중하" 3자리 문자열(예: "212"). 값: { hanja, korean, source, monthly }
  //   ⚠ 방대한 문헌 데이터라 이번 조사에서는 "111" 총운 한문 원문 1건만 확보했다.
  //   korean(한글 해석)은 정확한 번역 검증이 안 됐으므로 비워뒀다 — 별도 국역 대조 후 채울 것.
  //   monthly(1~12월 월별운)는 144괘 전체 미확보 — 전부 null.
  //   나머지 143개 괘는 키 자체가 없다(완전 미입력) — GWAE_DATA['상중하'] 조회 시 undefined.
  // ================================================================
  var GWAE_DATA = {
    "111": {
      hanja: "東風解凍 枯木逢春 小往大來 積小成大 災消福來 心神自安 月明中天 天地明朗 春回故國 百草回生 卯月之中 必生貴子 君謀大事 何必疑慮 若逢貴人 身榮家安 春雖小通 勞力恒大",
      korean: null, // 미검증 — 한문 원문만 확보(아래 source), 정확한 국역 별도 확보 필요
      source: "https://theinfomoa.com/무료-토정비결-괘-111-유변화지의(有變化之意)/ (검색 결과 인용, 2026-07 조사)",
      monthly: new Array(12).fill(null),
    },
    // "212" 등 나머지 143개 괘 — 별도 문헌 조사로 채워야 함 (구조는 완성, 데이터만 비어 있음)
  };

  // ================================================================
  // SECTION 5. 공개 API 내보내기
  // ================================================================
  var Toitjeong = {
    version: '1.0.0',
    compute: compute,
    // 저수준 유틸(디버그·검증·해석문 데이터 추가 작업용)
    utils: {
      KoreanLunarCalendar: KoreanLunarCalendar,
      SIXTY_GAPJA_TABLE: SIXTY_GAPJA_TABLE,
      idx60FromPair: idx60FromPair,
      gapjaName: gapjaName,
      gapjaNameHanja: gapjaNameHanja,
    },
    GWAE_DATA: GWAE_DATA,
  };

  return Toitjeong;
});
