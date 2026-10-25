# -*- coding: utf-8 -*-
"""词形变化规则生成（A5）：为内置词库全部单词生成高置信度的复数/三单/过去式/过去分词/现在分词。

设计原则：宁缺毋滥——规则不确定的词整个字段跳过，由前端隐藏。

v2 修正（2026-10-25 审计后发现的问题）：
1. CVC 双写原来对多音节词也生效，导致 abandon→abandonned、happen→happenned、
   open→openned 等 162 词错误（多音节词只有重音在末音节才双写，如 admit→admitted）。
   现在：双写仅限单音节词；多音节词走 STRESS_FINAL_DOUBLE 白名单。
2. 不规则动词表原来混入了 want/use/work 等纯规则词，会被标 irregular=True 显示
   「不规则」标签。现在：表内只保留真不规则动词。
3. 清理了带数字后缀的无效键（am/are/has/does/goes/says/shine2/xxx2 等）。

产出 data-raw/memos/inflections.json（{norm: {...}} 扁平结构），由 merge_memos.py 合并。
"""
import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WORDS_DIR = os.path.join(ROOT, "public", "data", "words")
OUT = os.path.join(ROOT, "data-raw", "memos", "inflections.json")

# ---------- 不规则动词表（base: [third, past, pastParticiple, presentParticiple]） ----------
# 只收真不规则（三态有型变或拼写不变的熟词）；纯规则动词一律走规则分支，
# 否则会被打上 irregular 标签误导用户。
IRREGULAR_VERBS = {
    "be": ["is", "was/were", "been", "being"],
    "have": ["has", "had", "had", "having"],
    "do": ["does", "did", "done", "doing"],
    "go": ["goes", "went", "gone", "going"],
    "get": ["gets", "got", "got/gotten", "getting"],
    "say": ["says", "said", "said", "saying"],
    "make": ["makes", "made", "made", "making"],
    "see": ["sees", "saw", "seen", "seeing"],
    "know": ["knows", "knew", "known", "knowing"],
    "think": ["thinks", "thought", "thought", "thinking"],
    "take": ["takes", "took", "taken", "taking"],
    "come": ["comes", "came", "come", "coming"],
    "find": ["finds", "found", "found", "finding"],
    "give": ["gives", "gave", "given", "giving"],
    "tell": ["tells", "told", "told", "telling"],
    "feel": ["feels", "felt", "felt", "feeling"],
    "become": ["becomes", "became", "become", "becoming"],
    "leave": ["leaves", "left", "left", "leaving"],
    "put": ["puts", "put", "put", "putting"],
    "mean": ["means", "meant", "meant", "meaning"],
    "keep": ["keeps", "kept", "kept", "keeping"],
    "let": ["lets", "let", "let", "letting"],
    "begin": ["begins", "began", "begun", "beginning"],
    "show": ["shows", "showed", "shown/showed", "showing"],
    "hear": ["hears", "heard", "heard", "hearing"],
    "run": ["runs", "ran", "run", "running"],
    "bring": ["brings", "brought", "brought", "bringing"],
    "write": ["writes", "wrote", "written", "writing"],
    "sit": ["sits", "sat", "sat", "sitting"],
    "stand": ["stands", "stood", "stood", "standing"],
    "lose": ["loses", "lost", "lost", "losing"],
    "pay": ["pays", "paid", "paid", "paying"],
    "meet": ["meets", "met", "met", "meeting"],
    "set": ["sets", "set", "set", "setting"],
    "learn": ["learns", "learned/learnt", "learned/learnt", "learning"],
    "lead": ["leads", "led", "led", "leading"],
    "understand": ["understands", "understood", "understood", "understanding"],
    "speak": ["speaks", "spoke", "spoken", "speaking"],
    "read": ["reads", "read", "read", "reading"],
    "spend": ["spends", "spent", "spent", "spending"],
    "grow": ["grows", "grew", "grown", "growing"],
    "win": ["wins", "won", "won", "winning"],
    "teach": ["teaches", "taught", "taught", "teaching"],
    "buy": ["buys", "bought", "bought", "buying"],
    "die": ["dies", "died", "died", "dying"],
    "send": ["sends", "sent", "sent", "sending"],
    "build": ["builds", "built", "built", "building"],
    "fall": ["falls", "fell", "fallen", "falling"],
    "cut": ["cuts", "cut", "cut", "cutting"],
    "rise": ["rises", "rose", "risen", "rising"],
    "break": ["breaks", "broke", "broken", "breaking"],
    "choose": ["chooses", "chose", "chosen", "choosing"],
    "deal": ["deals", "dealt", "dealt", "dealing"],
    "catch": ["catches", "caught", "caught", "catching"],
    "drive": ["drives", "drove", "driven", "driving"],
    "drink": ["drinks", "drank", "drunk", "drinking"],
    "eat": ["eats", "ate", "eaten", "eating"],
    "wear": ["wears", "wore", "worn", "wearing"],
    "throw": ["throws", "threw", "thrown", "throwing"],
    "sleep": ["sleeps", "slept", "slept", "sleeping"],
    "forget": ["forgets", "forgot", "forgotten", "forgetting"],
    "hide": ["hides", "hid", "hidden", "hiding"],
    "hold": ["holds", "held", "held", "holding"],
    "hurt": ["hurts", "hurt", "hurt", "hurting"],
    "lie": ["lies", "lay", "lain", "lying"],
    "lay": ["lays", "laid", "laid", "laying"],
    "ride": ["rides", "rode", "ridden", "riding"],
    "ring": ["rings", "rang", "rung", "ringing"],
    "sell": ["sells", "sold", "sold", "selling"],
    "shake": ["shakes", "shook", "shaken", "shaking"],
    "shine": ["shines", "shone", "shone", "shining"],
    "shoot": ["shoots", "shot", "shot", "shooting"],
    "sing": ["sings", "sang", "sung", "singing"],
    "sink": ["sinks", "sank", "sunk", "sinking"],
    "swim": ["swims", "swam", "swum", "swimming"],
    "tear": ["tears", "tore", "torn", "tearing"],
    "wake": ["wakes", "woke", "woken", "waking"],
    "fly": ["flies", "flew", "flown", "flying"],
    "blow": ["blows", "blew", "blown", "blowing"],
    "draw": ["draws", "drew", "drawn", "drawing"],
    "fight": ["fights", "fought", "fought", "fighting"],
    "seek": ["seeks", "sought", "sought", "seeking"],
    "bear": ["bears", "bore", "born/borne", "bearing"],
    "beat": ["beats", "beat", "beaten", "beating"],
    "bite": ["bites", "bit", "bitten", "biting"],
    "burn": ["burns", "burned/burnt", "burned/burnt", "burning"],
    "dream": ["dreams", "dreamed/dreamt", "dreamed/dreamt", "dreaming"],
    "lean": ["leans", "leaned/leant", "leaned/leant", "leaning"],
    "smell": ["smells", "smelled/smelt", "smelled/smelt", "smelling"],
    "spell": ["spells", "spelled/spelt", "spelled/spelt", "spelling"],
    "spill": ["spills", "spilled/spilt", "spilled/spilt", "spilling"],
    "spoil": ["spoils", "spoiled/spoilt", "spoiled/spoilt", "spoiling"],
    "light": ["lights", "lit/lighted", "lit/lighted", "lighting"],
    "quit": ["quits", "quit", "quit", "quitting"],
    "prove": ["proves", "proved", "proven/proved", "proving"],
    "hang": ["hangs", "hung", "hung", "hanging"],
    "saw": ["saws", "sawed", "sawed/sawn", "sawing"],
    "sew": ["sews", "sewed", "sewed/sewn", "sewing"],
    "shrink": ["shrinks", "shrank", "shrunk", "shrinking"],
    "strike": ["strikes", "struck", "struck/stricken", "striking"],
    "swear": ["swears", "swore", "sworn", "swearing"],
    "sweep": ["sweeps", "swept", "swept", "sweeping"],
    "undergo": ["undergoes", "underwent", "undergone", "undergoing"],
    "undertake": ["undertakes", "undertook", "undertaken", "undertaking"],
    "withdraw": ["withdraws", "withdrew", "withdrawn", "withdrawing"],
    "withstand": ["withstands", "withstood", "withstood", "withstanding"],
    "arise": ["arises", "arose", "arisen", "arising"],
    "forbid": ["forbids", "forbade", "forbidden", "forbidding"],
    "forgive": ["forgives", "forgave", "forgiven", "forgiving"],
    "freeze": ["freezes", "froze", "frozen", "freezing"],
    "steal": ["steals", "stole", "stolen", "stealing"],
    "stick": ["sticks", "stuck", "stuck", "sticking"],
    "sting": ["stings", "stung", "stung", "stinging"],
    "swing": ["swings", "swung", "swung", "swinging"],
    "spin": ["spins", "spun", "spun", "spinning"],
    "weave": ["weaves", "wove", "woven", "weaving"],
    "leap": ["leaps", "leaped/leapt", "leaped/leapt", "leaping"],
    "kneel": ["kneels", "kneeled/knelt", "kneeled/knelt", "kneeling"],
    "dwell": ["dwells", "dwelled/dwelt", "dwelled/dwelt", "dwelling"],
    "bend": ["bends", "bent", "bent", "bending"],
    "bind": ["binds", "bound", "bound", "binding"],
    "bleed": ["bleeds", "bled", "bled", "bleeding"],
    "breed": ["breeds", "bred", "bred", "breeding"],
    "cast": ["casts", "cast", "cast", "casting"],
    "creep": ["creeps", "crept", "crept", "creeping"],
    "feed": ["feeds", "fed", "fed", "feeding"],
    "flee": ["flees", "fled", "fled", "fleeing"],
    "grind": ["grinds", "ground", "ground", "grinding"],
    "knead": ["kneads", "kneaded", "kneaded", "kneading"],
    "lend": ["lends", "lent", "lent", "lending"],
    "mislead": ["misleads", "misled", "misled", "misleading"],
    "overcome": ["overcomes", "overcame", "overcome", "overcoming"],
    "oversee": ["oversees", "oversaw", "overseen", "overseeing"],
    "rebuild": ["rebuilds", "rebuilt", "rebuilt", "rebuilding"],
    "redo": ["redoes", "redid", "redone", "redoing"],
    "remake": ["remakes", "remade", "remade", "remaking"],
    "repay": ["repays", "repaid", "repaid", "repaying"],
    "reset": ["resets", "reset", "reset", "resetting"],
    "retell": ["retells", "retold", "retold", "retelling"],
    "rewrite": ["rewrites", "rewrote", "rewritten", "rewriting"],
    "rid": ["rids", "rid", "rid", "ridding"],
    "shave": ["shaves", "shaved", "shaved/shaven", "shaving"],
    "shed": ["sheds", "shed", "shed", "shedding"],
    "shut": ["shuts", "shut", "shut", "shutting"],
    "slide": ["slides", "slid", "slid", "sliding"],
    "slit": ["slits", "slit", "slit", "slitting"],
    "speed": ["speeds", "sped", "sped", "speeding"],
    "split": ["splits", "split", "split", "splitting"],
    "spread": ["spreads", "spread", "spread", "spreading"],
    "spring": ["springs", "sprang", "sprung", "springing"],
    "stride": ["strides", "strode", "stridden", "striding"],
    "strive": ["strives", "strove", "striven", "striving"],
    "swell": ["swells", "swelled", "swelled/swollen", "swelling"],
    "thrust": ["thrusts", "thrust", "thrust", "thrusting"],
    "tread": ["treads", "trod", "trodden", "treading"],
    "uphold": ["upholds", "upheld", "upheld", "upholding"],
    "upset": ["upsets", "upset", "upset", "upsetting"],
    "wring": ["wrings", "wrung", "wrung", "wringing"],
    "wind": ["winds", "wound", "wound", "winding"],
    "weep": ["weeps", "wept", "wept", "weeping"],
    "wet": ["wets", "wet/wetted", "wet/wetted", "wetting"],
    "burst": ["bursts", "burst", "burst", "bursting"],
    "bet": ["bets", "bet", "bet", "betting"],
    "bid": ["bids", "bid", "bid", "bidding"],
    "broadcast": ["broadcasts", "broadcast", "broadcast", "broadcasting"],
    "bust": ["busts", "bust/busted", "bust/busted", "busting"],
    "cost": ["costs", "cost", "cost", "costing"],
    "forecast": ["forecasts", "forecast", "forecast", "forecasting"],
    "hit": ["hits", "hit", "hit", "hitting"],
    "input": ["inputs", "input", "input", "inputting"],
    "knit": ["knits", "knitted/knit", "knitted/knit", "knitting"],
    "output": ["outputs", "output", "output", "outputting"],
    "wed": ["weds", "wed/wedded", "wed/wedded", "wedding"],
}

