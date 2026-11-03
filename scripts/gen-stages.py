"""Writes the stage tables into shared/balance.js: World 1's 60 stages, each pit deeper
than the last, and World 2's, which carry on from them.

Usage: python scripts/gen-stages.py
Then check the pacing with: node scripts/balance-sim.mjs

Stage 0 is the start; every stage after it is a pit and the ledge beyond it.
- `level`: the level whose Water Power fills the pit (balance.js turns it into `need`,
  waterForLevel(level)), so every gate reads "LEVEL 15" and you know when to rebirth.
  The pits' Water still grows about RATIO_START times per stage at first, rising slowly
  from there; each stage's level is the one nearest that Water.
- `wins`: what the ledge's Wins pad pays: WINS times the stage's Water as a power of it
  (WINS_POWER) - so a stage pays for how hard it is, about the pace of bucket prices -
  ramping in over the first stages (RAMP) so the first ones pay a few Wins each and
  every one after pays clearly more than the last.
- `discover`: the one-off prize for reaching the ledge the first time, a share of its Wins.

World 2 opens once you've escaped World 1 and is the game's second half: its stage k is
the pit W2_OFFSET + k of one long sequence of pits, so its first stages are as deep as
World 1's last few (you fill them on your first run there: a burst of new ledges and
prizes) and from there on they're deeper than anything in World 1. The pits' growth
stops rising at RATIO_MAX. World 2's Wins come out of the same formula; balance.js
multiplies them by the world's own `wins` on top.
"""
import math
import pathlib

# Water that fills the first pit is FIRST_FILL * MARGIN.
FIRST_FILL = 8.5
RATIO_START = 1.9
RATIO_STEP = 0.009
MARGIN = 1.3
# Wins of a stage, per unit of its Water as a power of it.
WINS = 12
WINS_POWER = 0.48
# Stage k pays RAMP_START * RAMP_GROWTH^(k-1) of the full scale, until that reaches 1.
RAMP_START = 0.25
RAMP_GROWTH = 1.3
# A first-visit prize is this share of the ledge's Wins.
DISCOVER = 0.15
# World 2's stage k is pit W2_OFFSET + k of the whole sequence; pits grow at most this.
W2_OFFSET = 40
W2_STAGES = 59
RATIO_MAX = 2.45

stages = [
    ('grassy', 'Grassy Meadow', 'grassy'), ('autumn', 'Autumn Forest', 'autumn'), ('desert', 'Desert Canyon', 'desert'),
    ('beach', 'Sunny Beach', 'beach'), ('jungle', 'Jungle Ruins', 'jungle'), ('frozen', 'Frozen Peaks', 'frozen'),
    ('cherry', 'Cherry Blossom', 'cherry'), ('candy', 'Candy Land', 'candy'), ('mushroom', 'Mushroom Valley', 'mushroom'),
    ('volcano', 'Lava Volcano', 'volcano'), ('swamp', 'Lily Swamp', 'swamp'), ('crystal', 'Crystal Caves', 'crystal'),
    ('ocean', 'Coral Reef', 'ocean'), ('neon', 'Neon City', 'neon'), ('sky', 'Cloud Kingdom', 'sky'),
    ('rainbow', 'Rainbow Road', 'rainbow'), ('moon', 'Moon Base', 'moon'), ('aurora', 'Aurora Tundra', 'aurora'),
    ('space', 'Outer Space', 'space'), ('cosmic', 'Cosmic Core', 'cosmic'),
    ('hills', 'Green Hills', 'grassy'), ('maple', 'Maple Woods', 'autumn'), ('dunes', 'Dune Sea', 'desert'),
    ('island', 'Palm Island', 'beach'), ('temple', 'Lost Temple', 'jungle'), ('glacier', 'Glacier Pass', 'frozen'),
    ('sakura', 'Sakura Garden', 'cherry'), ('sweets', 'Sweet Valley', 'candy'), ('fungi', 'Fungi Forest', 'mushroom'),
    ('magma', 'Magma Core', 'volcano'), ('marsh', 'Green Marsh', 'swamp'), ('gems', 'Gem Mines', 'crystal'),
    ('deep', 'Deep Ocean', 'ocean'), ('cyber', 'Cyber City', 'neon'), ('castle', 'Sky Castle', 'sky'),
    ('prism', 'Prism Path', 'rainbow'), ('lunar', 'Lunar Craters', 'moon'), ('lights', 'Northern Lights', 'aurora'),
    ('galaxy', 'Galaxy Rift', 'space'), ('infinity', 'Infinity', 'cosmic'),
    ('sunflower', 'Sunflower Fields', 'grassy'), ('harvest', 'Harvest Valley', 'autumn'), ('oasis', 'Golden Oasis', 'desert'),
    ('lagoon', 'Blue Lagoon', 'beach'), ('canopy', 'Treetop Canopy', 'jungle'), ('yeti', 'Yeti Mountain', 'frozen'),
    ('lantern', 'Lantern Garden', 'cherry'), ('cupcake', 'Cupcake Kingdom', 'candy'), ('glowcap', 'Glowcap Grotto', 'mushroom'),
    ('inferno', 'Inferno Peak', 'volcano'), ('bayou', 'Firefly Bayou', 'swamp'), ('geode', 'Geode Valley', 'crystal'),
    ('atlantis', 'Atlantis', 'ocean'), ('arcade', 'Arcade Avenue', 'neon'), ('islands', 'Sky Islands', 'sky'),
    ('unicorn', 'Unicorn Trail', 'rainbow'), ('mars', 'Red Planet', 'moon'), ('comet', 'Comet Ice', 'aurora'),
    ('nebula', 'Nebula', 'space'), ('beyond', 'The Beyond', 'cosmic'),
]


