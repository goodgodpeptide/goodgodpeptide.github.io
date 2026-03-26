#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
peptides.txt -> peptides_v3.json
pep-pedia.org 스크래핑 텍스트에서 상세 정보 추출
"""

import re
import json
from datetime import datetime

INPUT_FILE = "C:/Users/JuneK/Downloads/peptides.txt"
OUTPUT_FILE = "peptides_v3.json"

STATUS_WORDS = [
    'Extensively Studied', 'Well Researched', 'Most Effective',
    'Emerging Research', 'Limited Research', 'Clinical Research',
    'Approved Drug', 'FDA Approved'
]

ROUTE_WORDS = ['OralInjectable', 'InjectableOral', 'Oral', 'Injectable', 'Topical', 'Intranasal']


def clean(s):
    if not s:
        return ''
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def slug_to_regex(slug):
    """slug를 이름 탐색용 regex로 변환. 'bpc-157' -> 'BPC.{0,3}157'"""
    parts = slug.split('-')
    return r'.{0,3}'.join(re.escape(p) for p in parts)


def get_main_content(content):
    """JS 코드를 건너뛰고 실제 페이지 콘텐츠 시작점 반환"""
    browse_positions = [m.start() for m in re.finditer(r'Browse', content)]
    if len(browse_positions) >= 3:
        return content[browse_positions[2]:]
    elif len(browse_positions) >= 2:
        return content[browse_positions[1]:]
    return content


def extract_name_subtitle(main_content, peptide_id):
    """slug 매칭으로 정확한 이름과 부제목 추출"""
    chunk = main_content[6:300]  # 'Browse' 제거 후 헤더 영역

    # Typical Dose 이전까지만
    td_idx = chunk.find('Typical Dose')
    header = chunk[:td_idx] if td_idx > 0 else chunk

    # 상태 키워드 & 라우트 제거한 클린 헤더
    clean_header = header
    for sw in STATUS_WORDS:
        clean_header = clean_header.replace(sw, '')
    for rw in ROUTE_WORDS:
        clean_header = clean_header.replace(rw, '')
    clean_header = clean(clean_header)

    # | 위치
    pipe_idx = clean_header.find('|')
    if pipe_idx < 0:
        # | 없으면 이름만 반환
        name = peptide_id.replace('-', ' ').title()
        return name, ''

    before_pipe = clean_header[:pipe_idx].strip()
    after_pipe = clean_header[pipe_idx + 1:].strip()

    # slug 패턴으로 이름 찾기
    slug_pat = slug_to_regex(peptide_id)
    name_m = re.search(slug_pat, before_pipe, re.IGNORECASE)
    if name_m:
        name = name_m.group(0)
        subtitle_prefix = before_pipe[name_m.end():].strip()
        # 괄호 포함 이름 처리 (예: AHK-Cu (Copper Tripeptide-3))
        if before_pipe[name_m.end():name_m.end()+2] == ' (':
            paren_m = re.match(r' \([^)]+\)', before_pipe[name_m.end():])
            if paren_m:
                name = name + paren_m.group(0)
                subtitle_prefix = before_pipe[name_m.end() + len(paren_m.group(0)):].strip()
        subtitle = (subtitle_prefix + ' | ' + after_pipe).strip(' | ')
    else:
        # fallback: slug title case
        name = peptide_id.replace('-', ' ').title()
        subtitle = clean_header

    return clean(name), clean(subtitle)


def parse_peptide(content, peptide_id):
    main = get_main_content(content)
    p = {'id': peptide_id}

    # ── 1. 이름 & 부제목 ───────────────────────────────────
    p['nameEn'], p['subtitle'] = extract_name_subtitle(main, peptide_id)
    if not p['nameEn'] or len(p['nameEn']) < 2:
        p['nameEn'] = peptide_id.replace('-', ' ').title()
    p['nameKo'] = ''

    # ── 2. 연구 상태 & 승인 여부 ───────────────────────────
    # 헤더 영역 (6000자 이내)
    header = main[:6000]
    if re.search(r'Extensively Studied', header):
        p['researchStatus'] = 'Extensively Studied'
    elif re.search(r'Well Researched', header):
        p['researchStatus'] = 'Well Researched'
    elif re.search(r'Emerging Research', header):
        p['researchStatus'] = 'Emerging Research'
    elif re.search(r'Limited Research', header):
        p['researchStatus'] = 'Limited Research'
    elif re.search(r'Clinical Research', header):
        p['researchStatus'] = 'Clinical Research'
    else:
        p['researchStatus'] = 'Limited Research'

    p['isApproved'] = bool(re.search(r'FDA.Approved|Approved Drug', content[:5000], re.IGNORECASE))

    # ── 3. 투여 경로 ───────────────────────────────────────
    routes = []
    route_area = main[:500]
    if re.search(r'\bOral\b', route_area):
        routes.append('Oral')
    if re.search(r'\bInjectable\b', route_area):
        routes.append('Injectable')
    if re.search(r'\bTopical\b', route_area):
        routes.append('Topical')
    if re.search(r'\bIntranasal\b', route_area):
        routes.append('Intranasal')
    p['routes'] = routes if routes else ['Injectable']

    # ── 4. Typical Dose, Cycle, Storage ───────────────────
    # "Typical Dose50-100mg1x daily" 패턴
    dose_m = re.search(r'Typical Dose([\d\-\.]+(?:mg|mcg|IU|ml|%|mg/kg)[^\n]{0,20}?)(?:Route|Cycle|Storage|\d+x)', main[:2000], re.IGNORECASE)
    p['typicalDose'] = clean(dose_m.group(1)) if dose_m else ''

    # Frequency (1x daily, 2x daily 등)
    freq_m = re.search(r'Typical Dose[\d\-\.]+(?:mg|mcg|IU|ml|%|mg/kg)\s*(\d+x\s*(?:daily|weekly|week|day)[^\n]{0,20})', main[:2000], re.IGNORECASE)
    p['frequency'] = clean(freq_m.group(1)) if freq_m else ''

    # Cycle
    cycle_m = re.search(r'Cycle([\d\-]+\s*(?:weeks?|days?|months?)[^\n]{0,40}?)(?:Typical duration|Storage)', main[:2000], re.IGNORECASE)
    if not cycle_m:
        cycle_m = re.search(r'Cycle\s*([\d\-]+\s*(?:weeks?|days?|months?))', main[:3000], re.IGNORECASE)
    p['cycle'] = clean(cycle_m.group(1)) if cycle_m else ''

    # Storage - 첫번째 언급 기준으로 판단
    storage_area = main[:2000]
    stor_room = storage_area.find('Room temp')
    stor_refr = storage_area.find('Refrigerated')
    stor_frozen = storage_area.find('Frozen')
    if stor_frozen > 0 and (stor_room < 0 or stor_frozen < stor_room) and (stor_refr < 0 or stor_frozen < stor_refr):
        p['storage'] = '냉동 (-20°C)'
    elif stor_refr > 0 and (stor_room < 0 or stor_refr < stor_room):
        p['storage'] = '냉장 (2-8°C)'
    else:
        p['storage'] = '실온'

    # Route detail (N/A - Oral administration 같은 텍스트)
    route_detail_m = re.search(r'Route\s*((?:Oral|Injectable|Subcutaneous|Intramuscular|Intranasal|Topical)[^\n]{0,80}?)Cycle', main[:2000], re.IGNORECASE)
    p['routeDetail'] = clean(route_detail_m.group(1)) if route_detail_m else ''

    # ── 5. Overview (설명) ─────────────────────────────────
    # "What is X?" 다음 텍스트
    what_is_pattern = 'What is ' + p['nameEn'].split()[0]
    wi_idx = main.find(what_is_pattern)
    if wi_idx < 0:
        wi_idx = main.find('What is ')
        # AI 질문 영역 건너뜀
        ai_idx = main.find('PepPedia AI')
        if ai_idx > 0 and wi_idx < ai_idx:
            wi_idx = main.find('What is ', ai_idx)

    if wi_idx > 0:
        q_end = main.find('?', wi_idx)
        if q_end > 0:
            desc_start = q_end + 1
            desc_end_m = re.search(r'Key Benefits|Mechanism of Action|Pharmacokinetics', main[desc_start:desc_start+800])
            if desc_end_m:
                p['descriptionEn'] = clean(main[desc_start:desc_start + desc_end_m.start()])[:600]
            else:
                p['descriptionEn'] = clean(main[desc_start:desc_start+500])
        else:
            p['descriptionEn'] = ''
    else:
        p['descriptionEn'] = ''

    # ── 6. Key Benefits ────────────────────────────────────
    kb_m = re.search(r'Key Benefits(.*?)(?:Mechanism of Action|Pharmacokinetics|Research Indications)', main, re.DOTALL)
    p['keyBenefits'] = clean(kb_m.group(1))[:400] if kb_m else ''

    # ── 7. Mechanism of Action ─────────────────────────────
    moa_m = re.search(r'Mechanism of Action(.*?)(?:Pharmacokinetics|Research Indications|Research Protocols)', main, re.DOTALL)
    p['mechanism'] = clean(moa_m.group(1))[:400] if moa_m else ''

    # ── 8. Pharmacokinetics ────────────────────────────────
    pk_m = re.search(r'Peak:\s*([\d\.]+\s*(?:hrs?|min|days?))', main)
    hl_m = re.search(r'Half-life:\s*([\d\.]+\s*(?:hrs?|days?))', main)
    cl_m = re.search(r'Cleared:\s*(~?[\d\.]+\s*(?:hrs?|days?))', main)
    p['pharmacokinetics'] = {
        'peak': clean(pk_m.group(1)) if pk_m else '',
        'halfLife': clean(hl_m.group(1)) if hl_m else '',
        'cleared': clean(cl_m.group(1)) if cl_m else '',
    }

    # ── 9. Research Indications ────────────────────────────
    indications = []
    ind_block_m = re.search(r'Research Indications(.*?)(?:Research Protocols|Peptide Interactions|How to Reconstitute)', main, re.DOTALL)
    if ind_block_m:
        ind_text = ind_block_m.group(1)
        # "LongevityMost Effective", "MetabolismEffective", "Weight LossModerate"
        eff_map = {
            'Most Effective': 4, 'Effective': 3, 'Moderate': 2,
            'Limited': 1, 'Emerging': 1
        }
        # 인디케이션 이름 + 효과 레벨 묶음
        pairs = re.findall(
            r'([A-Z][A-Za-z\s\/\-&]+?)(Most Effective|Effective|Moderate|Limited|Emerging)',
            ind_text
        )
        seen = set()
        for name_raw, eff in pairs[:8]:
            name_c = clean(name_raw)
            if 2 < len(name_c) < 50 and name_c not in seen:
                seen.add(name_c)
                indications.append({'name': name_c, 'effectiveness': eff, 'level': eff_map.get(eff, 1)})
    p['researchIndications'] = indications

    # ── 10. Research Protocols ─────────────────────────────
    protocols = []
    proto_m = re.search(r'GoalDoseFrequencyRoute(.*?)(?:Timing:|Peptide Interactions|How to Reconstitute)', main, re.DOTALL)
    if proto_m:
        proto_text = proto_m.group(1)
        rows = re.findall(
            r'([A-Za-z][A-Za-z\s]+?)\s*([\d\-\.]+(?:mg|mcg|IU))\s*(\d+x[^\n]{0,40}?(?:daily|weekly|week|day)[^\n]{0,20}?)\s*((?:Oral|Injectable|Subcutaneous|Intramuscular|Topical)[^\n]{0,50})',
            proto_text, re.IGNORECASE
        )
        for row in rows[:6]:
            protocols.append({
                'goal': clean(row[0]),
                'dose': clean(row[1]),
                'frequency': clean(row[2]),
                'route': clean(row[3])
            })
    # Timing 노트
    timing_m = re.search(r'Timing:\s*([^P\n][^\n]{20,300})', main)
    p['protocolTiming'] = clean(timing_m.group(1))[:300] if timing_m else ''
    p['protocols'] = protocols

    # ── 11. Peptide Interactions ───────────────────────────
    interactions = []
    inter_m = re.search(r'Peptide Interactions(.*?)(?:How to Reconstitute|Quality Indicators|Side Effects)', main, re.DOTALL)
    if inter_m:
        inter_text = inter_m.group(1)
        items = re.findall(
            r'([A-Za-z][A-Za-z0-9\s\-\+\(\)\']+?)\s*(Synergistic|Compatible|Monitor Combination|Avoid Combination|Unknown)',
            inter_text
        )
        seen = set()
        for item_name, item_type in items[:8]:
            n = clean(item_name)
            if 2 < len(n) < 60 and n not in seen:
                seen.add(n)
                interactions.append({'name': n, 'type': item_type})
    p['interactions'] = interactions

    # ── 12. How to Reconstitute (재구성 단계) ──────────────
    reconstitute = []
    rec_m = re.search(r'How to Reconstitute.*?Important:[^\n]*\n(.*?)(?:Quality Indicators|Side Effects|What to Expect)', main, re.DOTALL)
    if rec_m:
        steps = re.findall(r'\d+\s*([^\d\n]{15,200})', rec_m.group(1))
        reconstitute = [clean(s)[:200] for s in steps[:8]]
    p['reconstitute'] = reconstitute

    # ── 13. Quality Indicators ─────────────────────────────
    qi_m = re.search(r'Quality Indicators(.*?)(?:What to Expect|Side Effects|References|$)', main, re.DOTALL)
    if qi_m:
        qi_text = qi_m.group(1)
        goods = re.findall(r'✓([^\n✓✗]{5,100})', qi_text)
        bads = re.findall(r'✗([^\n✓✗]{5,100})', qi_text)
        p['qualityGood'] = [clean(g) for g in goods[:4]]
        p['qualityBad'] = [clean(b) for b in bads[:4]]
    else:
        p['qualityGood'] = []
        p['qualityBad'] = []

    # ── 14. What to Expect (효과 타임라인) ─────────────────
    wte_m = re.search(r'What to Expect(.*?)(?:Side Effects|References|$)', main, re.DOTALL)
    if wte_m:
        wte_text = wte_m.group(1)
        bullets = re.findall(r'[•\-]\s*([^\n•\-]{15,200})', wte_text)
        if not bullets:
            bullets = re.findall(r'((?:Week|Month|Day)\s[\d\-]+:[^\n]{15,150})', wte_text)
        p['effectsTimeline'] = [clean(b)[:200] for b in bullets[:6]]
    else:
        p['effectsTimeline'] = []

    # ── 15. Side Effects & Safety ──────────────────────────
    se_m = re.search(r'Side Effects(?:\s*\d+)?(.*?)(?:When to Stop|References|Quality Indicators|$)', main, re.DOTALL)
    if se_m:
        se_text = se_m.group(1)[:2000]
        bullets = re.findall(r'[•\-]\s*([^\n•\-]{15,200})', se_text)
        if not bullets:
            sentences = [s.strip() for s in re.split(r'(?<=[.!])\s+', se_text) if len(s.strip()) > 20]
            bullets = sentences[:6]
        p['sideEffects'] = [clean(b)[:200] for b in bullets[:8]]
    else:
        p['sideEffects'] = []

    # ── 16. Quick Start Guide ──────────────────────────────
    qs_m = re.search(r'Quick Start Guide(.*?)(?:Help Us|Community Insights|Poll Results|Was this helpful|$)', main, re.DOTALL)
    quick = {}
    if qs_m:
        qs_text = qs_m.group(1)[:800]
        labels = [
            ('Typical Dose', 'dose'), ('How Often', 'frequency'),
            ('How to Take', 'howToTake'), ('Best Timing', 'bestTiming'),
            ('Effects Timeline', 'effectsTimeline'), ('Break Between', 'breakBetween'),
            ('Cycle Length', 'cycleLength'), ('Storage', 'storageNote'),
        ]
        label_positions = []
        for lb, key in labels:
            idx = qs_text.find(lb)
            if idx >= 0:
                label_positions.append((idx, lb, key))
        label_positions.sort()
        for j, (pos, lb, key) in enumerate(label_positions):
            start = pos + len(lb)
            end = label_positions[j+1][0] if j+1 < len(label_positions) else min(start+150, len(qs_text))
            value = clean(qs_text[start:end])[:120]
            if value:
                quick[key] = value
    p['quickStart'] = quick

    # ── 17. 태그 ────────────────────────────────────────
    p['tags'] = [ind['name'] for ind in indications[:5]]

    return p


def main():
    print("peptides.txt 읽는 중...")
    with open(INPUT_FILE, 'r', encoding='utf-8') as f:
        text = f.read()
    print(f"파일 크기: {len(text):,}자")

    sections = re.split(r'={60}\nURL: (https://pep-pedia\.org/peptides/[^\n]+)\n={60}', text)
    total = (len(sections) - 1) // 2
    print(f"총 {total}개 섹션 발견\n")

    peptides = {}
    index_list = []

    for i in range(1, len(sections) - 1, 2):
        url = sections[i].strip()
        peptide_id = url.split('/')[-1]
        content = sections[i + 1] if i + 1 < len(sections) else ''

        try:
            p = parse_peptide(content, peptide_id)
            p['sourceUrl'] = url
            peptides[peptide_id] = p
            index_list.append({
                'id': peptide_id,
                'nameEn': p['nameEn'],
                'nameKo': p['nameKo'],
                'subtitle': p['subtitle'],
                'routes': p['routes'],
                'researchStatus': p['researchStatus'],
                'isApproved': p['isApproved'],
                'tags': p['tags'],
                'typicalDose': p['typicalDose'],
                'cycle': p['cycle'],
            })
            status_icon = '✅' if p['researchStatus'] in ['Extensively Studied','Well Researched'] else '🔬'
            print(f"  {status_icon} {peptide_id}: {p['nameEn']} | {p['researchStatus']} | {p['routes']} | 용량:{p['typicalDose']}")
        except Exception as e:
            import traceback
            print(f"  ❌ {peptide_id}: {e}")
            traceback.print_exc()

    result = {
        'version': '3.0',
        'lastUpdated': datetime.now().isoformat(),
        'totalCount': len(peptides),
        'index': index_list,
        'peptides': peptides,
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"\n✅ 저장: {OUTPUT_FILE}")
    print(f"총 {len(peptides)}개")

    # 샘플 검증
    sample_id = '5-amino-1mq'
    if sample_id in peptides:
        s = peptides[sample_id]
        print(f"\n[샘플: {sample_id}]")
        print(f"  이름: '{s['nameEn']}'")
        print(f"  부제목: '{s['subtitle']}'")
        print(f"  경로: {s['routes']}")
        print(f"  용량: '{s['typicalDose']}'")
        print(f"  주기: '{s['cycle']}'")
        print(f"  저장: '{s['storage']}'")
        print(f"  설명: '{s['descriptionEn'][:100]}...'")
        print(f"  인디케이션: {[i['name'] for i in s['researchIndications']]}")
        print(f"  프로토콜: {len(s['protocols'])}개")
        print(f"  상호작용: {len(s['interactions'])}개")
        print(f"  부작용: {len(s['sideEffects'])}개")
        print(f"  타임라인: {len(s['effectsTimeline'])}개")
        print(f"  QuickStart: {s['quickStart']}")


if __name__ == '__main__':
    main()