# ---------- 不规则复数（base: plural） ----------
IRREGULAR_PLURALS = {
    "man": "men", "woman": "women", "child": "children", "tooth": "teeth",
    "foot": "feet", "goose": "geese", "mouse": "mice", "louse": "lice",
    "ox": "oxen", "person": "people", "datum": "data", "medium": "media",
    "criterion": "criteria", "phenomenon": "phenomena", "index": "indices",
    "appendix": "appendices", "cactus": "cacti", "focus": "foci",
    "nucleus": "nuclei", "radius": "radii", "syllabus": "syllabi",
    "analysis": "analyses", "crisis": "crises", "thesis": "theses",
    "basis": "bases", "hypothesis": "hypotheses", "diagnosis": "diagnoses",
    "ellipsis": "ellipses", "stimulus": "stimuli", "bacterium": "bacteria",
    "curriculum": "curricula", "memorandum": "memoranda", "genus": "genera",
    "alumnus": "alumni", "alumna": "alumnae", "axis": "axes",
    "oasis": "oases", "parenthesis": "parentheses", "synopsis": "synopses",
    "vertebra": "vertebrae", "vita": "vitae", "stratum": "strata",
    "addendum": "addenda", "erratum": "errata", "symposium": "symposia",
    "quiz": "quizzes", "half": "halves", "knife": "knives", "wife": "wives",
    "life": "lives", "leaf": "leaves", "shelf": "shelves", "thief": "thieves",
    "wolf": "wolves", "calf": "calves", "loaf": "loaves", "self": "selves",
    "scarf": "scarfs/scarves", "dwarf": "dwarfs/dwarves", "hoof": "hoofs/hooves",
    "echo": "echoes", "hero": "heroes", "potato": "potatoes",
    "tomato": "tomatoes", "torpedo": "torpedoes", "veto": "vetoes",
    "mosquito": "mosquitoes", "embargo": "embargoes", "volcano": "volcanoes",
    "die": "dice", "penny": "pennies",
}

