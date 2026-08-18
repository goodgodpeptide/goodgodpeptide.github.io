$ErrorActionPreference = 'Stop'

$indexPath = Join-Path $PSScriptRoot 'index.html'
$source = [IO.File]::ReadAllText($indexPath, [Text.Encoding]::UTF8)

function Replace-Once {
    param(
        [Parameter(Mandatory)] [string] $Text,
        [Parameter(Mandatory)] [string] $Old,
        [Parameter(Mandatory)] [string] $New,
        [Parameter(Mandatory)] [string] $Label
    )

    $first = $Text.IndexOf($Old, [StringComparison]::Ordinal)
    if ($first -lt 0) { throw "[$Label] 교체 대상을 찾지 못했습니다." }
    $second = $Text.IndexOf($Old, $first + $Old.Length, [StringComparison]::Ordinal)
    if ($second -ge 0) { throw "[$Label] 교체 대상이 둘 이상입니다." }
    return $Text.Substring(0, $first) + $New + $Text.Substring($first + $Old.Length)
}

$oldImport = "import{getFirestore,doc,getDoc,getDocFromServer,setDoc,addDoc,updateDoc,deleteDoc,collection,serverTimestamp,getDocs,arrayUnion,arrayRemove,onSnapshot,query,orderBy,limit,runTransaction}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';import{commitUserDocument,isSyncConflict}from'./sync_guard.js';"
$newImport = "import{getFirestore,doc,getDoc,getDocFromServer,setDoc,addDoc,updateDoc,deleteDoc,collection,serverTimestamp,getDocs,getDocsFromServer,arrayUnion,arrayRemove,onSnapshot,query,orderBy,limit,runTransaction}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';import{commitUserDocument,isSyncConflict}from'./sync_guard.js';import{analyzeRecoveryCandidate,buildRecoveryData}from'./recovery_guard.js';"
$source = Replace-Once $source $oldImport $newImport '복구 감시 import'

$source = Replace-Once $source '_lastSyncedRevision=0x0,appData=' '_lastSyncedRevision=0x0,_pendingRecovery=null,appData=' '복구 대기 변수'

$recoveryHelpers = @'
async function findNewerServerBackup(uid,serverData){const snapshots=query(collection(db,'backups',uid,'snapshots'),orderBy('savedAt','desc'),limit(1)),result=await getDocsFromServer(snapshots);if(result.empty)return null;const snapshot=result.docs[0],raw=snapshot.data(),backupData=migrateData(raw&&raw.data?raw.data:{}),analysis=analyzeRecoveryCandidate(serverData,backupData);return analysis.shouldRecover?{date:snapshot.id,data:buildRecoveryData(serverData,backupData),analysis}:null;}
function removeRecoveryGate(){const gate=document.getElementById('jwbs-recovery-gate');if(gate)gate.remove();}
function renderRecoveryGate(){if(!_pendingRecovery)return;removeRecoveryGate();const gate=document.createElement('div');gate.id='jwbs-recovery-gate';gate.style.cssText='position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.94);display:flex;align-items:center;justify-content:center;padding:20px;font-family:inherit';const card=document.createElement('div');card.style.cssText='max-width:420px;width:100%;background:#111827;border:2px solid #ef4444;border-radius:18px;padding:22px;color:#f8fafc;box-shadow:0 24px 70px rgba(0,0,0,.55)';const title=document.createElement('div');title.textContent='⚠️ 서버보다 최신 백업을 발견했습니다';title.style.cssText='font-size:18px;font-weight:800;color:#fca5a5;margin-bottom:12px';const detail=document.createElement('div');detail.textContent=_pendingRecovery.date+' 백업에서 서버에 없는 '+_pendingRecovery.analysis.backupMissingFromServer+'건을 찾았습니다. 서버 고유 '+_pendingRecovery.analysis.serverMissingFromBackup+'건도 보존해 총 '+_pendingRecovery.analysis.mergedCount+'건으로 안전하게 합칩니다. 오래된 서버 화면은 저장하지 않았습니다.';detail.style.cssText='font-size:14px;line-height:1.7;color:#e2e8f0;margin-bottom:16px';const confirm=document.createElement('button');confirm.textContent=_pendingRecovery.date+' 백업과 병합해 '+_pendingRecovery.analysis.mergedCount+'건 복구';confirm.style.cssText='width:100%;padding:13px;border:0;border-radius:10px;background:#dc2626;color:white;font-weight:800;font-size:14px;cursor:pointer';const later=document.createElement('button');later.textContent='나중에 — 병합 결과 읽기 전용으로 보기';later.style.cssText='width:100%;padding:11px;margin-top:9px;border:1px solid #475569;border-radius:10px;background:#1e293b;color:#cbd5e1;font-size:13px;cursor:pointer';confirm.onclick=async()=>{const pending=_pendingRecovery;if(!pending)return;const previousRevision=_lastSyncedRevision;confirm.disabled=true;confirm.textContent='복구 중...';appData={...appData,...pending.data};dataLoaded=true;await saveData({recovery:true});if(_lastSyncedRevision===previousRevision+1){_pendingRecovery=null;removeRecoveryGate();renderAll();showToast('✅ 최신 기록 '+pending.analysis.mergedCount+'건을 병합 복구했습니다.',5000);}else{dataLoaded=false;confirm.disabled=false;confirm.textContent='복구 재시도';}};later.onclick=()=>{removeRecoveryGate();showToast('병합 결과를 읽기 전용으로 표시합니다. 복구 전까지 저장은 차단됩니다.',6000);};card.append(title,detail,confirm,later);gate.appendChild(card);document.body.appendChild(gate);}
async function enterRecoveryGate(serverData,recovery){_lastSyncedUpdatedAt=Number(serverData.updatedAt||0),_lastSyncedRevision=Number(serverData.syncRevision||0),appData={...appData,...recovery.data},_pendingRecovery=recovery,dataLoaded=false,setSaveStatus('error'),setTimeout(()=>{renderAll();renderRecoveryGate();},0);}
'@
$recoveryHelpers = $recoveryHelpers.Trim()
$source = Replace-Once $source 'async function loadData()' ($recoveryHelpers + 'async function loadData()') '복구 감시 함수'

$oldLoad = "const _0x2ca522=migrateData(_0x292246[_0x2fb8c4(0xb45)]()),_0xdf6ee3="
$newLoad = "const _0x2ca522=migrateData(_0x292246[_0x2fb8c4(0xb45)]()),_recoveryCandidate=await findNewerServerBackup(currentUser.uid,_0x2ca522);if(_recoveryCandidate){await enterRecoveryGate(_0x2ca522,_recoveryCandidate);return;}const _0xdf6ee3="
$source = Replace-Once $source $oldLoad $newLoad '로그인 시 최신 백업 대조'

$source = Replace-Once $source "const APP_CHANGELOG=[" "const APP_CHANGELOG=[{'date':'2026-08-18','items':[{'type':'fix','text':'서버보다 최신인 자동 백업을 로그인 전에 대조하고, 오래된 서버 화면의 저장을 차단합니다.'}]} ," '복구 변경내역'

[IO.File]::WriteAllText($indexPath, $source, [Text.UTF8Encoding]::new($false))
Write-Host '최신 백업 우선 복구 패치를 index.html에 적용했습니다.'
