# -*- coding: utf-8 -*-
"""大纲词汇补录脚本（唯一允许修改 outline_words.json 的增量脚本）。

背景：parse_outline.py/cleanup_outline_v4.py 从未处理 OCR 第 0 页（词汇表首页，
两栏 24 个词条 a/an..accelerate），且第 58 页栏底词头 evening 被粘连进 even 的释义。
本脚本做三件确定性修复：
  1. 插入 25 个经页面图像人工核实的漏录词条（释义转录自 data-raw/ocr/pages/pNNN.png）；
  2. 修复 even 词条中被误并入的 evening 释义（n.晚上，傍晚,黄昏）；
  3. 修复词头括号未闭合的 'goodby(e' -> 'goodby(e)'（对齐 v4 RENAME 的同类修复）。
音标/词频按 cleanup_outline_v4.py 的同一约定从 data-raw/ecdict.csv 回填。
排序键与 v4 最终输出一致：NFKD + 小写 + 仅保留 a-z。

注意：严禁重跑 parse_outline.py / cleanup_outline_v*.py（会覆盖本脚本及其他人工修复）。
"""
import csv
import json
import re
import unicodedata

OUTLINE = 'data-raw/outline_words.json'
ECDICT = 'data-raw/ecdict.csv'

# ---------------------------------------------------------------- 新增词条
# 释义逐一转录自页面图像（data-raw/ocr/pages/p000.png、p058.png、p059.png 人工核对）
NEW_WORDS = [
    # -- OCR 第 0 页（附录一词汇表首页，两栏，左栏 + 右栏） --
    {'word': 'a/an', 'page': 0, 'ec': 'a', 'senses': [
        {'pos': 'art.', 'text': '一（个）；每一（个）；（同类事物中的）任何一个'}]},
    {'word': 'abandon', 'page': 0, 'senses': [
        {'pos': 'vt.', 'text': '放弃,抛弃,离弃'}]},
    {'word': 'ability', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '能力,才能,才干'}]},
    {'word': 'able', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '有能力(的);能干的'}]},
    {'word': 'abnormal', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '反常的,不规则的;变态的'}]},
    {'word': 'aboard', 'page': 0, 'senses': [
        {'pos': 'ad./prep.', 'text': '在船/车/飞行器上;上船/车/飞行器'}]},
    {'word': 'abolish', 'page': 0, 'senses': [
        {'pos': 'vt.', 'text': '废除,废止;取消,革除'}]},
    {'word': 'abortion', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '流产,小产'}]},
    {'word': 'about', 'page': 0, 'senses': [
        {'pos': 'prep.', 'text': '关于,对于;在...周围,在...附近'},
        {'pos': 'ad.', 'text': '在周围,附近;大约,差不多'}]},
    {'word': 'above', 'page': 0, 'senses': [
        {'pos': 'prep.', 'text': '在...之上,超过'},
        {'pos': 'a.', 'text': '上面的,上述的'},
        {'pos': 'ad.', 'text': '在上面,以上'}]},
    {'word': 'abroad', 'page': 0, 'senses': [
        {'pos': 'ad.', 'text': '国外,海外;传开'}]},
    {'word': 'abrupt', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '生硬的;突然的;唐突的'}]},
    {'word': 'absence', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '缺席;缺乏'}]},
    {'word': 'absent', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '（from)缺席的;缺乏的;漫不经心的'}]},
    {'word': 'absolute', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '绝对的,完全的'}]},
    {'word': 'absorb', 'page': 0, 'senses': [
        {'pos': 'vt.', 'text': '吸收;吸引，（in)使专心'}]},
    {'word': 'abstract', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '摘要,提要'},
        {'pos': 'a.', 'text': '抽象的,不具体的'}]},
    {'word': 'absurd', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '荒谬的,荒唐的'}]},
    {'word': 'abundance', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '充裕,丰富'}]},
    {'word': 'abundant', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '充裕的;丰富的'}]},
    {'word': 'abuse', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '滥用,虐待;辱骂;陋习,弊端'},
        {'pos': 'vt.', 'text': '滥用,虐待;辱骂'}]},
    {'word': 'academic', 'page': 0, 'senses': [
        {'pos': 'a.', 'text': '学术的;学院的'}]},
    {'word': 'academy', 'page': 0, 'senses': [
        {'pos': 'n.', 'text': '学院;学会/协会;研究院'}]},
    {'word': 'accelerate', 'page': 0, 'senses': [
        # 词头在第 0 页右栏栏底，释义延续到第 1 页顶部（p001.png 核实）
        {'pos': 'vt.', 'text': '使加快；使增速'},
        {'pos': 'vi.', 'text': '加速;促进;增加'}]},
    # -- 第 58 页右栏栏底词头，释义在第 59 页顶部（p058/p059.png 核实） --
    {'word': 'evening', 'page': 58, 'senses': [
        {'pos': 'n.', 'text': '晚上，傍晚,黄昏'}]},
]

