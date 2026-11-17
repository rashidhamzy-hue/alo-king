#!/usr/bin/env python3
"""Subsets IBM Plex Sans and IBM Plex Sans Arabic (SIL Open Font License 1.1) to what Alo King's pages write, as WOFF2.

  pip install fonttools brotli
  npm ci   (the source files come from the pinned @fontsource packages in node_modules)
  python3 packages/ui/scripts/subset-fonts.py

Latin:  Basic Latin, the French and Latin-1 letters, the punctuation and arrows the pages use.
Arabic: the letters, marks and digits of Arabic as written in Lebanon (not the Persian, Urdu or Sindhi extensions), with the
        joining forms the shaper needs (kept by the subsetter through the font's own substitution tables).
Figures (WEB2): what an Arabic page writes in Latin script and must not cost the whole Latin font: digits, prices, punctuation, codes
        in capitals (AK-1042, ALO-7K3Q9P), the multiplication sign and dashes. An Arabic page's lower-case Latin (a brand name) uses
        the phone's own font. About 2 KB a weight instead of 12.
Two weights, 400 and 600. The output is committed (packages/ui/fonts); re-run only when the character list or the weights change.
"""
import os, sys
from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(HERE, "..", "fonts")
SRC = os.path.join(ROOT, "node_modules", "@fontsource")

LATIN = ("U+0020-007E,U+00A0,U+00A3,U+00A7,U+00A9,U+00AB,U+00AE,U+00B0,U+00B1,U+00B7,U+00BB,U+00BF,U+00C0-00FF,U+0152,U+0153,U+0178,"
         "U+2013,U+2014,U+2018,U+2019,U+201C,U+201D,U+2022,U+2026,U+2039,U+203A,U+20AC,U+2190-2193,U+2212,U+00D7")
ARABIC = ("U+0020,U+00A0,U+00AB,U+00BB,U+060C,U+061B,U+061F,U+0621-063A,U+0640-0652,U+0660-0669,U+066A-066C,U+0670,U+200C-200F,"
          "U+2013,U+2014,U+2026,U+25CC")

FIGURES = "U+0020-0040,U+0041-005A,U+005B-005F,U+00A0,U+00B7,U+00D7,U+2013,U+2014,U+2022,U+2026,U+2212"

JOBS = [
    ("ibm-plex-sans/files/ibm-plex-sans-latin-{w}-normal.woff2", "plex-figures-{w}.woff2", FIGURES, ["tnum"]),
    ("ibm-plex-sans/files/ibm-plex-sans-latin-{w}-normal.woff2", "plex-latin-{w}.woff2", LATIN, ["kern", "liga", "tnum", "pnum", "locl", "ccmp", "mark", "mkmk"]),
    ("ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-{w}-normal.woff2", "plex-arabic-{w}.woff2", ARABIC, ["*"]),
]
for src, out, unicodes, features in JOBS:
    for w in (400, 600):
        opts = subset.Options()
        opts.flavor = "woff2"; opts.layout_features = features; opts.name_IDs = [1, 2, 4, 6, 13, 14]; opts.notdef_outline = True
        opts.hinting = False; opts.desubroutinize = True; opts.drop_tables += ["DSIG", "FFTM"]
        font = TTFont(os.path.join(SRC, src.format(w=w)))
        s = subset.Subsetter(opts); s.populate(unicodes=subset.parse_unicodes(unicodes)); s.subset(font)
        dest = os.path.join(OUT, out.format(w=w)); font.flavor = "woff2"; font.save(dest)
        print(f"{out.format(w=w)}: {os.path.getsize(dest)} bytes, {len(font.getGlyphOrder())} glyphs")
