# -*- coding: utf-8 -*-
"""체중관리매니저 원클릭 배포 스크립트 (2026-07-26 GG 승인 — 원본노출 사고 재발방지).

배경: 배포 체인에서 `grep -c`(0건=exit 1)가 && 체인을 끊어 난독화 승격(cp index.obf.html index.html)이
누락된 채 읽기가능 원본이 index.html로 커밋·push돼 5분간 노출된 사고가 있었다(force push로 제거).
기존 방어는 `.git/hooks/pre-commit` 하나뿐인데 로컬 훅이라 새 PC 이전 시 사라진다.

이 스크립트는 배포 전 과정을 하나의 원자적 파이프라인으로 묶고, 각 단계 실패 시
즉시 중단 + index.html을 실행 전 상태로 원상복구한다. 또한 pre-commit 훅이 없으면
스스로 설치해 새 PC에서도 `_deploy.py` 하나만 있으면 방어가 복원되도록 한다.

흐름:
  ① 소스 확인 — index.html.bak이 읽기가능 원본인지 확인 (_0x 없어야 함)
  ② index.html.bak → index.html 복사(_obfuscate_build.py의 SRC 고정값이 index.html이므로
     여기서 원본을 그 자리에 놓아준 뒤 빌드 실행) → index.obf.html 생성
  ③ _obf_verify.py 실행 — 원본 vs 난독화본 JS에러 프로필 비교, 통과해야 다음 단계로
  ④ index.obf.html → index.html 승격
  ⑤ 승격 검증 — index.html에 _0x 존재 + 파일크기가 index.obf.html과 동일
  ⑥ git add index.html + saju/*.obf.js(빌드가 함께 갱신) + git commit (-m 메시지, Co-Authored-By 자동 첨부)
  ⑦ git push — --push 플래그가 있을 때만
  ⑧ 위 어느 단계든 실패하면 index.html·saju/*.obf.js를 스크립트 시작 시점 상태로 원상복구 후 중단

사용법:
  python _deploy.py -m "커밋 메시지"              # 로컬 커밋까지
  python _deploy.py -m "커밋 메시지" --push        # 커밋 + push
  python _deploy.py -m "테스트" --dry-run          # 빌드·검증·승격검증까지 실행하되
                                                     # git add/commit/push는 생략하고
                                                     # index.html을 실행 전 상태로 복원
"""
import argparse
import os
import shutil
import subprocess
import sys

sys.stdout.reconfigure(encoding="utf-8")

REPO = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(REPO, "index.html")
BAK = os.path.join(REPO, "index.html.bak")
OBF = os.path.join(REPO, "index.obf.html")
OBF_BUILD_SCRIPT = os.path.join(REPO, "_obfuscate_build.py")
OBF_VERIFY_SCRIPT = os.path.join(REPO, "_obf_verify.py")
HOOK_PATH = os.path.join(REPO, ".git", "hooks", "pre-commit")

# 🔴 _obfuscate_build.py는 index.obf.html뿐 아니라 saju/*.obf.js 3개도 git 추적 대상 파일에
# 직접 덮어쓴다(승격 이전 단계에서 바로). 롤백·커밋 모두 이 파일들까지 함께 다뤄야
# "워킹트리 원상복구"·"배포 커밋"이 실제로 완결된다 (실측 중 발견 — saju obf.js가
# 빌드마다 랜덤 회전으로 바뀌는데 index.html만 되돌리면 이 3개가 M 상태로 남는 사고).
SAJU_OBF_REL = ["saju/saju_engine.obf.js", "saju/toitjeong.obf.js", "saju/saju_ui.obf.js"]