# even 词条中被误并入的 evening 释义（OCR 栏底粘连，见 p058.png 底部/数据核实）
EVEN_GHOST_SENSE = {'pos': 'n.', 'text': '晚上，傍晚,黄昏'}
# 词头括号未闭合（v4 RENAME 修复了同类项但漏掉此条）
GOODBYE_OLD, GOODBYE_NEW = 'goodby(e', 'goodby(e)'


def norm_v4(s: str) -> str:
    """与 cleanup_outline_v4.py 最终排序键一致。"""
    s = unicodedata.normalize('NFKD', s.lower())
    return re.sub(r'[^a-z]', '', s)


def load_ecdict_meta(keys: set) -> dict:
    """从 ECDICT 取 phonetic/bnc/frq（首个命中行，与 v4 约定一致）。"""
    meta = {}
    with open(ECDICT, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            w = row['word'].strip().lower()
            if w in keys and w not in meta:
                meta[w] = {
                    'phonetic': row.get('phonetic', '').strip(),
                    'bnc': row.get('bnc', '').strip(),
                    'frq': row.get('frq', '').strip(),
                }
    return meta


def main() -> None:
    words = json.load(open(OUTLINE, encoding='utf-8'))
    n_before = len(words)

    # ---- 修复 1: even 的粘连释义 ----
    even = next((w for w in words if w['word'] == 'even'), None)
    assert even is not None, 'even 词条缺失，数据异常'
    before_senses = [dict(s) for s in even['senses']]
    even['senses'] = [s for s in even['senses']
                      if not (s.get('pos') == EVEN_GHOST_SENSE['pos']
                              and s.get('text') == EVEN_GHOST_SENSE['text'])]
    removed = len(before_senses) - len(even['senses'])
    print(f"[fix] even: 移除误并入的 evening 释义 x{removed}")
    assert removed == 1, 'even 修复数量异常'

    # ---- 修复 2: goodby(e 词头闭合 ----
    goodbye = next((w for w in words if w['word'] == GOODBYE_OLD), None)
    if goodbye is not None:
        goodbye['word'] = GOODBYE_NEW
        goodbye['norm'] = norm_v4(GOODBYE_NEW)
        print(f"[fix] 词头修复: {GOODBYE_OLD} -> {GOODBYE_NEW}")
    else:
        print(f"[skip] 未发现 {GOODBYE_OLD}（可能已修复）")

    # ---- 插入新词条 ----
    have = {norm_v4(w['word']) for w in words}
    ec_keys = {nw.get('ec') or nw['word'].lower() for nw in NEW_WORDS}
    meta = load_ecdict_meta(ec_keys)

    inserted, skipped = [], []
    for nw in NEW_WORDS:
        k = norm_v4(nw['word'])
        if not k:
            raise ValueError(f'无法归一化: {nw["word"]}')
        if k in have:
            skipped.append(nw['word'])
            continue
        m = meta.get(nw.get('ec') or nw['word'].lower(), {})
        entry = {
            'word': nw['word'],
            'senses': nw['senses'],
            'page': nw['page'],
            'norm': k,
            'phonetic': m.get('phonetic', ''),
            'bnc': m.get('bnc', ''),
            'frq': m.get('frq', ''),
        }
        inserted.append(entry)
        have.add(k)

    if skipped:
        raise SystemExit(f'以下词条已存在，拒绝重复插入: {skipped}')

    words.extend(inserted)
    words.sort(key=lambda w: norm_v4(w['word']))
    json.dump(words, open(OUTLINE, 'w', encoding='utf-8'),
              ensure_ascii=False, indent=1)

    print(f'[done] 插入 {len(inserted)} 词，总数 {n_before} -> {len(words)}')
    for e in inserted:
        print(f"  + {e['word']:<12} p{e['page']}  phon={e['phonetic'] or '-'} "
              f"bnc={e['bnc'] or '-'} frq={e['frq'] or '-'}  "
              f"senses={len(e['senses'])}")


if __name__ == '__main__':
    main()
