# -*- coding: utf-8 -*-
"""词组表清理：修复 OCR 碎片伪词条 + 补缺失释义（全部经页面原图核实）+ 跨页重复去重"""
import json

ph = json.load(open('data-raw/phrase_table.json', encoding='utf-8'))
print('清理前:', len(ph))

# (word, page) -> 操作；senses 为最终释义；None=删除；'merge_into'=并入目标词
FIX = {
    ('make the best of/make the most', 196): {'word': 'make the best of / make the most of',
        'senses': [{'pos': '', 'text': '充分利用'}]},                      # JO=of 残片并回
    ('JO', 196): {'delete': True},
    ('Both... and', 197): {'senses': [{'pos': '', 'text': '既……又……'}]},   # 原书 p197
    ('by air (railway, sea, plane, bus', 197): {'word': 'by air (railway, sea, plane, bus, truck, etc.)',
        'senses': [{'pos': '', 'text': '乘飞机（火车、轮船、飞机、公共汽车、卡车等）'}]},
    ('have nothing/something', 200): {'word': 'have nothing / something to do with',
        'senses': [{'pos': '', 'text': '与…无关/有关'}]},                  # with 残片并回
    ('op', 200): {'delete': True},
    ('to', 200): {'delete': True},
    ('with', 200): {'delete': True},
    ('run', 211): {'word': 'run across', 'senses': [{'pos': '', 'text': '偶然遇到'}]},
    ('across', 211): {'delete': True},
    ('show in', 212): {'senses': [{'pos': '', 'text': '领入'}]},            # 原书 p212
    ('no sooner ... than', 213): {'word': 'no sooner ... than ...',
        'senses': [{'pos': '', 'text': '一……就……'}]},                     # 原书 p213
    ('from time to time', 215): {'senses': [{'pos': '', 'text': '时常'}]},  # 原书 p215
    ('on time', 215): {'senses': [{'pos': '', 'text': '准时'}]},            # 原书 p215
    # 跨页重复：保留释义更全的一条
    ('catch fire', 202): {'delete': True},          # 保留 p198 '着火,烧着'
    ('in the first place', 202): {'delete': True},  # 保留 p209 '首先,第一'
    ('once in a while', 216): {'delete': True},     # 保留 p208 '偶尔,有时'
}
WHAT_IF_MERGE_FROM = ('what if', 216)   # 释义并入 ('what if', 205)
WHAT_IF_KEEP = ('what if', 205)

what_if_extra = next(p['senses'] for p in ph if (p['word'], p['page']) == WHAT_IF_MERGE_FROM)

changed, deleted = 0, 0
out = []
for p in ph:
    key = (p['word'], p['page'])
    if key in FIX:
        op = FIX[key]
        if op.get('delete'):
            deleted += 1
            continue
        if 'word' in op:
            p['word'] = op['word']
        if 'senses' in op:
            p['senses'] = op['senses']
            changed += 1
    if key == WHAT_IF_KEEP:
        p['senses'] = p['senses'] + what_if_extra
        changed += 1
    out.append(p)

# 同名词组去重（保留先出现者；above all 两处同页重复在此消除）
seen, final = set(), []
for p in out:
    k = p['word'].lower().replace(' ', '')
    if k in seen:
        deleted += 1
        continue
    seen.add(k)
    final.append(p)

json.dump(final, open('data-raw/phrase_table.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'清理后: {len(final)}（修改 {changed} 条，删除 {deleted} 条）')
# 验证
for probe in ['make the best of / make the most of', 'Both... and', 'by air (railway, sea, plane, bus, truck, etc.)',
              'have nothing / something to do with', 'run across', 'show in', 'no sooner ... than ...',
              'from time to time', 'on time', 'what if']:
    hit = [p for p in final if p['word'] == probe]
    s = hit[0]['senses'] if hit else '!!!缺失'
    print(f"  {probe}: {s if hit else s}")
empty = [p['word'] for p in final if not p['senses']]
print('仍无释义:', empty)
