"""把考纲原始词表转换成项目标准词库 JSON。

原始格式（4 列）：单词 | 英音 | 美音 | 释义
目标格式：符合 ARCHITECTURE 中 Word 实体，字段见下。
释义里的词性标记（n. / vt. / adj. ...）会被拆出来放进 pos，其余保留。
"""
import json
import re
import unicodedata
from pathlib import Path

SRC = Path("data-raw/words_parsed.json")
FREQ_SRC = Path("data-raw/en_freq_50k.txt")
OUT_FULL = Path("data-raw/wordbook_full.json")
OUT_TOP = Path("data-raw/core_top500.json")
OUT_STAT = Path("data-raw/wordbook_stat.json")

# 词频表外的词统一排到这个位次之后，保持「生僻词靠后」
FREQ_TAIL_BASE = 60000

# 功能词（冠词/代词/介词/连词/助动词）。这些词频次极高但对备考没有记忆价值，
# 排序时整体后置，避免「核心 500」被 the / of / and 占满。
STOPWORDS = set("""
i me my myself we our ours ourselves you your yours yourself yourselves
he him his himself she her hers herself it its itself they them their theirs
themselves what which who whom this that these those
am is are was were be been being have has had having do does did doing
a an the and but if or because as until while
of at by for with about against between into through during before after
above below to from up down in out on off over under again further then once
here there when where why how
all any both each few more most other some such no nor not only own same
so than too very can will just should now
""".split())


# 口语/语气词。词频表取自影视字幕，这类词频次虚高但考试价值为零，同样后置。
ORAL_WORDS = set("""
oh yeah yep nope ok okay hey hi hello huh hmm ah uh um wow ha haha
gonna wanna gotta dunno ma pa sir madam bye goodbye
god damn hell shit fuck
""".split())


def is_low_priority(norm_word: str) -> bool:
    """功能词与口语词都不该占用「核心 500」的名额。"""
    return norm_word in STOPWORDS or norm_word in ORAL_WORDS


def load_freq_ranks():
    """读取词频表，返回 norm -> 频次排名（1 为最高频）。"""
    ranks = {}
    if not FREQ_SRC.exists():
        return ranks
    lines = FREQ_SRC.read_text(encoding="utf-8", errors="ignore").splitlines()
    for i, line in enumerate(lines):
        parts = line.rsplit(" ", 1)
        if not parts:
            continue
        w = parts[0].strip()
        if w and w not in ranks:
            ranks[w] = i + 1
    return ranks

# 词性标记，长的放前面避免 v. 抢先匹配掉 vt.
POS_RE = re.compile(
    r"\b(a\.|ad\.|adj\.|adv\.|art\.|aux\.|conj\.|int\.|interj\.|n\.|num\.|prep\.|"
    r"pron\.|v\.|vi\.|vt\.|pl\.|abbr\.)\s*",
    re.IGNORECASE,
)

# 标准化：小写、去首尾空白、去重音符号（café -> cafe）
def norm(word: str) -> str:
    word = word.strip().lower()
    word = unicodedata.normalize("NFD", word)
    word = "".join(ch for ch in word if unicodedata.category(ch) != "Mn")
    return word


def split_pos(meaning: str):
    """把 'n. 放任；狂热 vt. 遗弃' 拆成结构化义项。

    返回 (pos 汇总字符串, 义项列表 [{pos, text}, ...])。
    每个义项从当前词性标记之后，到下一个词性标记之前。
    词性标记可能带附加括号（如 'n.(复数)'），一并跳过。
    """
    marks = list(POS_RE.finditer(meaning))
    senses = []
    if not marks:
        text = re.sub(r"\s+", " ", meaning).strip()
        return "", [{"pos": "", "text": text}] if text else []

    for i, m in enumerate(marks):
        start = m.end()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(meaning)
        text = re.sub(r"\s+", " ", meaning[start:end]).strip(" ；;，,")
        if text:
            senses.append({"pos": m.group(1).lower().rstrip("."), "text": text})

    pos = "/".join(dict.fromkeys(s["pos"] for s in senses if s["pos"]))
    return pos, senses


def main():
    rows = json.loads(SRC.read_text(encoding="utf-8"))
    header, body = rows[0], rows[1:]
    freq = load_freq_ranks()

    seen = {}
    dup = []
    no_phonetic = []

    for r in body:
        if len(r) < 4:
            continue
        word = r[0].strip()
        if not word or not re.match(r"^[A-Za-z][A-Za-z\-\s'’.]*$", word):
            continue
        key = norm(word)
        if key in seen:
            dup.append(word)
            continue
        uk, us, meaning = r[1].strip(), r[2].strip(), r[3].strip()
        pos, senses = split_pos(meaning)
        if not uk and not us:
            no_phonetic.append(word)
        seen[key] = {
            "word": word,
            "norm": key,
            "phoneticUK": uk,
            "phoneticUS": us,
            "pos": pos,
            "meaning": senses,
            "meaningRaw": meaning,
            "frequencyRank": freq.get(key, FREQ_TAIL_BASE + len(seen)),
            "letter": key[0] if key[:1].isalpha() else "#",
        }

    # 全量按字母序输出，便于按首字母分片
    words = sorted(seen.values(), key=lambda x: x["norm"])
    OUT_FULL.write_text(json.dumps(words, ensure_ascii=False, indent=0), encoding="utf-8")

    # 核心高频词：实词优先，功能词后置，同组内按真实词频
    by_freq = sorted(
        words,
        key=lambda x: (is_low_priority(x["norm"]), x["frequencyRank"], x["norm"]),
    )
    top500 = by_freq[:500]
    OUT_TOP.write_text(json.dumps(top500, ensure_ascii=False, indent=0), encoding="utf-8")

    in_freq = sum(1 for w in words if w["frequencyRank"] < FREQ_TAIL_BASE)
    stat = {
        "total": len(words),
        "duplicates": len(dup),
        "noPhonetic": len(no_phonetic),
        "withPos": sum(1 for w in words if w["pos"]),
        "freqCovered": in_freq,
        "freqUncovered": len(words) - in_freq,
        "functionWords": sum(1 for w in words if is_low_priority(w["norm"])),
        "top500Head": [w["word"] for w in top500[:15]],
        "sample": words[:3] + words[2000:2002],
    }
    OUT_STAT.write_text(json.dumps(stat, ensure_ascii=False, indent=2), encoding="utf-8")

    print("表头:", header)
    print("原始数据行:", len(body))
    print("去重后词条:", len(words))
    print("重复词:", len(dup))
    print("缺音标:", len(no_phonetic))
    print("带词性标注:", stat["withPos"])
    print("命中词频表:", in_freq, "/ 未命中:", len(words) - in_freq)
    print("全量文件:", round(OUT_FULL.stat().st_size / 1024 / 1024, 2), "MB")
    print("核心500:", round(OUT_TOP.stat().st_size / 1024, 1), "KB")
    print()
    print("核心 500 首 15 个（应是真正的高频词）:")
    print("  ", ", ".join(stat["top500Head"]))
    print()
    for w in stat["sample"]:
        print(json.dumps(w, ensure_ascii=False))


if __name__ == "__main__":
    main()