# ---------- 不可数名词（跳过复数） ----------
UNCOUNTABLE = {
    "information", "furniture", "equipment", "knowledge", "advice",
    "news", "luggage", "baggage", "bread", "butter", "cheese",
    "milk", "water", "coffee", "tea", "sugar", "salt", "rice", "money",
    "cash", "change", "traffic", "weather", "scenery", "homework",
    "housework", "research", "evidence", "progress", "behavior",
    "happiness", "health", "wealth", "poverty", "honesty", "patience",
    "importance", "silence", "violence", "darkness", "kindness", "business",
    "success", "failure", "confidence", "independence", "intelligence",
    "strength", "length", "warmth", "depth", "growth", "death", "birth",
    "space", "time", "energy", "power", "work", "art", "music", "poetry",
    "nature", "history", "literature", "physics", "mathematics", "economics",
    "politics", "ethics", "logic", "psychology", "sociology", "biology",
    "chemistry", "geography", "philosophy", "medicine", "law", "architecture",
    "freedom", "justice", "truth", "beauty", "youth", "age", "experience",
    "courage", "anger", "fear", "hope", "love", "peace", "war", "noise",
    "smoke", "dust", "dirt", "grass", "hair", "paper", "wood", "glass",
    "gold", "silver", "iron", "steel", "cloth", "clothing",
    "machinery", "software", "personnel", "staff", "offspring",
    "cattle", "poultry", "rubbish", "litter",
    "transportation", "employment", "unemployment", "leisure",
    "recreation", "relaxation", "sleep", "rest", "exercise", "training",
    "education", "nutrition", "oxygen", "hydrogen", "electricity",
    "sunshine", "rainfall", "snow", "ice", "steam", "fog",
    "lightning", "thunder", "gravity", "friction",
    "pollution", "population", "agriculture", "industry", "trade",
    "commerce", "insurance", "taxation", "legislation", "democracy",
    "communism", "socialism", "capitalism", "religion", "christianity",
    "islam", "buddhism", "science", "technology", "engineering",
    "statistics", "data", "media", "criteria", "phenomena",
}

