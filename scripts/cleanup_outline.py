# -*- coding: utf-8 -*-
"""大纲词汇数据清理 v1：修复 OCR 误判条目、规范词形、回填音标、合并断行释义"""
import json, csv, re, unicodedata

words = json.load(open('data-raw/outline_words.json', encoding='utf-8'))
report = json.load(open('data-raw/parse_report.json', encoding='utf-8'))
backfilled = {x['word'] for x in report['ecdict_senses']}  # 释义来自ECDICT回填的词

# ---------- 1. 修复映射 ----------
# (word, page) -> 新词形（OCR乱码→真实词形，全部经字母序上下文+页面图像核实）
RENAME = {
    ('peq', 13): 'bad', ('op', 50): 'do', ('Joop', 50): 'door', ('dul', 52): 'dull',
    ('dwaft', 52): 'dwarf', ('enba', 57): 'equal', ('poolJ', 67): 'flood',
    ('plou', 80): 'hold', ('1oom', 99): 'loom', ('pnol', 99): 'loud',
    ('poou', 108): 'mood', ('puno', 146): 'round', ('sn', 183): 'us',
    ('ensn', 183): 'usual', ('1 congratulate', 34): 'congratulate',
    ('clumpsy', 30): 'clumsy', ('crulty', 40): 'cruelty', ('quaterly', 135): 'quarterly',
    ('tabo0', 171): 'taboo', ('Z00', 194): 'zoo',
    # 括号变体格式规范化
    ('among( st', 6): 'among(st)', ('ax(e', 12): 'ax(e)', ('dialog( ue', 46): 'dialog(ue)',
    ('congratulation(s', 35): 'congratulation(s)', ('neighbo(u) r', 111): 'neighbo(u)r',
    ('skil(D ful', 156): 'skil(l)ful', ('submit (to', 167): 'submit(to)',
}
# (word, page) -> 并入前一条目（OCR把前词的释义续行/aux标记误判为词头），删除本条
MERGE_PREV = {
    ('ot', 8), ('ot', 10), ('ot', 20), ('ot', 26), ('ot', 39), ('ot', 52), ('ot', 59),
    ('ot', 64), ('ot', 67), ('ot', 78), ('ot', 82), ('ot', 92), ('ot', 93), ('ot', 95),
    ('ot', 101), ('ot', 109), ('ot', 114), ('ot.', 119), ('ot', 125), ('ot.', 135),
    ('ot. 1', 136), ('ot', 137), ('ot', 138), ('ot', 140), ('ot', 141), ('ot', 141),
    ('ot', 152), ('ot', 153), ('ot', 153), ('ot．↑', 162), ('ot', 163), ('ot', 179),
    ('ot', 183), ('ot', 184), ('aur', 118), ('aux', 103), ('aux', 193), ('wi.1', 75),
    ('aur', 50),   # do 的释义散落条目（op→do 已重命名，aur 释义并入 do）
}
DELETE = {('ot. 1', 105)}  # 纯垃圾，0释义

# ---------- 2. 词性标记（用于判断释义断行） ----------
POS_RE = re.compile(r'^(a\.|adv\.|v\.|vt\.|vi\.|n\.|prep\.|conj\.|pron\.|num\.|interj\.|aux\.|abbr\.|art\.|&|α\.|ａ\.)')

def join_senses(senses):
    """合并断行释义：以词性标记开头 = 新释义；否则 = 续行，拼接到上一条"""
    out = []
    for s in senses:
        text = re.sub(r'\s+', '', s['text']) if re.search(r'[\u4e00-\u9fff]', s['text']) else s['text'].strip()
        pos = (s.get('pos') or '').strip()
        if out and not pos and not POS_RE.match(text):
            out[-1]['text'] += text
        else:
            if out and out[-1]['text'] == text and out[-1]['pos'] == pos:
                continue  # 完全重复
            out.append({'pos': pos, 'text': text})
    return out

