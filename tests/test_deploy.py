"""실제 임시 Git 저장소로 공개 배포 자산과 실패 복구를 검증한다. 원격 호출 없음."""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("deploy_under_test", ROOT / "_deploy.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


class DeployTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="weight-release-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init")
        self.git("config", "user.email", "audit@example.test")
        self.git("config", "user.name", "격리 배포 검사")
        self.git("config", "core.autocrlf", "false")
        for name, text in {
            "index.html": "old _0x artifact\n",
            "extra.js": "export const version = 'old';\n",
            "sw.js": "const RELEASE_VERSION = 'test-v1';\nconst CACHE_NAME = 'old';\n"
                     "const STATIC_ASSETS = ['./index.html', './extra.js'];\n"
                     "const ASSET_HASHES = /* BUILD_HASHES_START */ {} /* BUILD_HASHES_END */;\n",
            "_obfuscate_build.py": "# 별도 제공 원본 빌더\n",
            "_obf_verify.py": "# 별도 제공 검증기\n",
            "update.html": "<html>update</html>\n",
            "app_update.js": "export const recoverApp = () => {};\n",
        }.items():
            (self.root / name).write_text(text, encoding="utf-8")
        (self.root / ".well-known").mkdir()
        (self.root / ".well-known/assetlinks.json").write_text("[]\n", encoding="utf-8")
        (self.root / "scripts").mkdir()
        shutil.copyfile(ROOT / "scripts/build_offline_manifest.mjs", self.root / "scripts/build_offline_manifest.mjs")
        subprocess.run(["node", "scripts/build_offline_manifest.mjs"], cwd=self.root, check=True, capture_output=True)
        self.git("add", ".")
        self.git("commit", "-m", "초기 배포")
        (self.root / "index.html.bak").write_text("readable original", encoding="utf-8")
        for name, value in {
            "REPO": str(self.root), "INDEX": str(self.root / "index.html"),
            "BAK": str(self.root / "index.html.bak"), "OBF": str(self.root / "index.obf.html"),
            "OBF_BUILD_SCRIPT": str(self.root / "_obfuscate_build.py"),
            "OBF_VERIFY_SCRIPT": str(self.root / "_obf_verify.py"),
            "HOOK_PATH": str(self.root / ".git/hooks/pre-commit"),
        }.items():
            patcher = patch.object(deploy, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.root, check=True,
                              capture_output=True, text=True, encoding="utf-8").stdout.strip()

    def build(self):
        (self.root / "index.obf.html").write_text("new _0x artifact\n", encoding="utf-8")
        return types.SimpleNamespace(returncode=0, stdout="", stderr="")

    def run_deploy(self, **kwargs):
        return deploy.deploy("격리 검증", build_fn=self.build,
                             verify_fn=lambda: types.SimpleNamespace(returncode=0, stdout="✅ 통과", stderr=""), **kwargs)

    def test_unrelated_staged_source_blocks_before_any_output_changes(self):
        original = (self.root / "index.html").read_bytes()
        (self.root / "private-source.js").write_text("private source")
        self.git("add", "private-source.js")
        previous = self.git("rev-parse", "HEAD")
        with self.assertRaisesRegex(deploy.DeployError, "stage된 파일"):
            self.run_deploy()
        self.assertEqual(self.git("rev-parse", "HEAD"), previous)
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "private-source.js")
        self.assertEqual((self.root / "index.html").read_bytes(), original)

    def test_current_tree_releases_without_missing_legacy_source_and_builders(self):
        for name in ["index.html.bak", "_obfuscate_build.py", "_obf_verify.py"]:
            (self.root / name).unlink()
        shutil.copyfile(ROOT / "scripts/check_index_module.mjs", self.root / "scripts/check_index_module.mjs")
        index = '<script type="module">const _0xfixture = 1;</script>\n'
        (self.root / "index.html").write_text(index, encoding="utf-8")
        deploy.deploy("현재 트리 배포", current_tree=True)
        self.assertEqual(self.git("show", "HEAD:index.html"), index.strip())
        subprocess.run(["node", "scripts/build_offline_manifest.mjs", "--check"], cwd=self.root, check=True, capture_output=True)
        self.assertFalse((self.root / "index.html.bak").exists())

    def test_current_tree_invalid_script_cannot_commit(self):
        shutil.copyfile(ROOT / "scripts/check_index_module.mjs", self.root / "scripts/check_index_module.mjs")
        before = self.git("rev-parse", "HEAD")
        for html in ['<script type="module">const _0x = ;</script>',
                     '<script>const broken = ;</script><script type="module">const _0x = 1;</script>']:
            with self.subTest(html=html):
                (self.root / "index.html").write_text(html, encoding="utf-8")
                with self.assertRaises(subprocess.CalledProcessError):
                    deploy.deploy("잘못된 구문", current_tree=True)
                self.assertEqual(self.git("rev-parse", "HEAD"), before)
                self.assertEqual(self.git("diff", "--cached", "--name-only"), "")

    def test_missing_source_and_builder_fail_without_recreating_source(self):
        (self.root / "index.html.bak").unlink()
        (self.root / "_obfuscate_build.py").unlink()
        with self.assertRaisesRegex(deploy.DeployError, "배포 필수 파일.*index.html.bak.*_obfuscate_build.py"):
            self.run_deploy()
        self.assertFalse((self.root / "index.html.bak").exists())
        self.assertFalse((self.root / ".git/hooks/pre-commit").exists())

    def test_release_commits_updated_hashes_and_all_public_modules(self):
        (self.root / "extra.js").write_text("export const version = 'new';\n")
        (self.root / "app_update.js").write_text("export const recoverApp = () => 'new';\n")
        self.run_deploy()
        files = self.git("show", "--pretty=", "--name-only", "HEAD").splitlines()
        self.assertEqual(set(files), {"index.html", "extra.js", "sw.js", "offline_build.json", "app_update.js"})
        subprocess.run(["node", "scripts/build_offline_manifest.mjs", "--check"], cwd=self.root, check=True, capture_output=True)
        self.assertEqual(self.git("diff", "--name-only"), "")

    def test_push_failure_retains_matching_local_commit_and_files(self):
        previous = self.git("rev-parse", "HEAD")
        with self.assertRaisesRegex(deploy.DeployError, "로컬 배포 커밋과 파일은 유지.*미확인"):
            self.run_deploy(push=True)
        self.assertNotEqual(self.git("rev-parse", "HEAD"), previous)
        self.assertEqual(self.git("show", "HEAD:index.html"), (self.root / "index.html").read_text().strip())
        self.assertEqual(self.git("diff", "--name-only"), "")

    def test_dry_run_restores_every_public_asset_and_manifest(self):
        paths = deploy.managed_artifact_paths()
        before = {path: Path(path).read_bytes() for path in paths}
        previous = self.git("rev-parse", "HEAD")
        self.run_deploy(dry_run=True)
        self.assertEqual({path: Path(path).read_bytes() for path in paths}, before)
        self.assertEqual(self.git("rev-parse", "HEAD"), previous)
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "")

    def test_commit_failure_restores_files_and_clears_only_deploy_stage(self):
        hook = self.root / ".git/hooks/pre-commit"
        hook.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8", newline="\n")
        paths = deploy.managed_artifact_paths()
        before = {path: Path(path).read_bytes() for path in paths}
        previous = self.git("rev-parse", "HEAD")
        with self.assertRaises(subprocess.CalledProcessError):
            self.run_deploy()
        self.assertEqual({path: Path(path).read_bytes() for path in paths}, before)
        self.assertEqual(self.git("rev-parse", "HEAD"), previous)
        self.assertEqual(self.git("diff", "--cached", "--name-only"), "")


if __name__ == "__main__":
    unittest.main()