# 加 -es 的后缀（s/sh/ch/x/z）
ES_SUFFIX = ("s", "ss", "sh", "ch", "x", "z")
# 辅音+y → ies
C_Y_PATTERN = re.compile(r"[^aeiou]y$")
# CVC 结尾（双写尾字母加 -ing/-ed）——只对单音节词适用
CVC_PATTERN = re.compile(r"[^aeiou][aeiou][^aeioxwy]$")
# 多音节词中「重音在末音节、确实双写」的白名单（无争议项；
# cancel/travel/program 等英美式可变的一律不收，宁缺毋滥）
STRESS_FINAL_DOUBLE = {
    "admit", "commit", "permit", "submit", "transmit", "omit", "remit",
    "emit", "regret", "equip", "occur", "prefer", "refer", "defer", "infer",
    "confer", "transfer", "propel", "repel", "compel", "expel", "dispel",
    "excel", "allot", "acquit", "unwrap", "refill", "plot",
}
# 以 -o 结尾加 -s 的常见词
O_PLURAL_S = {
    "photo", "piano", "radio", "zoo", "kilo", "solo", "memo", "video",
    "studio", "logo", "scenario", "ratio", "portfolio", "pro", "auto",
    "bamboo", "cameo", "casino", "embryo", "eskimo", "generalissimo",
    "ghetto", "halo", "inferno", "memento", "motif",
    "partisan", "piccolo", "proviso", "silo", "stereo", "taboo",
    "techno", "tempo", "torso", "tuxedo", "typo", "yo-yo",
}