# ---------- 3. 执行修复 ----------
renamed, merged, deleted = [], [], []
result = []
for w in words:
    key = (w['word'], w['page'])
    if key in DELETE:
        deleted.append(key); continue
    if key in MERGE_PREV:
        if result:
            prev = result[-1]
            # 若前词条目释义是ECDICT回填的，优先用OCR真实释义替换
            if prev['word'] in backfilled:
                prev['senses'] = []
                backfilled.discard(prev['word'])
            prev['senses'] = (prev['senses'] + w['senses'])
            merged.append((key, '->', prev['word']))
        continue
    if key in RENAME:
        old = w['word']; w['word'] = RENAME[key]
        renamed.append((old, w['word']))
    # 规范化空白
    w['word'] = re.sub(r'\s+', ' ', w['word']).strip()
    w['senses'] = join_senses(w['senses'])
    result.append(w)

words = result

# ---------- 4. 去重（同一 norm 只留 senses 最多的一条） ----------
def norm(s):
    s = unicodedata.normalize('NFKD', s.lower())
    return re.sub(r'[^a-z]', '', s)
def variant_keys(s):
    base = re.sub(r'[\(\)\s]', '', s.lower())
    keys = {base, base.replace('-ise', '-ize')}
    if base.endswith('(e)'):
        k = base[:-3]; keys.add(k); keys.add(k + 'e')
    keys = {k.replace('(', '').replace(')', '') for k in keys}
    return keys

seen = {}
dups_removed = []
for w in words:
    k = norm(w['word'])
    if k in seen:
        old = seen[k]
        if len(w['senses']) > len(old['senses']):
            old['senses'] = w['senses']; old['page'] = w['page']
        dups_removed.append(w['word'])
    else:
        seen[k] = w
words = list(seen.values())

# ---------- 5. ECDICT 回填音标 ----------
phon = {}
with open('data-raw/ecdict.csv', encoding='utf-8', newline='') as f:
    for row in csv.DictReader(f):
        w = row['word'].strip().lower()
        if w and row.get('phonetic') and w not in phon:
            phon[w] = row['phonetic'].strip()

phon_filled, still_no_phon = [], []
for w in words:
    if not w.get('phonetic'):
        wl = w['word'].lower()
        # 变体形式尝试：去括号、-ise/-ize
        cands = {wl, wl.replace('(', '').replace(')', ''), wl.replace('-ise', '-ize')}
        for c in list(cands):
            if c in phon: cands.add(c + 'e') if (c + 'e') else None
        hit = next((c for c in cands if c in phon), None)
        if hit:
            w['phonetic'] = phon[hit]; phon_filled.append(w['word'])
        else:
            still_no_phon.append(w['word'])

# ---------- 6. 排序输出 ----------
words.sort(key=lambda w: norm(w['word']))
json.dump(words, open('data-raw/outline_words.json', 'w', encoding='utf-8'),
          ensure_ascii=False, indent=1)

print(f"词汇总数: {len(words)}（原 5736）")
print(f"重命名修正: {len(renamed)}  -> {[f'{a}->{b}' for a, b in renamed]}")
print(f"并入前词条目: {len(merged)}")
print(f"删除垃圾: {len(deleted)}")
print(f"去重删除: {len(dups_removed)} {dups_removed}")
print(f"音标回填: {len(phon_filled)}")
print(f"仍无音标: {len(still_no_phon)} {still_no_phon}")
# 验证抽查
for probe in ['do', 'appreciate', 'bad', 'equal', 'flood', 'hold', 'mood', 'round', 'us', 'usual', 'door', 'loom', 'loud', 'overlook', 'reject']:
    hit = next((w for w in words if norm(w['word']) == probe), None)
    if hit:
        print(f"  {probe}: {[s['pos']+s['text'][:18] for s in hit['senses'][:3]]}")
    else:
        print(f"  {probe}: !!! 缺失")
