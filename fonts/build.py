# How the files in this folder were made.
#
# Static Unbounded 700/800/900 with overlapping contours merged, saved as
# woff2 in two files per weight:
#   unbounded-<w>.woff2      Latin, Turkish, punctuation (what every page uses)
#   unbounded-<w>-ext.woff2  everything else Google Fonts served (other Latin,
#                            Vietnamese, Cyrillic) - only fetched when a page
#                            actually shows such a letter, e.g. in a name
# Together they cover exactly the characters Google Fonts served for
# Unbounded, so no character changes font. theme.css says why the site
# serves its own files, and holds the matching unicode-range lists (this
# script prints them).
#
# To run it again (the site itself never does):
#   pip install fonttools skia-pathops brotli
#   python fonts/build.py mobile/node_modules/@expo-google-fonts/unbounded <output folder>
# The source is Google's own static Unbounded 1.701, which the mobile app
# already installs. A rebuilt font needs a new file name - the old ones
# are cached by browsers for a year (vercel.json).
import sys, os
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools import subset

SRC = sys.argv[1]
OUT = sys.argv[2]
os.makedirs(OUT, exist_ok=True)

def cps(spec):
    out = set()
    for part in spec.replace("U+", "").split(","):
        a, _, b = part.strip().partition("-")
        out |= set(range(int(a, 16), int(b or a, 16) + 1))
    return out

G_LATIN = cps("U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD")
G_LATIN_EXT = cps("U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF")
G_VIET = cps("U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB")
G_CYR = cps("U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116")
G_CYR_EXT = cps("U+0460-052F,U+1C80-1C8A,U+20B4,U+2DE0-2DFF,U+A640-A69F,U+FE2E-FE2F")
GOOGLE = G_LATIN | G_LATIN_EXT | G_VIET | G_CYR | G_CYR_EXT
MARKS = cps("U+0300-036F") & GOOGLE

# the everyday file: Google's "latin" set, Latin Extended-A (Turkish and
# the rest of Europe), Romanian comma letters, the lira sign, and the
# accents that can follow any of them
MAIN = G_LATIN | cps("U+0100-017F,U+0218-021B,U+20BA") | MARKS
EXT = (GOOGLE - MAIN) | MARKS

def ranges(codepoints):
    out, run = [], None
    for cp in sorted(codepoints):
        if run and cp == run[1] + 1: run[1] = cp
        else:
            run = [cp, cp]; out.append(run)
    return ", ".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in out)

def build(src, unicodes, path):
    font = TTFont(src)
    have = set(font.getBestCmap())
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.hinting = True     # keeps the font's one line of setup ("smooth at every size"); glyphs carry no instructions
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(unicodes & have))
    sub.subset(font)
    removeOverlaps(font)
    glyf = font["glyf"]
    for n in font.getGlyphOrder():      # nothing overlaps now, so the "overlaps" flags go too
        g = glyf[n]
        if g.numberOfContours > 0: g.flags[0] &= ~0x40
        elif g.isComposite():
            for c in g.components: c.flags &= ~0x0400
    font.flavor = "woff2"
    font.save(path)
    return unicodes & have

report = {}
for weight, folder, name in [(700, "700Bold", "Unbounded_700Bold"), (800, "800ExtraBold", "Unbounded_800ExtraBold"), (900, "900Black", "Unbounded_900Black")]:
    src = f"{SRC}/{folder}/{name}.ttf"
    m = build(src, MAIN, f"{OUT}/unbounded-{weight}.woff2")
    e = build(src, EXT, f"{OUT}/unbounded-{weight}-ext.woff2")
    report[weight] = {"main": sorted(m), "ext": sorted(e)}
    print(weight, "main:", os.path.getsize(f"{OUT}/unbounded-{weight}.woff2"), "bytes,", len(m), "chars | ext:", os.path.getsize(f"{OUT}/unbounded-{weight}-ext.woff2"), "bytes,", len(e), "chars")

same = all(report[w] == report[700] for w in report)
print("same characters in all three weights:", same)
# the ext file is only worth fetching for characters it really has
print("MAIN range:", ranges(MAIN))
print("EXT range: ", ranges(set(report[800]["ext"])))
