# Firestore 보안규칙 배포 가이드

이 문서는 `firestore.rules`를 Firebase 프로젝트(`goodgodpeptide`)에 배포하는 방법을 설명합니다.

## 왜 필요한가
- 기존: 모든 권한 검증이 클라이언트 UI 가림(`currentUserIsAdmin` 변수)에만 의존
- 문제: 브라우저 콘솔 1줄 (`currentUserIsAdmin = true`)로 admin 셀프승격 가능 → 누구나 사용자 승인/거절, 후원 등록, 명예의전당 조작 가능
- 해결: Firestore Rules가 서버측에서 최종 차단. 클라이언트 가드는 UX 안내일 뿐.

## 방법 1: Firebase Console (권장 — 빠름)

1. 콘솔 접속
   - https://console.firebase.google.com/project/goodgodpeptide/firestore/rules
2. "Rules" 탭 클릭
3. 기존 규칙을 백업 (텍스트 복사 → 로컬 메모장에 붙여넣기) — 롤백용
4. `firestore.rules` 파일 내용을 그대로 붙여넣기
5. 우측 상단 **"게시(Publish)"** 클릭
6. 게시 후 `Last published` 시각 확인

## 방법 2: Firebase CLI

처음 한 번만:
```bash
npm install -g firebase-tools
firebase login
cd goodgodpeptide.github.io
firebase init firestore   # 기존 firestore.rules를 그대로 사용 선택
```

이후 배포:
```bash
firebase deploy --only firestore:rules
```

## 배포 전 시뮬레이터 테스트 (권장)

Firebase Console > Firestore > Rules > **Rules Playground** 탭에서:

테스트 케이스 예시:
| 시나리오 | 위치 | 작업 | 인증 | 기대 결과 |
|---|---|---|---|---|
| 비관리자가 admin 추가 시도 | `/config/admins` | update | 일반 사용자 | ❌ 차단 |
| 관리자가 사용자 승인 | `/config/approved_users` | update | 관리자 | ✅ 허용 |
| 타인 UID로 데이터 조회 | `/users/OTHER_UID` | read | 일반 사용자 | ❌ 차단 |
| 본인 UID로 데이터 조회 | `/users/MY_UID` | read | 로그인 사용자 | ✅ 허용 |
| 타인 게시글 수정 | `/posts/{id}` | update (likes 외 필드) | 일반 사용자 | ❌ 차단 |
| 좋아요 토글 | `/posts/{id}` | update (likes만) | 승인 사용자 | ✅ 허용 |
| 후원 직접 명예등록 시도 | `/config/hall_of_fame` | write | 일반 사용자 | ❌ 차단 |

## 배포 후 확인
1. 브라우저 시크릿창에서 비관리자 계정 로그인
2. 콘솔에서 `currentUserIsAdmin = true` 입력 (셀프승격 시도)
3. 관리자 패널 진입 시도 → DOM에는 보일 수 있으나
4. `approveUser('test@x.com')` 호출 → **Firestore Rules가 권한 없음으로 거부**되어야 정상

## 롤백
배포 후 문제 발생 시 Firebase Console > Rules 탭 > 우측 상단 시계 아이콘 → 이전 버전 선택 → 게시.

## 주의사항
- 규칙 게시 직후 Firebase 측 캐시로 인해 5초~수 분간 과도기 발생 가능
- 첫 배포 후 사용자 일부가 "Permission denied" 에러를 보일 수 있음 → 이는 의도된 동작
- 관리자(`config/admins.emails`)에 본인 이메일이 포함돼 있는지 배포 전 반드시 확인 (안 그러면 본인도 잠김)