# 🔴 기존 .git/hooks/pre-commit과 100% 동일한 내용 — 새 PC에서 훅이 없을 때 이걸로 복원한다.
PRE_COMMIT_HOOK_CONTENT = (
    "#!/bin/sh\n"
    "# \U0001F534 카피방어 가드 (2026-07-26 사고 재발방지): index.html은 반드시 난독화본만 커밋 가능.\n"
    "# 사고: 배포 체인에서 grep -c exit 1로 && 체인이 끊겨 난독화 승격(cp index.obf.html index.html)이\n"
    "# 누락된 채 읽기가능 원본이 커밋·push됨(5분 노출, force push로 히스토리 제거).\n"
    "# 판정: 스테이징된 index.html에 난독화 식별자(_0x)가 없으면 원본 소스로 간주하고 커밋 거부.\n"
    "if git diff --cached --name-only | grep -qx \"index.html\"; then\n"
    "  if ! git show :index.html | grep -q \"_0x\"; then\n"
    "    echo \"COMMIT BLOCKED: index.html이 난독화본이 아님 (_0x 식별자 없음)\"\n"
    "    echo \"  → cp index.obf.html index.html 로 승격 후 다시 커밋하세요.\"\n"
    "    echo \"  (읽기가능 소스는 index.html.bak에 보존, 빌드는 _obfuscate_build.py)\"\n"
    "    exit 1\n"
    "  fi\n"
    "fi\n"
    "exit 0\n"
)


class DeployError(Exception):
    """배포 파이프라인 중단 사유를 담는 예외."""


def log(msg):
    print(msg, flush=True)


def ensure_pre_commit_hook():
    """.git/hooks/pre-commit이 없으면 설치한다 (있으면 손대지 않음 — 새 PC 이전 시 방어 복원용)."""
    if os.path.exists(HOOK_PATH):
        log("① pre-commit 훅 이미 존재 — 그대로 둠")
        return
    os.makedirs(os.path.dirname(HOOK_PATH), exist_ok=True)
    with open(HOOK_PATH, "w", encoding="utf-8", newline="\n") as f:
        f.write(PRE_COMMIT_HOOK_CONTENT)
    try:
        os.chmod(HOOK_PATH, 0o755)
    except OSError:
        pass  # Windows에서는 무의미할 수 있음 — 무시
    log("① pre-commit 훅 없어서 신규 설치 완료")


def read_bytes(path):
    with open(path, "rb") as f:
        return f.read()


def write_bytes(path, data):
    with open(path, "wb") as f:
        f.write(data)


def managed_artifact_paths():
    """빌드가 직접 덮어쓰는 '트래킹된' 산출물 절대경로 목록 — index.html + saju obf.js(존재하는 것만).
    index.obf.html은 git 미추적 스크래치 산출물이라 제외(원상복구·커밋 대상 아님)."""
    paths = [INDEX]
    for rel in SAJU_OBF_REL:
        p = os.path.join(REPO, *rel.split("/"))
        if os.path.exists(p):
            paths.append(p)
    return paths


def verify_source():
    """index.html.bak이 읽기가능 원본인지 확인 — _0x(난독화 식별자)가 있으면 중단."""
    if not os.path.exists(BAK):
        raise DeployError(f"index.html.bak이 없습니다 (경로: {BAK}) — 원본 소스를 준비하세요.")
    data = read_bytes(BAK)
    if b"_0x" in data:
        raise DeployError(
            "index.html.bak에 '_0x' 식별자가 발견됨 — 원본이 아니라 난독화본으로 보입니다. "
            "배포를 중단합니다(원본을 잘못 덮어썼을 가능성)."
        )
    log(f"① 소스 확인 OK — index.html.bak은 읽기가능 원본 ({len(data)//1024}KB, _0x 없음)")


