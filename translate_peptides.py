#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
peptides_v3.json 전체 영문 텍스트 → 한국어 번역 후 Ko 필드 추가
Google Translate 무료 API 사용 (키 불필요)
"""
import json, time, sys, io, re, requests
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

JSON_PATH = "C:/Users/user/Desktop/goodgodpeptide.github.io/peptides_v3.json"


def translate(text: str) -> str:
    if not text or not text.strip():
        return text
    # 영어가 아닌 것 같으면 스킵 (이미 한국어)
    ascii_ratio = sum(1 for c in text if ord(c) < 128) / max(len(text), 1)
    if ascii_ratio < 0.4:
        return text
    if len(text) > 2000:
        sentences = re.split(r'(?<=[.!?])\s+', text)
        chunks, cur = [], ""
        for s in sentences:
            if len(cur) + len(s) < 1800:
                cur += (" " if cur else "") + s
            else:
                if cur:
                    chunks.append(cur)
                cur = s
        if cur:
            chunks.append(cur)
        return " ".join(translate(c) for c in chunks)

    url = "https://translate.googleapis.com/translate_a/single"
    params = {"client": "gtx", "sl": "en", "tl": "ko", "dt": "t", "q": text}
    for attempt in range(3):
        try:
            r = requests.get(url, params=params, timeout=15)
            # 4xx/5xx 에러 명시 처리 — 429/5xx는 재시도, 그 외는 즉시 실패
            if r.status_code == 429 or r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code} retryable")
            r.raise_for_status()
            data = r.json()
            # 빈 응답/잘못된 구조 가드 — IndexError 방지
            if not data or not isinstance(data, list) or len(data) == 0:
                print(f"  [경고] 빈 응답, 원문 유지")
                return text
            if not isinstance(data[0], list):
                print(f"  [경고] 응답 구조 비정상, 원문 유지")
                return text
            return "".join(chunk[0] for chunk in data[0] if chunk and chunk[0])
        except Exception as e:
            print(f"  [재시도 {attempt+1}] {e}")
            time.sleep(2 ** attempt)
    return text


def translate_list(items: list) -> list:
    return [translate(item) if isinstance(item, str) else item for item in items]


def translate_peptide(pid: str, pep: dict) -> dict:
    name = pep.get('nameEn', pid)
    updated = {}

    # ── 문자열 필드 ─────────────────────────────────────────
    for src, dst in [
        ('descriptionEn', 'descriptionKo'),
        ('keyBenefits',   'keyBenefitsKo'),
        ('mechanism',     'mechanismKo'),
        ('subtitle',      'subtitleKo'),
        ('protocolTiming','protocolTimingKo'),
    ]:
        val = pep.get(src, '')
        if val and not pep.get(dst):
            print(f"  [{src}] 번역 중...")
            updated[dst] = translate(val)
            time.sleep(0.3)

    # ── 리스트 필드 (문자열 배열) ────────────────────────────
    for src, dst in [
        ('safetyNotes',    'safetyNotesKo'),
        ('stopSigns',      'stopSignsKo'),
        ('sideEffects',    'sideEffectsKo'),
        ('effectsTimeline','effectsTimelineKo'),
        ('qualityGood',    'qualityGoodKo'),
        ('qualityBad',     'qualityBadKo'),
    ]:
        val = pep.get(src, [])
        if val and isinstance(val, list) and not pep.get(dst):
            print(f"  [{src}] 번역 중... ({len(val)}개)")
            updated[dst] = translate_list(val)
            time.sleep(0.3)

    # ── latestResearch: title + excerpt Ko 추가 ──────────────
    lr = pep.get('latestResearch', [])
    lr_ko = pep.get('latestResearchKo', [])
    # 번역본이 없거나, 있지만 titleKo 가 없으면 재번역
    needs_lr = not lr_ko or (lr_ko and lr_ko[0] and not lr_ko[0].get('titleKo'))
    if lr and needs_lr:
        print(f"  [latestResearch] 번역 중... ({len(lr)}개)")
        ko_lr = []
        for item in lr:
            ko_item = dict(item)
            if item.get('title') and not ko_item.get('titleKo'):
                ko_item['titleKo'] = translate(item['title'])
                time.sleep(0.2)
            if item.get('excerpt') and not ko_item.get('excerptKo'):
                ko_item['excerptKo'] = translate(item['excerpt'])
                time.sleep(0.2)
            ko_lr.append(ko_item)
        updated['latestResearchKo'] = ko_lr

    # ── interactionsKo: description 번역 ────────────────────
    inter = pep.get('interactions', [])
    if inter and not pep.get('interactionsKo'):
        print(f"  [interactions] 번역 중... ({len(inter)}개)")
        ko_inter = []
        for item in inter:
            ko_item = dict(item)
            if item.get('description'):
                ko_item['descriptionKo'] = translate(item['description'])
                time.sleep(0.2)
            ko_inter.append(ko_item)
        updated['interactionsKo'] = ko_inter

    # ── researchIndicationsDetailedKo: title+description 번역 ─
    rid = pep.get('researchIndicationsDetailed', {})
    rid_ko = pep.get('researchIndicationsDetailedKo', {})
    # 저장된 Ko가 없거나, 있지만 첫 아이템에 titleKo가 없으면 번역
    needs_rid = False
    if not rid_ko:
        needs_rid = True
    else:
        for cat, items in rid_ko.items():
            if isinstance(items, list) and items and isinstance(items[0], dict) and not items[0].get('titleKo'):
                needs_rid = True
                break
    if rid and needs_rid:
        print(f"  [researchIndicationsDetailed] 번역 중... ({len(rid)}개 카테고리)")
        ko_rid = {}
        for cat, items in rid.items():
            if not items:
                ko_rid[cat] = items
            elif isinstance(items, list):
                ko_items = []
                for item in items:
                    if isinstance(item, dict):
                        ko_item = dict(item)
                        if item.get('title'):
                            ko_item['titleKo'] = translate(item['title'])
                            time.sleep(0.2)
                        if item.get('description'):
                            ko_item['descriptionKo'] = translate(item['description'])
                            time.sleep(0.2)
                        ko_items.append(ko_item)
                    elif isinstance(item, str):
                        ko_items.append(translate(item))
                        time.sleep(0.2)
                    else:
                        ko_items.append(item)
                ko_rid[cat] = ko_items
            else:
                ko_rid[cat] = translate(str(items))
                time.sleep(0.2)
        updated['researchIndicationsDetailedKo'] = ko_rid

    return updated


def main():
    with open(JSON_PATH, encoding='utf-8') as f:
        data = json.load(f)

    peptides = data['peptides']
    total = len(peptides)
    print(f"총 {total}개 펩타이드 번역 시작\n")

    for i, (pid, pep) in enumerate(peptides.items()):
        name = pep.get('nameEn', pid)
        updates = translate_peptide(pid, pep)
        if updates:
            pep.update(updates)
            print(f"[{i+1}/{total}] {name} — {len(updates)}개 필드 업데이트")
        else:
            print(f"[{i+1}/{total}] {name} — 스킵 (완료)")
        # 10개마다 중간 저장
        if (i + 1) % 10 == 0:
            with open(JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"  >>> 중간 저장 완료 ({i+1}/{total})\n")
        time.sleep(0.2)

    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"\n완료! {total}개 펩타이드 번역 저장됨")


if __name__ == '__main__':
    main()
