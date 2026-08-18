$ErrorActionPreference = 'Stop'

$indexPath = Join-Path $PSScriptRoot 'index.html'
$source = [IO.File]::ReadAllText($indexPath, [Text.Encoding]::UTF8)

function Replace-Once {
    param([string] $Text, [string] $Old, [string] $New, [string] $Label)
    $first = $Text.IndexOf($Old, [StringComparison]::Ordinal)
    if ($first -lt 0) { throw "[$Label] 교체 대상을 찾지 못했습니다." }
    $second = $Text.IndexOf($Old, $first + $Old.Length, [StringComparison]::Ordinal)
    if ($second -ge 0) { throw "[$Label] 교체 대상이 둘 이상입니다." }
    return $Text.Substring(0, $first) + $New + $Text.Substring($first + $Old.Length)
}

$source = Replace-Once $source "import{analyzeRecoveryCandidate}from'./recovery_guard.js';" "import{analyzeRecoveryCandidate,buildRecoveryData}from'./recovery_guard.js';" '병합 import'
$source = Replace-Once $source 'return analysis.shouldRecover?{date:snapshot.id,data:backupData,analysis}:null;' 'return analysis.shouldRecover?{date:snapshot.id,data:buildRecoveryData(serverData,backupData),analysis}:null;' '병합 데이터 생성'

$oldDetail = "detail.textContent=_pendingRecovery.date+' 백업에는 '+_pendingRecovery.analysis.backupCount+'건이 있고, 현재 서버 '+_pendingRecovery.analysis.serverCount+'건보다 '+_pendingRecovery.analysis.missingCount+'건 더 많습니다. 오래된 서버 화면은 저장하지 않았습니다.';"
$newDetail = "detail.textContent=_pendingRecovery.date+' 백업에서 서버에 없는 '+_pendingRecovery.analysis.backupMissingFromServer+'건을 찾았습니다. 서버 고유 '+_pendingRecovery.analysis.serverMissingFromBackup+'건도 보존해 총 '+_pendingRecovery.analysis.mergedCount+'건으로 안전하게 합칩니다. 오래된 서버 화면은 저장하지 않았습니다.';"
$source = Replace-Once $source $oldDetail $newDetail '병합 설명'

$source = Replace-Once $source "confirm.textContent=_pendingRecovery.date+' 최신 백업 '+_pendingRecovery.analysis.backupCount+'건 복구';" "confirm.textContent=_pendingRecovery.date+' 백업과 병합해 '+_pendingRecovery.analysis.mergedCount+'건 복구';" '병합 확인 버튼'
$source = Replace-Once $source "later.textContent='나중에 — 최신 백업 읽기 전용으로 보기';" "later.textContent='나중에 — 병합 결과 읽기 전용으로 보기';" '읽기 전용 버튼'
$source = Replace-Once $source "showToast('✅ 최신 백업 '+pending.analysis.backupCount+'건을 복구했습니다.',5000);" "showToast('✅ 최신 기록 '+pending.analysis.mergedCount+'건을 병합 복구했습니다.',5000);" '병합 완료 문구'
$source = Replace-Once $source "showToast('최신 백업을 읽기 전용으로 표시합니다. 복구 전까지 저장은 차단됩니다.',6000);" "showToast('병합 결과를 읽기 전용으로 표시합니다. 복구 전까지 저장은 차단됩니다.',6000);" '병합 읽기 전용 문구'

[IO.File]::WriteAllText($indexPath, $source, [Text.UTF8Encoding]::new($false))
Write-Host '백업과 서버의 고유 기록을 보존하는 병합 패치를 적용했습니다.'

