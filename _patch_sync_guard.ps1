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
    if ($first -lt 0) {
        throw "[$Label] 교체 대상을 찾지 못했습니다."
    }
    $second = $Text.IndexOf($Old, $first + $Old.Length, [StringComparison]::Ordinal)
    if ($second -ge 0) {
        throw "[$Label] 교체 대상이 둘 이상입니다."
    }
    return $Text.Substring(0, $first) + $New + $Text.Substring($first + $Old.Length)
}

$oldImport = "import{getFirestore,initializeFirestore,persistentLocalCache,doc,getDoc,setDoc,addDoc,updateDoc,deleteDoc,collection,serverTimestamp,getDocs,arrayUnion,arrayRemove,onSnapshot,query,orderBy,limit}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';"
$newImport = "import{getFirestore,doc,getDoc,getDocFromServer,setDoc,addDoc,updateDoc,deleteDoc,collection,serverTimestamp,getDocs,arrayUnion,arrayRemove,onSnapshot,query,orderBy,limit,runTransaction}from'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';import{commitUserDocument,isSyncConflict}from'./sync_guard.js';"
$source = Replace-Once $source $oldImport $newImport 'Firestore import'

$dbStart = $source.IndexOf('let db;try{db=initializeFirestore', [StringComparison]::Ordinal)
$dbEndMarker = '}const provider=new GoogleAuthProvider();'
$dbEnd = $source.IndexOf($dbEndMarker, $dbStart, [StringComparison]::Ordinal)
if ($dbStart -lt 0 -or $dbEnd -lt 0) {
    throw '[Firestore 초기화] 영구 캐시 초기화 구간을 찾지 못했습니다.'
}
$source = $source.Substring(0, $dbStart) + 'const db=getFirestore(app);const provider=new GoogleAuthProvider();' + $source.Substring($dbEnd + $dbEndMarker.Length)

$source = Replace-Once $source '_lastSyncedUpdatedAt=0x0,appData=' '_lastSyncedUpdatedAt=0x0,_lastSyncedRevision=0x0,appData=' '동기화 버전 변수'

$loadStart = $source.IndexOf('async function loadData()', [StringComparison]::Ordinal)
$loadEnd = $source.IndexOf('async function _setDocWithRetry', $loadStart, [StringComparison]::Ordinal)
if ($loadStart -lt 0 -or $loadEnd -lt 0) {
    throw '[loadData] 함수 구간을 찾지 못했습니다.'
}
$loadBody = $source.Substring($loadStart, $loadEnd - $loadStart)
$loadBody = Replace-Once $loadBody 'await getDoc(doc(db,' 'await getDocFromServer(doc(db,' '서버 강제 조회'
$loadBody = Replace-Once $loadBody "appData['updatedAt']=Date[_0x2fb8c4(0xba0)](),await setDoc(doc(db,'users',currentUser[_0x2fb8c4(0x937)]),appData),_lastSyncedUpdatedAt=appData['updatedAt'],dataLoaded=" "appData['updatedAt']=Date[_0x2fb8c4(0xba0)](),appData['syncRevision']=Number(_0x2ca522['syncRevision']||0x0)+0x1,await setDoc(doc(db,'users',currentUser[_0x2fb8c4(0x937)]),appData),_lastSyncedUpdatedAt=appData['updatedAt'],_lastSyncedRevision=appData['syncRevision'],dataLoaded=" '빈 서버의 로컬 복구 버전 부여'
$loadBody = Replace-Once $loadBody "_lastSyncedUpdatedAt=appData[_0x2fb8c4(0x8e0)]||0x0,dataLoaded=" "_lastSyncedUpdatedAt=appData[_0x2fb8c4(0x8e0)]||0x0,_lastSyncedRevision=Number(appData['syncRevision']||0x0),dataLoaded=" '로드 기준 버전 저장'
$loadBody = Replace-Once $loadBody "dataLoaded=!![],setSaveStatus(_0x2fb8c4(0x546));}catch(_0x556d30)" "dataLoaded=!![],setSaveStatus(_0x2fb8c4(0x546));if(_lastSyncedRevision===0x0)await saveData({'migration':!![]});}catch(_0x556d30)" 'legacy revision migration'
$source = $source.Substring(0, $loadStart) + $loadBody + $source.Substring($loadEnd)