VOWEL_GROUPS = re.compile(r"[aeiou]+")


def is_monosyllabic(word: str) -> bool:
    """简化单音节判定：元音组数 <= 1（去尾哑音 e）。
    stop→1 组 ✓；abandon→2 组 ✗；begin→2 组（靠白名单）；plot→1 组 ✓"""
    w = word[:-1] if word.endswith("e") and len(word) > 2 else word
    return len(VOWEL_GROUPS.findall(w)) <= 1


def should_double(word: str) -> bool:
    """是否双写尾字母：白名单词无条件双写（equip 是 CVVC 结构 CVC 匹配不到，
    但 equipped 是唯一正确形式）；其余仅单音节 CVC 双写"""
    if word in STRESS_FINAL_DOUBLE:
        return True
    if not CVC_PATTERN.search(word):
        return False
    return is_monosyllabic(word)


def plural_of(word: str) -> str | None:
    if word in IRREGULAR_PLURALS:
        return IRREGULAR_PLURALS[word]
    if word in UNCOUNTABLE:
        return None
    if " " in word or "-" in word or len(word) < 2:
        return None
    if word.endswith("o"):
        if word in O_PLURAL_S:
            return word + "s"
        return word + "es"
    if word.endswith("f"):
        return word[:-1] + "ves" if word not in ("roof", "proof", "chief", "belief", "reef", "chef", "cliff", "stuff", "off", "cuff", "whiff", "tariff", "serf", "grief") else word + "s"
    if word.endswith("fe"):
        return word[:-2] + "ves" if word not in ("safe", "cafe", "giraffe") else word + "s"
    if C_Y_PATTERN.search(word):
        return word[:-1] + "ies"
    if word.endswith(ES_SUFFIX):
        return word + "es"
    if word.endswith("is"):
        return word[:-2] + "es"  # 类 analysis 复数（少数已在 IRREGULAR_PLURALS）
    if word.endswith("um"):
        return word[:-2] + "a" if word not in ("album", "museum", "forum") else word + "s"
    if word.endswith("us"):
        return word[:-2] + "i" if word not in ("bus", "campus", "circus", "virus", "bonus", "chorus", "status", "corpus", "genius", "us") else word + "es"
    return word + "s"


