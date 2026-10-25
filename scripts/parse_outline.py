"""大纲数据提取 v3（最终清洗版）。

产物：
1. outline_words.json   正词汇表（PDF p1~194，附录一）
2. phrase_table.json    词组表（PDF p195~217，附录二）
3. irregular_verbs.json 不规则动词表（PDF p218~222，附录三）
4. parse_report.json    清洗与校验报告
"""
import json
import re
import csv
import unicodedata
from pathlib import Path

SRC = Path("data-raw/ocr/all_pages.json")
ECDICT = Path("data-raw/ecdict.csv")
IMG_DIR = Path("data-raw/ocr/pages")
REPORT = Path("data-raw/parse_report.json")

POS_TOKEN = r"(?:vt|vi|v|n|a|adj|ad|adv|prep|conj|pron|art|num|int|interj|pl|phr|abbr|past|pp|ut|u|t|i)"
POS_RE = re.compile(rf"^\s*({POS_TOKEN})\s*[\.．,，]\s*")
PAGE_NUM_RE = re.compile(r"^[\s·•.:，,。·—\-]*\d{1,3}[\s·•.:，,。·—\-]*$")
EQ_RE = re.compile(r"^([A-Za-z][A-Za-z\-'\s\(\)/]*?)\s*[=＝]\s*([A-Za-z][A-Za-z\-'\s\(\)]*)$")
LEAD_PUNCT = re.compile(r"^[\s\.。．、;；,，:：\-—\[\]()（）\"'“”]+")
TRAIL_PUNCT = re.compile(r"[\s\.。．、;；,，:：\-—\[\]()（）\"'“”]+$")
CJK_RE = re.compile(r"[\u4e00-\u9fff]")

report = {"corrections": [], "suspicious": [], "ecdict_senses": [], "noise_removed": []}


def is_cjk(s):
    return bool(CJK_RE.search(s))


def norm_word(w):
    w = w.strip().lower()
    w = unicodedata.normalize("NFD", w)
    return "".join(ch for ch in w if unicodedata.category(ch) != "Mn")


def get_width(page, cache={}):
    idx = page["page"]
    if idx not in cache:
        from PIL import Image
        with Image.open(IMG_DIR / f"p{idx:03d}.png") as im:
            cache[idx] = im.width
    return cache[idx]


def rebuild_reading_order(page):
    width = get_width(page)
    left, right = [], []
    for it in page["items"]:
        (left if it["x"] < width * 0.42 else right).append(it)
    left.sort(key=lambda b: b["y"])
    right.sort(key=lambda b: b["y"])
    return [it["text"] for it in left + right]


def fix_pos(line):
    m = POS_RE.match(line)
    if not m:
        return None
    pos = m.group(1)
    pos = {"t": "vt", "ut": "vt", "u": "vt", "i": "vi", "ad": "adv"}.get(pos, pos)
    rest = LEAD_PUNCT.sub("", POS_RE.sub("", line, count=1)).strip()
    return pos, rest


def parse_vocab(pages, page_range):
    """通用词条解析：英文行=词条，词性行=义项，中文行=释义/续行。"""
    entries, cur = [], None
    for pg in pages:
        if not (page_range[0] <= pg["page"] <= page_range[1]):
            continue
        for raw in rebuild_reading_order(pg):
            line = raw.strip()
            if not line or PAGE_NUM_RE.match(line) or re.fullmatch(r"[A-Za-z]", line):
                continue
            pos_result = fix_pos(line)
            if pos_result:
                if cur is None:
                    continue
                pos, text = pos_result
                cur["senses"].append({"pos": pos, "text": text})
            elif is_cjk(line):
                if cur:
                    if cur["senses"]:
                        cur["senses"][-1]["text"] += line
                    else:
                        cur["senses"].append({"pos": "", "text": line})
            else:
                cleaned = LEAD_PUNCT.sub("", TRAIL_PUNCT.sub("", line)).strip()
                if len(cleaned) < 2:
                    continue
                cur = {"word": cleaned, "senses": [], "page": pg["page"]}
                m = EQ_RE.match(cleaned)
                if m:
                    cur["word"] = m.group(1).strip()
                    cur["alias"] = m.group(2).strip()
                entries.append(cur)
    return entries