def run_obf_build():
    """_obfuscate_build.py 실행 (현재 index.html을 SRC로 읽어 index.obf.html 생성)."""
    return subprocess.run(
        [sys.executable, OBF_BUILD_SCRIPT], cwd=REPO,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def run_obf_verify():
    """_obf_verify.py 실행 (index.html vs index.obf.html JS에러 프로필 비교)."""
    return subprocess.run(
        [sys.executable, OBF_VERIFY_SCRIPT], cwd=REPO,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )


def verify_promotion():
    """승격 후 index.html이 실제로 난독화본인지 확인 (_0x 존재 + obf와 크기 동일)."""
    data = read_bytes(INDEX)
    if b"_0x" not in data:
        raise DeployError("승격 후 index.html에 '_0x' 식별자가 없습니다 — 난독화 승격 실패로 판단.")
    obf_size = os.path.getsize(OBF)
    idx_size = os.path.getsize(INDEX)
    if obf_size != idx_size:
        raise DeployError(
            f"승격 후 파일크기 불일치 — index.html={idx_size}bytes, index.obf.html={obf_size}bytes"
        )
    log(f"⑤ 승격 검증 OK — index.html에 _0x 존재, 크기 일치({idx_size:,}bytes)")


def deploy(message, dry_run=False, push=False, build_fn=run_obf_build, verify_fn=run_obf_verify):
    """전체 배포 파이프라인. build_fn/verify_fn은 실패주입 테스트용 주입 지점(기본은 실제 스크립트 호출)."""
    ensure_pre_commit_hook()

    # ① — 여기서 실패하면 index.html은 아직 전혀 건드리지 않은 상태이므로 복구 불필요
    verify_source()

    # 롤백용 백업 — 스크립트 시작 시점(=현재 배포된 상태)의 index.html + saju obf.js 3종
    managed = managed_artifact_paths()
    originals = {p: read_bytes(p) for p in managed}
    try:
        # ② .bak(읽기가능 원본) → index.html 배치 후 빌드
        shutil.copyfile(BAK, INDEX)
        log("② index.html.bak → index.html 복사 완료 (빌드용 소스 배치)")
        r = build_fn()
        if r.stdout:
            log(r.stdout.strip())
        if r.returncode != 0 or not os.path.exists(OBF):
            if r.stderr:
                log(r.stderr.strip())
            raise DeployError(f"_obfuscate_build.py 실패 (returncode={r.returncode})")
        log("② _obfuscate_build.py 실행 완료 — index.obf.html 생성됨")

        # ③ 검증 — 통과 판정 문자열이 있어야만 다음 단계 진행
        r = verify_fn()
        if r.stdout:
            log(r.stdout.strip())
        if r.returncode != 0 or "✅" not in r.stdout or "❌" in r.stdout:
            if r.stderr:
                log(r.stderr.strip())
            raise DeployError("_obf_verify.py 검증 실패 — '✅ 통과' 판정을 확인하지 못함")
        log("③ _obf_verify.py 검증 통과")

        # ④ 승격
        shutil.copyfile(OBF, INDEX)
        log("④ index.obf.html → index.html 승격 완료")

        # ⑤ 승격 검증
        verify_promotion()

        if dry_run:
            for p, data in originals.items():
                write_bytes(p, data)
            log("\U0001F535 DRY RUN — index.html+saju obf.js를 실행 전 상태로 원상복구, git add/commit/push는 생략")
            return True

        # ⑥ git add + commit (index.html + saju obf.js 3종, 빌드가 함께 갱신한 산출물 전부)
        rel_paths = [os.path.relpath(p, REPO).replace("\\", "/") for p in managed]
        subprocess.run(["git", "add"] + rel_paths, cwd=REPO, check=True)
        no_change = subprocess.run(
            ["git", "diff", "--cached", "--quiet", "--"] + rel_paths, cwd=REPO
        ).returncode == 0
        if no_change:
            log("⑥ 기존 커밋과 동일 — 변경사항 없음, 커밋 생략")
        else:
            full_msg = message + "\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
            subprocess.run(["git", "commit", "-m", full_msg], cwd=REPO, check=True)
            log(f"⑥ git commit 완료 ({', '.join(rel_paths)}): {message}")

        # ⑦ push (플래그가 있을 때만)
        if push:
            subprocess.run(["git", "push"], cwd=REPO, check=True)
            log("⑦ git push 완료")
        else:
            log("⑦ --push 미지정 — push 생략 (로컬 커밋까지만)")

        return True

    except Exception:
        for p, data in originals.items():
            write_bytes(p, data)
        log("\U0001F519 실패 감지 — index.html+saju obf.js를 실행 전 상태로 원상복구 완료")
        raise


def main():
    ap = argparse.ArgumentParser(description="체중관리매니저 원클릭 배포 (난독화 빌드→검증→승격→커밋)")
    ap.add_argument("-m", "--message", required=True, help="git 커밋 메시지")
    ap.add_argument("--dry-run", action="store_true", help="git add/commit/push 생략, 나머지 전 단계 실행 후 원상복구")
    ap.add_argument("--push", action="store_true", help="커밋 후 git push까지 실행")
    args = ap.parse_args()

    try:
        deploy(args.message, dry_run=args.dry_run, push=args.push)
    except DeployError as e:
        log(f"\U0001F6D1 배포 중단: {e}")
        sys.exit(1)
    except Exception as e:
        log(f"\U0001F6D1 예기치 못한 오류로 배포 중단: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
