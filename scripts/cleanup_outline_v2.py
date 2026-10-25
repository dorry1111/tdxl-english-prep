# -*- coding: utf-8 -*-
"""大纲词汇数据清理 v2：修复 OCR 误判、大小写敏感去重、断行释义合并、音标回填"""
import json, csv, re, unicodedata

words = json.load(open('data-raw/outline_words.json', encoding='utf-8'))
report = json.load(open('data-raw/parse_report.json', encoding='utf-8'))
backfilled = {x['word'] for x in report['ecdict_senses']}

RENAME = {
    ('peq', 13): 'bad', ('op', 50): 'do', ('Joop', 50): 'door', ('dul', 52): 'dull',
    ('dwaft', 52): 'dwarf', ('enba', 57): 'equal', ('poolJ', 67): 'flood',
    ('plou', 80): 'hold', ('1oom', 99): 'loom', ('pnol', 99): 'loud',
    ('poou', 108): 'mood', ('puno', 146): 'round', ('sn', 183): 'us',
    ('ensn', 183): 'usual', ('1 congratulate', 34): 'congratulate',
    ('clumpsy', 30): 'clumsy', ('crulty', 40): 'cruelty', ('quaterly', 135): 'quarterly',
    ('tabo0', 171): 'taboo', ('Z00', 194): 'zoo',
    ('among( st', 6): 'among(st)', ('ax(e', 12): 'ax(e)', ('dialog( ue', 46): 'dialog(ue)',
    ('congratulation(s', 35): 'congratulation(s)', ('neighbo(u) r', 111): 'neighbo(u)r',
    ('skil(D ful', 156): 'skil(l)ful', ('submit (to', 167): 'submit(to)',
}
MERGE_PREV = {
    ('ot', 8), ('ot', 10), ('ot', 20), ('ot', 26), ('ot', 39), ('ot', 52), ('ot', 59),
    ('ot', 64), ('ot', 67), ('ot', 78), ('ot', 82), ('ot', 92), ('ot', 93), ('ot', 95),
    ('ot', 101), ('ot', 109), ('ot', 114), ('ot.', 119), ('ot', 125), ('ot.', 135),
    ('ot. 1', 136), ('ot', 137), ('ot', 138), ('ot', 140), ('ot', 141), ('ot', 141),
    ('ot', 152), ('ot', 153), ('ot', 153), ('ot．↑', 162), ('ot', 163), ('ot', 179),
    ('ot', 183), ('ot', 184), ('ot. j', 180), ('aur', 118), ('aux', 103), ('aux', 193),
    ('wi.1', 75), ('aur', 50),
}
DELETE = {('ot. 1', 105)}

# 手工修复（依据页面图像核实）
MANUAL_SENSES = {
    'do': [
        {'pos': 'aux. v.', 'text': '［构成疑问句和否定句］；［代替动词］；［用于加强语气］'},
        {'pos': 'vt.', 'text': '做，干，办；完成，做完；产生'},
        {'pos': 'vi.', 'text': '做，行动，进行；行，合适'},
    ],
    'overlook': [{'pos': 'vt.', 'text': '忽视，忽略；俯瞰，远眺'}],
}

POS_RE = re.compile(r'^(a\.|adv\.|v\.|vt\.|vi\.|n\.|prep\.|conj\.|pron\.|num\.|interj\.|aux\.|abbr\.|art\.|α\.)')
END_PUNCT = ('，', '；', '、', '（', '，', ';', ',')

def clean_text(t):
    return re.sub(r'\s+', '', t) if re.search(r'[\u4e00-\u9fff]', t) else t.strip()

def join_senses(senses):
    out = []
    for s in senses:
        text, pos = clean_text(s['text']), (s.get('pos') or '').strip()
        if not text:
            continue
        if out:
            prev = out[-1]
            is_cont = (not pos and not POS_RE.match(text)) or \
                      (prev['text'].endswith(END_PUNCT) and (not pos or pos == prev['pos']))
            if is_cont:
                prev['text'] += text
                continue
        if out and out[-1]['text'] == text and out[-1]['pos'] == pos:
            continue
        out.append({'pos': pos, 'text': text})
    return out