def parse_irregular(pages, page_range=(218, 222)):
    """不规则动词表：三栏（不定式/过去式/过去分词）。

    分栏不用固定比例，取块左缘 x0 排序后最大的两个间隙作为分界。
    """
    rows = []
    for pg in pages:
        if not (page_range[0] <= pg["page"] <= page_range[1]):
            continue
        items = [it for it in pg["items"]
                 if re.fullmatch(r"[A-Za-z/\(\)\s\.]+", it["text"].strip())
                 and it["text"].strip()]
        if len(items) < 6:
            continue
        xs = sorted(set(it["x"] for it in items))
        gaps = sorted(((xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)), reverse=True)
        if len(gaps) < 2 or gaps[0][0] < 60:
            continue
        b1, b2 = sorted((gaps[0][1], gaps[1][1]))
        t1 = (xs[b1] + xs[b1 + 1]) / 2
        t2 = (xs[b2] + xs[b2 + 1]) / 2
        cols = [[], [], []]
        for it in items:
            col = 0 if it["x"] < t1 else 1 if it["x"] < t2 else 2
            cols[col].append((it["y"], it["text"].strip()))
        for c in cols:
            c.sort()
        n = min(len(c) for c in cols)
        if max(len(c) for c in cols) - n > 2:
            report["suspicious"].append({"word": f"irregular p{pg['page']} 栏数不齐", "page": pg["page"],
                                         "candidates": [len(c) for c in cols]})
        for i in range(n):
            rows.append({"base": cols[0][i][1], "past": cols[1][i][1], "pp": cols[2][i][1]})
    return rows


def load_ecdict():
    table = {}
    with ECDICT.open(encoding="utf-8", newline="") as f:
        for row in csv.DictReader(f):
            w = row["word"].strip().lower()
            if w and w not in table:
                table[w] = {
                    "phonetic": row["phonetic"].strip(),
                    "translation": row["translation"].strip(),
                    "bnc": row["bnc"].strip(),
                    "frq": row["frq"].strip(),
                }
    return table


def edits1(w):
    letters = "abcdefghijklmnopqrstuvwxyz-'"
    splits = [(w[:i], w[i:]) for i in range(len(w) + 1)]
    d = [l + r[1:] for l, r in splits if r]
    t = [l + r[1] + r[0] + r[2:] for l, r in splits if len(r) > 1]
    r_ = [l + c + r[1:] for l, r in splits if r for c in letters]
    i_ = [l + c + r for l, r in splits for c in letters]
    return set(d + t + r_ + i_)


def variant_keys(word):
    """拼写变体展开：advertise/-ize → [advertise, advertize]；alumin(i)um → [aluminium, aluminum]。"""
    keys = [word]
    if "/" in word:
        base, suf = word.split("/", 1)
        # advertise/-ize：后缀替换；check/cheque：整词替换
        m = re.match(r"^([\-A-Za-z]*)([A-Za-z]+)$", suf)
        if m and base and not base.endswith("-"):
            stem = re.sub(r"[A-Za-z]+$", "", base) if m.group(1) else base
        keys.append(base.rstrip("-"))
        if m and base.endswith("-") is False and "/" in word:
            keys.append(base + suf.lstrip("-"))
        keys.append(suf.lstrip("-"))
    if "(" in word:
        keys.append(re.sub(r"[()]", "", word))            # alumin(i)um → aluminium
        keys.append(re.sub(r"\([a-z]*\)", "", word))      # alumin(i)um → alumin
    keys.append(re.sub(r"[\(\)/-]", "", word))
    return [k.strip().lower() for k in keys if k.strip()]


