#!/usr/bin/env python3
"""Build fonts/bhs.woff2: Black Han Sans cut down to the characters the app actually shows.

usage: python3 tools/make_font.py            (run from anywhere; re-run whenever UI text changes)

The full Black Han Sans is about 1 MB of TrueType for 2,700 characters. The app uses a few
hundred, so the subset is what ships and what the service worker caches (docs/research/ux.md
"글꼴"). The character set is:
  - every character found in the shipped files: index.html, js/**/*.js, css/**/*.css
    (the same files the service worker precaches; tools/, tests/ and docs/ are not shipped)
  - all of printable ASCII, so numbers, names and English stage words never fall back
  - a few typographic extras that copy tends to grow (quotes, ×, ★, ●, ○, ·, …)
Only characters the source font really has can be kept. The rest (★ ● ○ · …, Hanja) are
listed at the end and render in the system font, which is the font-display:swap fallback
anyway. tests/integration.test.js fails if a Hangul syllable in a shipped file is missing from
the subset, so a forgotten re-run is caught.

Also writes fonts/OFL.txt (SIL Open Font License 1.1, required next to the font).
Needs fonttools and brotli (pip install fonttools brotli).
"""
import re
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tools" / "src-fonts" / "BlackHanSans-Regular.ttf"
SRC_LICENSE = ROOT / "tools" / "src-fonts" / "OFL-BlackHanSans.txt"
OUT = ROOT / "fonts" / "bhs.woff2"
OUT_LICENSE = ROOT / "fonts" / "OFL.txt"

EXTRAS = "★☆●○◆◇■□▲△▼▽♥♡·…‘’“”«»×÷₩–—→←↑↓!?~♪％"
HANGUL = re.compile(r"[가-힣ㄱ-ㆎ]")


def shipped_files():
    files = [ROOT / "index.html"]
    for folder, pattern in (("js", "*.js"), ("css", "*.css")):
        files += sorted((ROOT / folder).rglob(pattern))
    return [f for f in files if f.is_file()]


def wanted_chars():
    chars = set(chr(c) for c in range(0x20, 0x7F))
    chars |= set(EXTRAS)
    for f in shipped_files():
        text = f.read_text(encoding="utf-8")
        chars |= {ch for ch in text if ord(ch) >= 0x20}
    return chars


def main():
    if not SRC.exists():
        sys.exit(f"missing source font: {SRC}")
    font = TTFont(SRC)
    cmap = font.getBestCmap()
    wanted = wanted_chars()
    keep = sorted(c for c in wanted if ord(c) in cmap)
    missing = sorted(c for c in wanted if ord(c) not in cmap and ord(c) > 0x7E)
    missing_hangul = [c for c in missing if HANGUL.match(c)]

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = ["*"]
    options.name_IDs = ["*"]          # keep copyright, license and URL records (OFL)
    options.name_languages = ["*"]
    options.hinting = False           # iOS ignores TrueType hinting; it is a third of the bytes
    options.desubroutinize = True
    options.notdef_outline = True
    options.recalc_bounds = True

    sub = subset.Subsetter(options=options)
    sub.populate(unicodes=[ord(c) for c in keep])
    sub.subset(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(OUT), options)
    shutil.copyfile(SRC_LICENSE, OUT_LICENSE)

    hangul = sum(1 for c in keep if HANGUL.match(c))
    print(f"wrote {OUT.relative_to(ROOT)}: {OUT.stat().st_size / 1024:.1f} KB, "
          f"{len(keep)} characters ({hangul} Hangul)")
    print(f"wrote {OUT_LICENSE.relative_to(ROOT)}")
    if missing:
        print("not in Black Han Sans (shown in the system font): " + "".join(missing))
    if missing_hangul:
        print("WARNING: Hangul the font cannot show: " + "".join(missing_hangul), file=sys.stderr)


if __name__ == "__main__":
    main()
