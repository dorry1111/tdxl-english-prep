# -*- coding: utf-8 -*-
"""大纲词汇 -> PWA 应用分片数据 (public/data/words/core-<letter>.json + core-index.json)
norm 规则与 src/lib/wordbookCache.ts normalizeWord 保持一致（NFD 去变音符 + 小写）

v2 索引（T08）：entries 为紧凑行数组 [norm, headword, sourceOrder, frequencyRank|null, shard]，
运行时从索引即可完成候选排序与前缀搜索，不必加载全部分片。
- sourceOrder = 大纲原序（outline_words.json 原始下标，唯一）
- frequencyRank = ECDICT frq 排名（缺失为 null，排序回退 sourceOrder）
- shard = 分片文件名（core-index.json 的 shards 清单声明，运行时不硬编码 26 片）"""
import json, re, unicodedata, os

words = json.load(open('data-raw/outline_words.json', encoding='utf-8'))

def normalize_word(raw):
    s = unicodedata.normalize('NFD', raw)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = unicodedata.normalize('NFC', s)
    return re.sub(r'\s+', ' ', s.lower().strip())

def norm_key(s):
    return re.sub(r'[^a-z]', '', s.lower())

# frequencyRank：按 ECDICT frq（语料频次，越大越常用）降序排名，无 frq 的排最后
with_frq = [(i, w) for i, w in enumerate(words) if w.get('frq')]
with_frq.sort(key=lambda x: -float(x[1]['frq']))
rank = {}
for r, (i, w) in enumerate(with_frq):
    rank[i] = r + 1

entries = []
for i, w in enumerate(words):
    norm = normalize_word(w['word'])
    key = norm_key(norm)
    if not key:
        print('!! 无法归一化:', w['word']); continue
    e = {
        'id': f'core:{key}',
        'bookId': 'core',
        'headword': w['word'],
        'norm': key,
        'sourceOrder': i,
        'meanings': [{'pos': s.get('pos') or '', 'cn': s['text']} for s in w['senses']],
    }
    if w.get('phonetic'):
        e['phoneticUk'] = w['phonetic']
    if i in rank:
        e['frequencyRank'] = rank[i]
    if w.get('page'):
        e['outlinePage'] = w['page']
    if w.get('sensesFrom'):
        e['sensesFrom'] = w['sensesFrom']
    entries.append(e)

# norm 去重（同 key 保留释义多者）
seen = {}
for e in entries:
    if e['norm'] in seen:
        old = seen[e['norm']]
        if len(e['meanings']) > len(old['meanings']):
            seen[e['norm']] = e
    else:
        seen[e['norm']] = e
entries = sorted(seen.values(), key=lambda e: e['norm'])

# 分片（文件名在索引 shards 清单里声明，letter 单字段命名，超 800 词时改 core-s1/s2 需同步改这里）
out_dir = 'public/data/words'
os.makedirs(out_dir, exist_ok=True)
shards = {}
for e in entries:
    shards.setdefault(e['norm'][0], []).append(e)

shard_names = []
index_entries = []
for letter in sorted(shards):
    name = f'core-{letter}.json'
    shard_names.append(name)
    path = f'{out_dir}/{name}'
    json.dump({'letter': letter, 'words': shards[letter]}, open(path, 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    for e in shards[letter]:
        index_entries.append([
            e['norm'], e['headword'], e['sourceOrder'], e.get('frequencyRank'), name,
        ])

index = {
    'bookId': 'core',
    'version': 2,
    'total': len(entries),
    'shards': shard_names,
    'entries': index_entries,
}
json.dump(index, open(f'{out_dir}/core-index.json', 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

print(f"分片完成: {len(entries)} 词条 -> {len(shards)} 个字母分片 + index")
print(f"有音标: {sum(1 for e in entries if 'phoneticUk' in e)}；有词频: {sum(1 for e in entries if 'frequencyRank' in e)}")
total_check = len(index_entries)
print(f"分片总数校验: {total_check} == {index['total']} -> {total_check == index['total']}")
orders = [row[2] for row in index_entries]
print(f"sourceOrder 唯一: {len(set(orders)) == len(orders)}；有词频行: {sum(1 for r in index_entries if r[3] is not None)}")
idx_size = os.path.getsize(f'{out_dir}/core-index.json')
print(f"索引体积: {idx_size/1024:.0f}KB (预算 <320KB)")
