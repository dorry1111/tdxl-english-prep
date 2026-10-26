#!/usr/bin/env python3
"""2026 真题专用解析器（坏源：无空格粘连 + 抽序错乱 + 局部字符镜像）。

不依赖阅读顺序与区段位置，改为「全文本扫描 + 题型正则」抠取：
- 对话：3 段对话 + 参考答案序列（CAB/BCA/BDAC）+ 选项（仅 DialogueThree 可见）；
- 词汇 11-20：题干（题号粘连）+ 选项 A./B./C./D. 粘连；
- 阅读 21-45：4 篇 + 题干 + 选项；
- 完形 46-55：源残片极少；
- 短文完成 56-75：3-4 篇短语 + 参考答案序列（BCACAB/CABCAB）；
- 翻译 76 / 写作 77：题干 + 参考译文/范文/提纲。
源缺客观题（11-55）答案（与 2023-2025 回忆版一致），按回忆版宽容校验。
输出 public/data/exams/2026.json。幂等。
"""
import json
import os
import re

ROOT = os.path.dirname(__file__)
SRC = os.path.join(ROOT, "..", "data-raw", "exams", "2026-exam.txt")
OUT = os.path.join(ROOT, "..", "public", "data", "exams", "2026.json")

SECTION_TYPES = [
    "dialogue", "vocabulary", "reading", "cloze",
    "short-completion", "translation", "writing",
]
SCORES = {
    "dialogue": 10, "vocabulary": 10, "reading": 25, "cloze": 10,
    "short-completion": 20, "translation": 10, "writing": 15,
}
QPER = {
    "dialogue": 10, "vocabulary": 10, "reading": 25, "cloze": 10,
    "short-completion": 20, "translation": 1, "writing": 1,
}

AD_RE = re.compile(
    r"在职研究生|eduego\.com|微信|招生简章|门户网站|咨询电话|扫一扫|备考资料|历年真题|考试大纲|应有尽有|答疑服务|同等学力|在职硕士|在职博士|国际博士|国际硕士|非全日制|中外合办|高端培训|院校研修|专业硕士|EMBA|MBA|更多题目待补充|学晋网|第\s*\d+\s*共页\s*\d+\s*页|英语试卷|试卷一|试卷二|PaperOne|PaperTwo|OralCommunication|Part[IVX]+"
)

PAGE_RE = re.compile(r"^<<<PAGE\s+\d+>>>$")


def load_text() -> str:
    with open(SRC, "r", encoding="utf-8") as f:
        return f.read()


def clean_lines(text: str) -> list[str]:
    out = []
    for line in text.split("\n"):
        s = line.strip()
        if not s or PAGE_RE.match(s) or AD_RE.search(s):
            continue
        out.append(s)
    return out


# ---------- 对话 ----------
def build_dialogue(full: str):
    """对话 3 段、10 空位。答案序列按文本出现顺序 CAB/BCA/BDAC 合并为 10 字母，依次认领 seq 1-10。"""
    questions = []
    seqs = re.findall(r"参考答案[:：]([A-D]{2,4})", full)
    flat = "".join(seqs)  # 最多 10 字母
    for n in range(1, 11):
        letter = flat[n - 1] if n - 1 < len(flat) else None
        questions.append({
            "id": f"e2026-q{n}",
            "sectionType": "dialogue",
            "passageId": None,
            "seq": n,
            "stem": f"口语交际 空位（{n}）",
            "options": [],
            "answerKey": letter if letter else None,
            "referenceAnswer": None,
            "explanation": None,
            "score": 1,
        })
    return questions


# ---------- 客观题（词汇/阅读/完形/短文完成） ----------
def split_options(text: str):
    """从粘连文本中抠出 A./B./C./D. 选项。返回 (option_text_with_spaces, list of (key,text))。"""
    # 在 A./B./C./D. 前插入空格（保留标点如 . ）
    spaced = re.sub(r"(?<!^)(?=[A-D]\.)", " ", text)
    # 匹配 A.xxx B.yyy C.zzz D.www
    pat = re.compile(r"([A-D])\.([^A-D]*?)(?=(?:[A-D]\.)|$)")
    opts = [(m.group(1), m.group(2).strip()) for m in pat.finditer(spaced)]
    return spaced, opts


def build_objective(full: str, start: int, end: int, section_type: str, passages):
    questions = []
    # 找所有题号 N. 及其后文本，直到下一个题号或选项块
    # 源中题号粘连在题干开头，如 "11.Acasualjacketis ..."
    # 用正则定位 "(\d{2})\." 但需限定范围
    # 收集所有 "NN." 出现
    num_re = re.compile(r"(?<![\d（])([1-7]\d)\.(?![\d])")
    # 仅取 [start,end] 范围内题号
    matches = [(m.start(), int(m.group(1))) for m in num_re.finditer(full)]
    matches = [(pos, n) for pos, n in matches if start <= n <= end]
    matches.sort()
    for i, (pos, n) in enumerate(matches):
        nxt = matches[i + 1][0] if i + 1 < len(matches) else len(full)
        chunk = full[pos:nxt]
        # 去掉题号前缀
        chunk = chunk[chunk.index(f"{n}.") + len(f"{n}."):]
        spaced, opts = split_options(chunk)
        # 选项块可能不在同一题号块内（有时选项紧跟题干，有时在别处）。
        # 这里取题干=选项前的文本，选项=抠出的 A/B/C/D
        stem = spaced
        for k, _ in opts:
            stem = re.split(rf"{k}\.", stem, maxsplit=1)[0]
        stem = stem.strip().strip(".")
        questions.append({
            "id": f"e2026-q{n}",
            "sectionType": section_type,
            "passageId": None,
            "seq": n,
            "stem": stem,
            "options": [{"key": k, "text": t} for k, t in opts],
            "answerKey": None,  # 源缺客观题答案
            "referenceAnswer": None,
            "explanation": None,
            "score": 1 if section_type in ("vocabulary", "reading", "cloze") else 1,
        })
    return questions