$saveStart = $source.IndexOf('async function saveData(', [StringComparison]::Ordinal)
$saveEnd = $source.IndexOf('async function runWeeklyBackup()', $saveStart, [StringComparison]::Ordinal)
if ($saveStart -lt 0 -or $saveEnd -lt 0) {
    throw '[saveData] 함수 구간을 찾지 못했습니다.'
}
$newSave = @"
async function saveData(_options={}){if(!currentUser)return;if(dataLoaded!==true){console.warn('서버 최신 데이터를 확인하지 못해 저장을 차단했습니다.'),setSaveStatus('error');try{showToast('서버 최신 데이터를 먼저 확인해야 저장할 수 있습니다.',4000);}catch(_ignored){}return;}const userRef=doc(db,'users',currentUser.uid),allowEmpty=_pendingAllowEmpty;setSaveStatus('saving');saveLsBackup();try{const committed=await commitUserDocument({db,runTransaction,ref:userRef,data:appData,expectedRevision:_lastSyncedRevision,allowEmpty});appData=committed.data,_lastSyncedUpdatedAt=committed.updatedAt,_lastSyncedRevision=committed.revision,_pendingAllowEmpty=false,saveLsBackup(),setSaveStatus('saved');}catch(error){_pendingAllowEmpty=false;if(isSyncConflict(error)){try{localStorage.setItem('jwbs_conflict_backup_'+currentUser.uid,JSON.stringify({data:appData,savedAt:Date.now(),expectedRevision:_lastSyncedRevision,serverRevision:error.serverRevision}));}catch(_backupError){}console.warn('오래된 기기의 저장을 차단했습니다.',error);setSaveStatus('loading');try{await loadData(),renderAll(),showToast('⚠️ 다른 기기의 최신 데이터를 불러왔습니다. 이 기기의 오래된 내용은 저장하지 않았습니다.',6000);}catch(reloadError){console.error('최신 서버 데이터 재조회 실패:',reloadError),setSaveStatus('error');}return;}console.error('saveData 실패 — 로컬 복구본은 보존됨:',error),setSaveStatus('error');try{showToast('저장하지 못했습니다. 네트워크 확인 후 다시 시도해주세요.',5000);}catch(_ignored){}}}
"@.Trim()
$source = $source.Substring(0, $saveStart) + $newSave + $source.Substring($saveEnd)

$oldNicknameWrite = "if(currentUser)try{await updateDoc(doc(db,_0x3ca16e(0x7ae),currentUser['uid']),{'nickname':_0x406dfb});}catch(_0x5ad2a0){await saveData();}"
$newNicknameWrite = 'if(currentUser)await saveData();'
$source = Replace-Once $source $oldNicknameWrite $newNicknameWrite 'nickname revisioned save'

$oldLifecycle = "window[a0_0x4109b5(0xd88)](a0_0x4109b5(0x5c1),()=>{saveTimer&&(clearTimeout(saveTimer),saveTimer=null,saveData({'immediate':!![]}));});"
$newLifecycle = "window.addEventListener('pagehide',()=>{saveLsBackup();});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&saveTimer){clearTimeout(saveTimer),saveTimer=null,saveData();}});"
$source = Replace-Once $source $oldLifecycle $newLifecycle '종료 시 검증 우회 저장 제거'

$source = Replace-Once $source 'const APP_CHANGELOG=[' "const APP_CHANGELOG=[{'date':'2026-08-18','items':[{'type':'fix','text':'다른 기기의 오래된 데이터가 최신 기록을 덮지 못하도록 서버 버전 트랜잭션과 충돌 차단을 적용했습니다.'}]}," '앱 변경내역'

[IO.File]::WriteAllText($indexPath, $source, [Text.UTF8Encoding]::new($false))
Write-Host '동기화 역전 방지 패치를 index.html에 적용했습니다.'
