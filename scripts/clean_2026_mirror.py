#!/usr/bin/env python3
"""2026 真题文本层整行字符镜像修复（字典判别方向）。

读取 data-raw/exams/2026-exam.txt（含 <<<PAGE n>>> 标记），对每一非空、非标记行
用 ecdict 词典 + 中文常用双字词分别给「正向 / 反向」打分，反向显著更高则整行反转。
输出到 data-raw/exams/2026-clean.txt（不覆盖原文件，便于对照）。
幂等：纯函数，结果只取决于输入。
"""
import os
import re

ROOT = os.path.dirname(__file__)
SRC = os.path.join(ROOT, "..", "data-raw", "exams", "2026-exam.txt")
OUT = os.path.join(ROOT, "..", "data-raw", "exams", "2026-exam.txt")
ECDICT = os.path.join(ROOT, "..", "data-raw", "ecdict.csv")

PAGE_RE = re.compile(r"^<<<PAGE\s+\d+>>>$")

# 中文常用双字词（与 TS 侧 ZH_COMMON_BIGRAMS 同口径）
ZH_BIGRAMS = [
    "我们", "他们", "你们", "这个", "那个", "什么", "一个", "一些", "可以", "应该", "或者", "因为",
    "所以", "但是", "如果", "已经", "没有", "就是", "也是", "还有", "对于", "关于", "通过", "进行",
    "问题", "答案", "参考", "试卷", "考试", "英语", "题目", "选择", "文章", "阅读", "理解", "翻译",
    "写作", "词汇", "完形", "填空", "对话", "口语", "交际", "评论", "研究", "工作", "生活", "自己",
    "重要", "影响", "环境", "社会", "学生", "大学", "可能", "需要", "认为", "表示", "发现", "知道",
    "时间", "现在", "以后", "以前", "时候", "地方", "一样", "不同", "非常", "更多", "以及其他",
]

CJK_RE = re.compile(r"[一-鿿]")


def load_dict() -> set[str]:
    words: set[str] = set()
    with open(ECDICT, "r", encoding="utf-8") as f:
        header = f.readline()
        for line in f:
            word = line.split(",", 1)[0].strip().lower()
            if len(word) >= 2:
                words.add(word)
    return words


def has_cjk(s: str) -> bool:
    return bool(CJK_RE.search(s))


def zh_score(s: str) -> int:
    return sum(2 for bg in ZH_BIGRAMS if bg in s)


DICT: set[str] = load_dict()


def en_score(s: str) -> int:
    """子串命中法：统计 s 中作为英文字典词的子串数（长词权重更高）。
    同时覆盖「有空格」与「无空格粘连镜像」两种行——反转后真词子串会显著增多。"""
    score = 0
    low = s.lower()
    n = len(low)
    # 仅扫描长度 3..14 的子串（过长无意义，过短噪声大）
    for i in range(n):
        ch = low[i]
        if not (("a" <= ch <= "z")):
            continue
        for j in range(i + 3, min(i + 15, n + 1)):
            sub = low[i:j]
            if sub in DICT:
                score += 1 if len(sub) <= 5 else 2
    return score


def line_score(s: str) -> int:
    return en_score(s) + zh_score(s)


def reverse_line(s: str) -> str:
    return "".join(reversed(s))


def fix_line(line: str) -> tuple[str, bool]:
    if line.strip() == "" or PAGE_RE.match(line.strip()):
        return line, False
    if not has_cjk(line):
        fwd = line_score(line)
        rev = line_score(reverse_line(line))
        if rev > fwd and rev > 0:
            return reverse_line(line), True
        return line, False
    # 含中文：镜像行反转后中文双字词命中更多
    fwd = line_score(line)
    rev = line_score(reverse_line(line))
    if rev > fwd and rev > 0:
        return reverse_line(line), True
    return line, False


def main() -> None:
    with open(SRC, "r", encoding="utf-8") as f:
        lines = f.read().split("\n")
    out = []
    total = 0
    reversed_cnt = 0
    for ln in lines:
        fixed, changed = fix_line(ln)
        if changed:
            reversed_cnt += 1
        if ln.strip() != "":
            total += 1
        out.append(fixed)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print(f"非空行 {total}，反转 {reversed_cnt} -> {OUT}")


if __name__ == "__main__":
    main()
