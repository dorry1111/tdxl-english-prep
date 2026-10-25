"""解析同等等学力考纲词表 xlsx，输出标准化 JSON。

xlsx 本质是 zip：解析 xl/worksheets/sheet1.xml，单元格文本可能以内联
(<is><t>) 或共享字符串两种方式存储，这里都处理。
"""
import zipfile
import xml.etree.ElementTree as ET
import json
import re
from collections import Counter
from pathlib import Path

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
SRC = Path("data-raw/同等学力词汇_2016.xlsx")
OUT = Path("data-raw/words_parsed.json")


def load_shared(z):
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        root = ET.fromstring(z.read("xl/sharedStrings.xml"))
        for si in root.findall(NS + "si"):
            shared.append("".join(t.text or "" for t in si.iter(NS + "t")))
    return shared


def parse_rows(path):
    z = zipfile.ZipFile(path)
    shared = load_shared(z)
    sheet = [n for n in z.namelist() if re.match(r"xl/worksheets/sheet\d+\.xml$", n)][0]
    root = ET.fromstring(z.read(sheet))
    rows = []
    for row in root.iter(NS + "row"):
        vals = []
        for c in row.findall(NS + "c"):
            inline = " ".join("".join(t.text or "" for t in c.iter(NS + "t")).split())
            v = c.find(NS + "v")
            if inline:
                vals.append(inline)
            elif v is not None and v.text is not None:
                if c.get("t") == "s":
                    idx = int(v.text)
                    vals.append(shared[idx] if idx < len(shared) else "")
                else:
                    vals.append(v.text)
            else:
                vals.append("")
        rows.append(vals)
    return [r for r in rows if any(x.strip() for x in r)]


def main():
    rows = parse_rows(SRC)
    print("有效行数:", len(rows))
    print("列数分布:", Counter(len(r) for r in rows))
    print()
    for i, r in enumerate(rows[:10]):
        print(f"[{i}]", " || ".join(x.strip()[:40] for x in r))
    print("...")
    for r in rows[-3:]:
        print("[-]", " || ".join(x.strip()[:40] for x in r))

    OUT.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
    print("\n已保存", OUT)


if __name__ == "__main__":
    main()
