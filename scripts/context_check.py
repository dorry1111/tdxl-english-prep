# -*- coding: utf-8 -*-
"""打印可疑条目在字母序中的上下文，辅助判断真实词形"""
import json

words = json.load(open('data-raw/outline_words.json', encoding='utf-8'))

bad_words = ['ot', 'ot.', 'ot. 1', 'ot．↑', 'peq', 'aur', 'Joop', 'dul', 'enba',
             'wi.1', 'plou', 'poolJ', 'poou', 'puno', 'aux', 'sn', 'ensn',
             '1oom', 'pnol', 'clumpsy', 'crulty', 'dwaft', 'quaterly', 'tabo0',
             '1 congratulate', 'among( st', 'ax(e', 'dialog( ue', 'neighbo(u) r',
             'skil(D ful', 'congratulation(s']

for i, w in enumerate(words):
    if w['word'] in bad_words:
        lo = max(0, i-2); hi = min(len(words), i+3)
        ctx = [(j, words[j]['word'], words[j]['page']) for j in range(lo, hi)]
        print(f"--- idx {i} | word={w['word']!r} page={w['page']} senses={[s['text'][:20] for s in w['senses']]}")
        for j, x, p in ctx:
            mark = '>>>' if j == i else '   '
            print(f"{mark} [{j}] p{p} {x}")
        print()
