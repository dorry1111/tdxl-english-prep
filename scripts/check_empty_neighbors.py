# -*- coding: utf-8 -*-
import json
words = json.load(open('data-raw/outline_words.json', encoding='utf-8'))
targets = {'ad','aeroplane','anyone','anyway','bike','dorm','everyone','exam','fridge',
           'gray','gym','lab','linger','maths','photo','rat','soup','TV','two','whatsoever'}
for i, w in enumerate(words):
    if w['word'] in targets:
        lo, hi = max(0, i-2), min(len(words), i+3)
        print(f"--- {w['word']} (p{w['page']})")
        for j in range(lo, hi):
            ww = words[j]
            mark = '>>>' if j == i else '   '
            s = [(x['pos'], x['text'][:24]) for x in ww['senses'][:4]]
            print(f"{mark} {ww['word']}: {s}")
        print()