def third_of(word: str) -> str:
    if word.endswith(("s", "x", "z", "ch", "sh", "o")):
        return word + "es"
    if C_Y_PATTERN.search(word):
        return word[:-1] + "ies"
    return word + "s"


def past_of(word: str) -> str:
    if word.endswith("e"):
        return word + "d"
    if C_Y_PATTERN.search(word):
        return word[:-1] + "ied"
    if should_double(word):
        return word + word[-1] + "ed"
    return word + "ed"


def participle_of(word: str) -> str:
    if word.endswith("e") and not word.endswith(("ee", "ye", "oe")):
        return word[:-1] + "ing"
    if word.endswith("ie"):
        return word[:-2] + "ying"
    if should_double(word):
        return word + word[-1] + "ing"
    return word + "ing"


def is_noun(poses) -> bool:
    return any(p.startswith("n") for p in poses)


def is_verb(poses) -> bool:
    return any(p.startswith("v") for p in poses)


def main():
    words = {}
    for fn in sorted(os.listdir(WORDS_DIR)):
        if not re.fullmatch(r"core-[a-z]\.json", fn):
            continue
        with open(os.path.join(WORDS_DIR, fn), encoding="utf-8") as f:
            shard = json.load(f)
        for w in shard["words"]:
            words[w["norm"]] = w

    out = {}
    for norm, w in words.items():
        if " " in norm or "-" in norm or len(norm) < 2:
            continue
        poses = set(w.get("pos") or [])
        for m in w.get("meanings") or []:
            if m.get("pos"):
                poses.add(m["pos"])
        entry = {}
        # 注意：内置词库大量词条 pos 为空串（词性只在中文释义里），
        # 因此不规则表命中优先于词性判断——表里有的必然是动词。
        if norm in IRREGULAR_VERBS:
            third, past, pp, ving = IRREGULAR_VERBS[norm]
            entry.update({"third": third, "past": past, "pastParticiple": pp,
                          "presentParticiple": ving, "irregular": True})
        elif is_verb(poses):
            entry.update({"third": third_of(norm), "past": past_of(norm),
                          "pastParticiple": past_of(norm), "presentParticiple": participle_of(norm)})
        if is_noun(poses):
            p = plural_of(norm)
            if p and p != norm:
                entry["plural"] = p
                if norm in IRREGULAR_PLURALS:
                    entry["irregular"] = True
        if entry:
            out[norm] = entry

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    verbs = sum(1 for e in out.values() if e.get("third"))
    nouns = sum(1 for e in out.values() if e.get("plural"))
    print(f"inflections: {len(out)} words (verbs {verbs}, nouns {nouns}) -> {OUT}")


if __name__ == "__main__":
    main()