def r2(n):
    if n < 100:
        return round(n)
    st = 10 ** (math.floor(math.log10(n)) - 1)
    return round(n / st) * st


def num(n):
    if n >= 1e6:
        e = math.floor(math.log10(n))
        return f"{n / 10 ** e:.2g}e{e}"
    return f"{n:g}"


# The level table of balance.js (waterForLevel), in units of its LEVEL_BASE: the
# stages' levels don't depend on that, only on how the levels grow.
GROWTH_EARLY = 1.3
GROWTH_LATE = 1.097
GROWTH_FADE = 100
REF_BASE = 20
table = [0.0, 0.0]
step = 1.0
for lv in range(2, 1201):
    table.append(table[-1] + step)
    step *= GROWTH_LATE + (GROWTH_EARLY - GROWTH_LATE) * math.exp(-lv / GROWTH_FADE)


def level_for(need, above):
    """The level whose Water is nearest `need` (in log terms), above level `above`."""
    best = above + 1
    for lv in range(above + 1, 1200):
        if abs(math.log(table[lv] * REF_BASE / need)) < abs(math.log(table[best] * REF_BASE / need)):
            best = lv
        if table[lv] * REF_BASE > need * 2:
            break
    return best


# One long sequence of pits: World 1's, then on into World 2's.
total = W2_OFFSET + W2_STAGES
rows = [(0, 0, 0)]
fill = FIRST_FILL
prev_level = 1
for i in range(1, total + 1):
    if i > 1:
        fill *= min(RATIO_MAX, RATIO_START + RATIO_STEP * i)
    level = level_for(MARGIN * fill, prev_level)
    prev_level = level
    m = (fill / FIRST_FILL) ** WINS_POWER
    ramp = min(1, RAMP_START * RAMP_GROWTH ** (i - 1))
    wins = r2(WINS * m * ramp)
    rows.append((level, wins, max(1, r2(DISCOVER * wins))))

lines = []
for i, (sid, name, _theme) in enumerate(stages):
    level, wins, disc = rows[i]
    lines.append(f"  {{ id: '{sid}', name: '{name}', level: {level}, wins: {num(wins)}, discover: {num(disc)} }},")
w2 = ['  [0, 0, 0],'] + [f"  [{rows[W2_OFFSET + k][0]}, {num(rows[W2_OFFSET + k][1])}, {num(rows[W2_OFFSET + k][2])}]," for k in range(1, W2_STAGES + 1)]

p = pathlib.Path(__file__).resolve().parent.parent / 'shared' / 'balance.js'
s = p.read_text(encoding='utf-8')
for name, body in (('STAGE_TABLE', lines), ('WORLD2_TABLE', w2)):
    a = s.index(f'const {name} = [')
    b = s.index('\n]', a) + 2
    s = s[:a] + f'const {name} = [\n' + '\n'.join(body) + s[b - 2:]
p.write_text(s, encoding='utf-8')
print(f'World 1: {len(stages) - 1} pits, last level {rows[len(stages) - 1][0]}; World 2: last level {rows[-1][0]}, last Wins {num(rows[-1][1])}')