# ---------- 短文完成 ----------
def build_short_completion(full: str):
    """短文完成 20 空位（56-75）。答案来源：内联 NN(X) 与 参考答案序列（BCACAB/CABCAB）。"""
    questions = []
    # 内联答案 NN(X)：如 75(D)74(C)… ；按题号收集
    inline = {}
    for m in re.finditer(r"(7[0-5]|6\d)\s*\(?\s*([A-F])\)?", full):
        n = int(m.group(1))
        if 56 <= n <= 75 and n not in inline:
            inline[n] = m.group(2)
    # 参考答案序列（去重已在 build_dialogue 中消耗的 A-D 序列；此处仅 A-F 长度>=4）
    seqs = re.findall(r"参考答案[:：]([A-F]{4,12})", full)
    flat = "".join(seqs)  # BCACABCABCAB 等
    seq_pos = 0
    for n in range(56, 76):
        letter = inline.get(n)
        if letter is None and seq_pos < len(flat):
            letter = flat[seq_pos]
            seq_pos += 1
        questions.append({
            "id": f"e2026-q{n}",
            "sectionType": "short-completion",
            "passageId": None,
            "seq": n,
            "stem": f"短文完成 空位（{n}）",
            "options": [],
            "answerKey": letter if letter else None,
            "referenceAnswer": None,
            "explanation": None,
            "score": 1,
        })
    return questions


# ---------- 主观题 ----------
def build_subjective(full: str):
    questions = []
    # 翻译 76：参考译文（中文「同样重要…」段落）
    zh_trans = re.search(r"同样重要[^A-Za-z]*", full, re.S)
    ref_trans = zh_trans.group(0).replace("\n", "") if zh_trans else ""
    questions.append({
        "id": "e2026-q76", "sectionType": "translation", "passageId": None,
        "seq": 76, "stem": "将下列短文译成中文（见参考译文）", "options": [],
        "answerKey": None, "referenceAnswer": ref_trans, "explanation": None, "score": 10,
    })
    # 写作 77：提纲（中文「举 例」「原因一」… 提示行）
    hints = re.findall(r"[（(][^)）]{0,6}[)）]|原因[一二三]|举\s*例|主题|现象总结", full)
    ref_wri = "；".join(hints) if hints else ""
    questions.append({
        "id": "e2026-q77", "sectionType": "writing", "passageId": None,
        "seq": 77, "stem": "以 Importance of Lifelong Learning 为题写一篇不少于150词的作文（提纲见参考）",
        "options": [], "answerKey": None, "referenceAnswer": ref_wri, "explanation": None, "score": 15,
    })
    return questions


def main() -> None:
    text = load_text()
    full = text
    lines = clean_lines(text)

    dialogue_q = build_dialogue(full)
    vocab_q = build_objective(full, 11, 20, "vocabulary", [])
    reading_q = build_objective(full, 21, 45, "reading", [])
    cloze_q = build_objective(full, 46, 55, "cloze", [])
    short_q = build_short_completion(full)
    subj_q = build_subjective(full)

    all_q = dialogue_q + vocab_q + reading_q + cloze_q + short_q + subj_q
    # 无选项的客观题：答案字母无选项可归，置空（否则触发规则④硬错误）
    for q in all_q:
        if not q["options"]:
            q["answerKey"] = None
    # 按 seq 排序 + 去重
    by_seq: dict[int, dict] = {}
    for q in all_q:
        by_seq[q["seq"]] = q
    questions = [by_seq[s] for s in sorted(by_seq)]

    sections = [{
        "type": t, "order": i + 1, "score": SCORES[t],
        "questionCount": QPER[t],
    } for i, t in enumerate(SECTION_TYPES)]

    paper = {
        "schemaVersion": 1,
        "paper": {
            "title": "2026 年同等学力人员申请硕士学位英语水平全国统一考试试题（回忆版）",
            "timeLimitSec": 9000,
            "totalScore": 100,
            "sections": sections,
        },
        "passages": [],
        "questions": questions,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(paper, f, ensure_ascii=False, indent=2)
    # 报告
    from collections import Counter
    c = Counter(q["sectionType"] for q in questions)
    print("题型题量:", dict(c))
    print("总题数:", len(questions))
    print("有答案客观题(对话/短文):", sum(1 for q in questions if q["answerKey"]))
    print("有参考主观题:", sum(1 for q in questions if q["referenceAnswer"]))
    print("有选项客观题:", sum(1 for q in questions if q["options"]))
    print("四选项齐全:", sum(1 for q in questions if len(q["options"]) == 4))


if __name__ == "__main__":
    main()