# ---- pass 1: 重命名/合并/删除 ----
result, merged_n = [], 0
for w in words:
    key = (w['word'], w['page'])
    if key in DELETE:
        continue
    if key in MERGE_PREV:
        if result:
            prev = result[-1]
            if prev['word'] in backfilled and not prev.get('manual'):
                prev['senses'] = []
                backfilled.discard(prev['word'])
            prev['senses'] += w['senses']
            merged_n += 1
        continue
    if key in RENAME:
        w['word'] = RENAME[key]
    w['word'] = re.sub(r'\s+', ' ', w['word']).strip()
    result.append(w)
words = result

# ---- pass 2: 大小写敏感去重（China/china、May/may 是不同词条） ----
def dedup_key(s):
    return s.strip()
def norm(s):
    s = unicodedata.normalize('NFKD', s.lower())
    return re.sub(r'[^a-z]', '', s)

seen, dups = {}, []
for w in words:
    k = dedup_key(w['word'])
    if k in seen:
        old = seen[k]
        if len(w['senses']) > len(old['senses']):
            old['senses'], old['page'] = w['senses'], w['page']
        dups.append(w['word'])
    else:
        seen[k] = w
words = list(seen.values())

# 同拼写不同大小写但 norm 相同的（resume/Resume 类）仅在 senses 完全互补时才保留，
# 这里保留两条（PDF 大纲本来就是两个词条），不做额外处理

# ---- pass 3: 手工修复 + 断行合并 ----
for w in words:
    if w['word'] in MANUAL_SENSES:
        w['senses'] = MANUAL_SENSES[w['word']]
        w['manual'] = True
    else:
        w['senses'] = join_senses(w['senses'])

# ---- pass 4: ECDICT 音标回填 ----
def fold(s):
    return ''.join(c for c in unicodedata.normalize('NFKD', s) if not unicodedata.combining(c))

phon = {}
with open('data-raw/ecdict.csv', encoding='utf-8', newline='') as f:
    for row in csv.DictReader(f):
        w = row['word'].strip().lower()
        if w and row.get('phonetic', '').strip() and w not in phon:
            phon[w] = row['phonetic'].strip()

phon_filled, still_no_phon = [], []
for w in words:
    if w.get('phonetic'):
        continue
    wl = w['word'].lower()
    cands = {wl}
    cands.add(wl.replace('(', '').replace(')', ''))          # wag(g)on->waggon
    cands.add(re.sub(r'\(e\)', '', wl))                       # ax(e)->ax
    cands.add(re.sub(r'\(e\)', 'e', wl))                      # ax(e)->axe
    cands.add(fold(wl))                                       # café->cafe
    cands.add(wl.split('/')[0])                               # advertise/-ize->advertise
    cands.add(re.sub(r'\(e\)', '', wl.split('/')[0]))
    hit = next((c for c in cands if c in phon), None)
    if hit:
        w['phonetic'] = phon[hit]
        phon_filled.append(w['word'])
    else:
        still_no_phon.append(w['word'])

# ---- 输出 ----
words.sort(key=lambda w: norm(w['word']))
json.dump(words, open('data-raw/outline_words.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

print(f"词汇总数: {len(words)}（原始 5736）")
print(f"合并入前词条目: {merged_n}；去重: {len(dups)} {dups}")
print(f"音标回填: {len(phon_filled)}；仍无音标: {len(still_no_phon)} {still_no_phon}")
empty_senses = [w['word'] for w in words if not w['senses']]
print(f"无释义条目: {len(empty_senses)} {empty_senses}")
for probe in ['do', 'appreciate', 'china', 'China', 'may', 'May', 'march', 'March', 'hold', 'loud']:
    hit = next((w for w in words if w['word'] == probe), None)
    print(f"  {probe}: " + (str([(s['pos'], s['text'][:16]) for s in hit['senses'][:3]]) if hit else '!!! 缺失'))