def main():
    pages = json.loads(SRC.read_text(encoding="utf-8"))
    ecd = load_ecdict()
    print("ECDICT 词条:", len(ecd))

    # ---------- 1. 正词汇表 ----------
    entries = parse_vocab(pages, (1, 194))
    print("词汇表原始词条:", len(entries))

    for e in entries:
        # 拼写变体 → 查 ECDICT（advertise/-ize → advertise）
        ref = None
        for k in variant_keys(e["word"]):
            if k in ecd:
                ref = ecd[k]
                e["norm"] = k
                break
        # 编辑距离纠错
        key = norm_word(e["word"])
        if not ref and len(key) >= 4 and "=" not in e["word"]:
            cands = [v for v in edits1(key) if v in ecd]
            if len(cands) == 1:
                fixed = cands.pop()
                report["corrections"].append({"from": e["word"], "to": fixed, "page": e["page"]})
                e["word"], e["norm"] = fixed, fixed
                ref = ecd[fixed]
            elif len(cands) > 1:
                report["suspicious"].append({"word": e["word"], "page": e["page"], "candidates": sorted(cands)[:6]})
        if ref and "norm" not in e:
            e["norm"] = norm_word(e["word"])
        if ref:
            e["phonetic"] = ref["phonetic"]
            e["bnc"] = ref["bnc"]
            e["frq"] = ref["frq"]
        else:
            e["phonetic"] = e["bnc"] = e["frq"] = ""
        # OCR 漏检义项的真词：用 ECDICT 中文释义补
        if not e["senses"] and ref and ref["translation"] and "alias" not in e:
            e["senses"] = [{"pos": "", "text": ref["translation"].replace("\n", " ")}]
            report["ecdict_senses"].append({"word": e["word"], "page": e["page"]})
        for s in e["senses"]:
            s["text"] = LEAD_PUNCT.sub("", s["text"]).strip()
        e["senses"] = [s for s in e["senses"] if s["text"]]
        # 纯噪声行（ot / peq 等，无音标无义项且不在 ECDICT）
        if not e["senses"] and not e.get("phonetic") and "alias" not in e and len(e["word"]) <= 4 \
                and not re.search(r"[\(\)/=]", e["word"]):
            report["noise_removed"].append({"word": e["word"], "page": e["page"]})
            e["_noise"] = True

    kept = [e for e in entries if not e.get("_noise")]
    print(f"词汇表清洗后: {len(kept)}（剔除噪声 {len(entries)-len(kept)}）")

    # ---------- 2. 词组表 ----------
    phrases = parse_vocab(pages, (195, 217))
    print("词组表原始词条:", len(phrases))
    for p_ in phrases:
        for s in p_["senses"]:
            s["text"] = LEAD_PUNCT.sub("", s["text"]).strip()
        p_["senses"] = [s for s in p_["senses"] if s["text"]]

    # ---------- 3. 不规则动词表 ----------
    verbs = parse_irregular(pages)
    print("不规则动词:", len(verbs))

    Path("data-raw/outline_words.json").write_text(
        json.dumps(kept, ensure_ascii=False, indent=0), encoding="utf-8")
    Path("data-raw/phrase_table.json").write_text(
        json.dumps(phrases, ensure_ascii=False, indent=0), encoding="utf-8")
    Path("data-raw/irregular_verbs.json").write_text(
        json.dumps(verbs, ensure_ascii=False, indent=0), encoding="utf-8")

    no_phon = [e for e in kept if not e["phonetic"]]
    report["no_phonetic"] = [{"word": e["word"], "page": e["page"], "senses": len(e["senses"])} for e in no_phon]
    report["stats"] = {
        "vocab": len(kept), "phrases": len(phrases), "irregular": len(verbs),
        "no_phonetic_vocab": len(no_phon),
        "corrections": len(report["corrections"]),
    }
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    print()
    print(f"最终：词汇 {len(kept)} / 词组 {len(phrases)} / 不规则动词 {len(verbs)}")
    print(f"词汇无音标: {len(no_phon)}（含词组型拼写变体）")
    print(f"ECDICT 补义项: {len(report['ecdict_senses'])}；纠错 {len(report['corrections'])}；剔噪 {len(report['noise_removed'])}")


if __name__ == "__main__":
    main()
