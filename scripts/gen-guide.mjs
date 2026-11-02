/**
 * Writes docs/game-guide-si.html, the Sinhala game guide, from the real balance tables
 * (shared/balance.js) and the balance sim's pacing, keeping the page's existing style.
 *
 *   node scripts/gen-guide.mjs
 *
 * Run it again after any change to shared/balance.js.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

import {
  BUCKET_STARS,
  BUCKETS,
  CLICK_RATE,
  CO_OP_HELP,
  CO_OP_MAX,
  CO_OP_TIP,
  COIN_SHARE,
  COLLECTION_BONUS,
  GOLDEN_BOOST,
  GOLDEN_FUSE,
  MEGA_CHESTS,
  MEGA_EVERY,
  MEGA_PRIZE,
  POUR_TAP,
  QUEST_BONUS,
  QUEST_REWARDS,
  QUESTS,
  QUESTS_PER_DAY,
  REBIRTH_BOOST,
  STREAMS,
  TRAILS,
  WEEKLY_REWARDS,
  ITEMS,
  LAST_STAGE,
  levelCap,
  pitLength,
  POUR_AT_MIN,
  RARITIES,
  rebirthMultiplier,
  runSeconds,
  SHOP,
  SKIP_RUNS,
  STAGES,
  STAR_ENDLESS_GROWTH,
  STAR_POWER,
  starPrice,
  waterForLevel,
  WELLS,
  WORLD_PORTALS,
  WORLD_STAGES,
  WORLDS,
} from '../shared/balance.js'
import { formatNumber } from '../shared/format.js'
import { COURSE_HALF_WIDTH } from '../shared/world.js'
import { fillStage } from '../shared/logic.js'
import { clock, simulate } from './sim-core.mjs'

const root = new URL('..', import.meta.url)
const page = new URL('docs/game-guide-si.html', root)
const old = readFileSync(page, 'utf8')
const head = old.slice(0, old.indexOf('</head>') + '</head>'.length).replace(/<title>.*<\/title>/, '<title>+1 Fill Water Escape ගේම් මාර්ගෝපදේශය</title>')

const n = formatNumber
const rows = (list) => list.map((cells) => `<tr>${cells.map((c) => (typeof c === 'number' || /^[\d.,]+[KMBTQaix]*$/.test(c) ? `<td class="n">${c}</td>` : `<td>${c}</td>`)).join('')}</tr>`).join('\n')
const table = (heads, body) => `<div class="tbl"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>\n${body}\n</tbody></table></div>`
const pill = (rarity) => `<span class="pill r-${rarity}">${RARITIES[rarity].name}</span>`

// The balance sim's pacing: when each rebirth arrives for a free player.
const sim = execFileSync(process.execPath, [new URL('scripts/balance-sim.mjs', root).pathname.replace(/^\/(\w:)/, '$1'), '6'], { encoding: 'utf8' })
const rebirthAt = [...sim.matchAll(/^(\d+:\d\d:\d\d)\s+REBIRTH -> R(\d+)/gm)].map((m) => ({ at: m[1], r: Number(m[2]) }))
const timeOf = (r) => rebirthAt.find((x) => x.r === r)?.at ?? '6 පැ.+'

const stageRow = (s, k) => [
  k,
  k % MEGA_EVERY === 0 ? `<b>${s.name} (MEGA)</b>` : s.name,
  `Level ${s.level}`,
  n(s.need),
  n(s.capacity),
  `${Math.round(POUR_AT_MIN(k))}s`,
  n(s.wins),
  n(s.discover),
  n(SKIP_RUNS * s.wins),
]
const stageRows = STAGES.slice(1).map((s, i) => stageRow(s, i + 1))
const world2Rows = WORLD_STAGES[1].slice(1).map((s, i) => stageRow(s, i + 1))
const itemName = ({ item, amount }) => (amount > 1 ? `${amount} ${ITEMS[item].name}s` : ITEMS[item].name)
const chestRows = [1, 2, 3, 4, 5].map((k) => [k * MEGA_EVERY, itemName(MEGA_CHESTS[0][k * MEGA_EVERY]), itemName(MEGA_CHESTS[1][k * MEGA_EVERY])])
const lookRows = (list) => Object.values(list).map((c) => [c.name, c.price ? n(c.price) : 'නොමිලේ'])

// How long the game lasts: the sim's keen player (4 taps a second), 16 hours.
const long = simulate({ hours: 16 })
const escapeAt = (world) => long.stages.find((x) => x.world === world && x.stage === LAST_STAGE)?.t
const hours = (t) => (t ? clock(t) : '16 පැ.+')
// Rebirths through both worlds: where each one's max level reaches (in World 2 past World 1's end).
const rebirthRows = [0, 1, 2, 3, 5, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80].map((r) => {
  const cap = levelCap(r)
  const water = waterForLevel(cap)
  const stage = fillStage(water)
  const two = fillStage(water, 1)
  const where = stage < LAST_STAGE || two === 0 ? `${stage} (${STAGES[stage].name})` : `World 2: ${two} (${WORLD_STAGES[1][two].name})`
  const at = long.rebirths.find((x) => x.r === r)
  return [`R${r}`, cap, n(water), `x${n(rebirthMultiplier(r))}`, where, r === 0 ? 'ආරම්භය' : at ? clock(at.t) : timeOf(r)]
})
// When the sim's player buys each bucket.
const boughtAt = new Map([...sim.matchAll(/^(\d+:\d\d:\d\d)\s+BUCKET (.+?) \(/gm)].map((m) => [m[2], m[1]]))
const bucketRows = BUCKETS.map((b, i) => [
  i + 1,
  b.name,
  pill(b.rarity),
  `+${n(b.power)}`,
  `+${n(b.power * STAR_POWER ** BUCKET_STARS)}`,
  b.cost ? n(b.cost) : 'නොමිලේ',
  `${n(starPrice(i, 1))} – ${n(starPrice(i, BUCKET_STARS))}`,
  i === 0 ? 'ආරම්භය' : boughtAt.get(b.name) ?? '–',
])
const starPercent = Math.round((STAR_POWER - 1) * 1000) / 10
const wellRows = WELLS.map((w) => [w.name, `x${w.mult}`, w.product ? `${w.tag} – ${n(SHOP[w.product].price)} Wins` : w.rebirths ? `Rebirth ${w.rebirths}` : 'නොමිලේ'])

const body = `
<body>
<main>
<header>
  <h1>+1 Fill Water Escape – ගේම් එකේ සම්පූර්ණ විස්තරය</h1>
  <p>ගේම් එක වැඩ කරන හැටි: wells, buckets, stages 60 (වළවල් සහ ledges), Wins pad, Skip pad, rebirth, සහ player කෙනෙක් කොච්චර වෙලාවකින් මොනවා ලබනවද. මේ අංක ඔක්කොම ගත්තේ ගේම් එකේ කෝඩ් එකෙන් (<code>shared/balance.js</code>) සහ ගේම් එක බොට් කෙනෙක් ලවා පැය 6ක් සෙල්ලම් කරවලා (<code>scripts/balance-sim.mjs</code>). මේ පිටුව හදන්නේ <code>node scripts/gen-guide.mjs</code> වලින්.</p>
  <nav style="margin-top:12px">
    <a href="#loop">ගේම් එක</a><a href="#water">Water Power</a><a href="#course">Escape course</a><a href="#pads">Wins &amp; Skip pads</a><a href="#rebirth">Rebirth</a><a href="#stages">Stages 60</a><a href="#buckets">Buckets</a><a href="#wells">Wells</a><a href="#world2">World 2</a><a href="#quests">Quests</a><a href="#extras">Pets &amp; extras</a><a href="#length">කාලය</a><a href="#shop">Shop</a>
  </nav>
</header>

<section id="loop">
  <h2><span class="no">1</span>ගේම් එක වැඩ කරන්නේ කොහොමද</h2>
  <div class="loop">
    <span class="step">Screen එක tap කරලා / well එකෙන් Water ගන්නවා</span><span class="arrow">→</span>
    <span class="step">Escape course එකට යනවා</span><span class="arrow">→</span>
    <span class="step">වළවල් වතුරෙන් පුරවලා පීනලා යනවා</span><span class="arrow">→</span>
    <span class="step">ඈතම ledge එකේ Wins pad එක</span><span class="arrow">→</span>
    <span class="step">අලුත් bucket / ★ stars / pets / passes</span><span class="arrow">→</span>
    <span class="step">Max level → Rebirth</span>
  </div>
  <ul>
    <li><b>Water Power</b> තමයි ප්‍රධාන "බලය". වැඩි වෙන තරමට ගැඹුරු වළවල් පුරවන්න පුළුවන්.</li>
    <li><b>Wins</b> තමයි ගේම් එකේ එකම මුදල. Buckets, bucket stars, eggs, passes, wells, Water packs ඔක්කොම Wins වලින්.</li>
    <li>Lobby එකේ උතුරු පැත්තේ <b>ESCAPE!</b> ආරුක්කුවෙන් course එක පටන් ගන්නවා. Course එක සමතලයි – පඩිපෙළවල් නෑ.</li>
  </ul>
</section>

<section id="water">
  <h2><span class="no">2</span>Water Power සහ Level</h2>
  <ul>
    <li><b>Training = tap කිරීම.</b> Screen එක tap / click කරන හැම පාරකටම bucket එකෙන් වතුර උකහනවා: bucket power × ගුණක. Well එකක් ඇතුළේ ඉඳන් tap කළොත් ඒක <b>well ගුණකයෙනුත්</b> ගුණ වෙනවා (x2, x4, x10 …). තත්පරයකට tap ${CLICK_RATE}ක් දක්වා ගණන් වෙනවා (auto-clicker එකකින් වාසියක් නෑ).</li>
    <li>Well එකේ නිකන් හිටියත් හැම තත්පර 0.6කටම තනියම එක scoop එකක් ලැබෙනවා (tap කරනවට වඩා හෙමින්).</li>
    <li><b>ඇවිදින එකෙන් Water ලැබෙන්නේ නෑ</b> – Water Power වැඩි වෙන්නේ tap කරනකොට (සහ well එකේ ඉන්නකොට) විතරයි.</li>
    <li>ගුණක: rebirth (R0 = x1, R1 = x2 …), pets (සවි කරපු 3 එකතු වෙනවා), x2 Water pass, x2 Water potion.</li>
    <li>Level එක Water වලින්. Max level = 15 + 8 × rebirths. Max level ආවම Water එකතු වීම නවතිනවා – rebirth කරන්න ඕනෙ.</li>
    <li><b>හැම stage එකකටම Level එකක් ඕනෙ</b> (gate එකේ "STAGE 9 · LEVEL 15" වගේ ලියලා තියෙනවා). Rebirth නොකර Level 15 දක්වා යන්න පුළුවන් – ඒ කියන්නේ stage 9 වෙනකම්. ඊට එහාට යන්න rebirth කරන්නම ඕනෙ. HUD එකේ ඊළඟ වළට ඕනෙ Level එක සහ "train කරන්න" ද "rebirth කරන්න" ද කියලා පෙන්නනවා.</li>
    <li>Level bar එකට යටින් Water packs 3ක්: Water ප්‍රමාණයක් Wins වලට. ඒවායින් යන්න පුළුවන් max level එක දක්වා විතරයි – ඊට එහාට rebirth කරන්නම ඕනෙ.</li>
  </ul>
</section>

<section id="course">
  <h2><span class="no">3</span>Escape course – වළවල් පුරවලා පීනන හැටි</h2>
  <ul>
    <li>Course එකේ stages 59ක්, පළල මීටර් ${COURSE_HALF_WIDTH * 2}යි. හැම stage එකක්ම: <b>වළක්</b> → <b>ledge</b> එකක් (pads දෙකක් එක්ක) → ඊළඟ වළ. ඔක්කොම එකම මට්ටමේ. ඉස්සරහට යන්න යන්න වළවල් දිගයි (මීටර් ${pitLength(1)} → ${pitLength(LAST_STAGE)}), ඒවට වතුර ගොඩක් වැඩියෙන් අල්ලනවා.</li>
    <li><b>වතුර පුරවන්න කාලය යනවා.</b> වළක දාරයේ හිටගත්තාම character එක bucket එක පෙරළලා වතුර වක්කරනවා: <b>තත්පරයකට ඔයාගේ Water Power ප්‍රමාණයක්</b>. ඒ නිසා බලය වැඩි වෙන තරමට ඉක්මනට පිරෙනවා, අඩු නම් වැඩි වෙලාවක් යනවා. HUD එකේ % සහ ඉතුරු තත්පර පෙන්නනවා.</li>
    <li>හැම වළකටම <b>අවම Level එකක්</b> තියෙනවා ("STAGE 9 · LEVEL 15"). ඊට අඩු නම් "Too weak!" – පුරවන්නම බෑ. අවම බලයෙන් වළක් පුරවන්න තත්පර ${POUR_AT_MIN(1)} (stage 1) ඉඳන් ${POUR_AT_MIN(LAST_STAGE)} (පස්සේ stages) දක්වා යනවා; බලය දෙගුණ නම් කාලය බාගයයි.</li>
    <li>දාරයෙන් ඈත් වුණොත් පිරවීම නවතිනවා, ආපහු ආවම දිගටම යනවා. වළ පිරුණාම විතරයි පීනලා යන්න පුළුවන්.</li>
    <li><b>Tap කරලා වේගයෙන් වක්කරන්න:</b> වක්කරද්දී screen එක tap කරන හැම පාරකටම තත්පර ${POUR_TAP}ක වතුර එකපාරටම යනවා (තත්පරයකට tap ${CLICK_RATE}ක් දක්වා) – ඉක්මන් ඇඟිල්ලකට 2–3 ගුණයක් වේගයෙන් පුරවන්න පුළුවන්.</li>
    <li><b>එකට වක්කිරීම:</b> ඔයා පුරවන වළේම දාරයේ වෙන players ඉන්නවා නම් එක්කෙනෙකුට +${Math.round(CO_OP_HELP * 100)}% වේගය (උපරිම ${CO_OP_MAX} දෙනෙක්). වළ පිරුණාම උදව් කරපු හැමෝටම ඒ වළේ Wins pad එකෙන් ${Math.round(CO_OP_TIP * 100)}%ක් tip එකක්.</li>
    <li><b>Coins:</b> හැම ledge එකකම රන් coins 3ක් පාවෙනවා – ඇවිදලා ගියාම ඒ ledge එකේ Wins pad එකෙන් ${Math.round(COIN_SHARE * 100)}%ක් එකකට. හැම run එකකම ආපහු එනවා.</li>
    <li><b>Mega Pits:</b> හැම stage ${MEGA_EVERY}කටම (10, 20, 30, 40, 50) රන් gate එකක් තියෙන ලොකු වළක් – දිගයි, වැඩිපුර වතුර අල්ලනවා. පළවෙනි පාරට ඒකේ ledge එකට ගියාම first-visit prize එක x${MEGA_PRIZE}යි, ඒ වගේම <b>Mega Chest</b> එකෙන් eggs ලැබෙනවා.</li>
    <li>Water වියදම් වෙන්නේ නෑ – ඒක ඔයාගේ බලය විතරයි. හැම run එකක්ම (lobby එකට ආවම) වළවල් හිස් වෙලා අලුතින් පුරවන්න වෙනවා.</li>
    <li>පිරුණු වළක character එක වතුරේ දිගෑදිලා front-crawl පීනනවා.</li>
  </ul>
</section>

<section id="pads">
  <h2><span class="no">4</span>Wins pad සහ Skip pad</h2>
  <ul>
    <li><b>Wins pad</b> (කහ, ledge එකේ වම් පැත්තේ): පාගපු ගමන් ඒ stage එකේ Wins ලැබෙනවා (stage 1 = 3, stage 2 = 5, stage 3 = 10, ඊට පස්සේ ක්‍රමයෙන් වැඩි වෙනවා) (x2 Wins pass/potion එක්ක දෙගුණ), run එක ඉවරයි – lobby එකට යනවා. ඒ නිසා පුළුවන් තරම් ඈතට ගිහින් ඈතම Wins pad එක ගන්න. පළවෙනි පාරට ledge එකකට ගියාම <b>first-visit prize</b> එකකුත් ලැබෙනවා.</li>
    <li><b>Skip pad</b> (රෝස, දකුණු පැත්තේ): Wins දීලා <b>ඊළඟ වළ</b> ඔයා වෙනුවෙන් එක පාරටම පුරවනවා (රන් පාට වතුර). ඒ වළ සහ ඊට කලින් ඒවා ඔයාගේ ඊළඟ rebirth එක වෙනකම් (හෝ world මාරු කරනකම්) හැම run එකකම එක පාරටම පිරෙනවා – බලය මදි වුණත්, නැත්නම් බලන් ඉන්න කම්මැලි නම්.</li>
    <li>Skip මිල = ඒ stage එකේ Wins pad එක × ${SKIP_RUNS}. ඒ කියන්නේ run ${SKIP_RUNS}ක Wins – Wins හොයන shortcut එකක් නෙවෙයි, ඊළඟ stage එකට කලින් යන්න උදව්වක්.</li>
    <li><b>Auto Win</b> pass එක තියෙනවා නම්, start line එකේ හිටගෙන ඉන්නකොට ඔයාට යන්න පුළුවන් ඈතම ledge එකේ Wins ටික run එකකට යන කාලයට (තත්පර ${runSeconds(1)} + stage එකකට ${runSeconds(2) - runSeconds(1)}) වරක් ලැබෙනවා.</li>
  </ul>
</section>

<section id="rebirth">
  <h2><span class="no">5</span>Rebirth</h2>
  <ul>
    <li>Max level ආවම Rebirth: rebirths +1, Water 0, Level 1, skip කරපු වළවල් reset. Wins, buckets, pets, passes තියෙනවා.</li>
    <li>Rebirth ගුණකය x2, x3, x4 … සහ max level එක +8 බැගින්. <b>Rebirth ${REBIRTH_BOOST.from} ඉඳන් හැම rebirth එකකටම ගුණකය තවත් x${REBIRTH_BOOST.mult}</b> – අගට buckets ඉවර වුණාමත් rebirth එකක් ගන්න කාලය දිගු වෙන්නේ නෑ (කලින් තිබ්බ "තාප්පය" නැති කළා). අලුත් wells unlock වෙන්නෙත් rebirths වලින්.</li>
    <li>Max level එකට කලින් Wins දීලා rebirth කරන්නත් පුළුවන් (max level run 10ක Wins). Auto Rebirth tick කළොත් තනියම rebirth වෙනවා.</li>
    <li>Rebirth 15 ඉඳන් හැම 5කටම Volcano Eggs තෑග්ගක්.</li>
    <li>Course එකේ ඉන්නකොට rebirth කළොත් lobby එකට යනවා (ඔයාගේ Water බිංදුව නිසා).</li>
  </ul>
  ${table(['Rebirth', 'Max level', 'Max level Water', 'ගුණකය', 'පුරවන්න පුළුවන් ඈතම stage', 'බොට් ගත්ත කාලය'], rows(rebirthRows))}
  <p class="note">බොට් කාලය = potions, daily rewards, packs, skips නැතුව නොමිලේ player කෙනෙක්.</p>
</section>

<section id="stages">
  <h2><span class="no">6</span>Stages – ඕනෙ Water, Wins සහ Skip මිල</h2>
  <p>හැම වළකටම පෙර එකට වඩා ~2 ගුණයක Water ඕනෙ. (MEGA) = Mega Pit.</p>
  <h3>World 1</h3>
  ${table(['#', 'Stage', 'අවම Level', 'අවම Water Power', 'වළේ වතුර', 'අවම බලයෙන් කාලය', 'Wins pad', 'First-visit prize', 'Skip මිල'], rows(stageRows))}
  <h3>World 2 – World 1 ඉවර කළාට පස්සේ</h3>
  ${table(['#', 'Stage', 'අවම Level', 'අවම Water Power', 'වළේ වතුර', 'අවම බලයෙන් කාලය', 'Wins pad', 'First-visit prize', 'Skip මිල'], rows(world2Rows))}
  <h3>Mega Chests</h3>
  ${table(['Stage', 'World 1', 'World 2'], rows(chestRows))}
</section>

<section id="buckets">
  <h2><span class="no">7</span>Buckets 24</h2>
  <p>Lobby එකේ නැගෙනහිර පැත්තේ BUCKETS shop එකේ stand එකකට ගිහින් Wins වලින් ගන්නවා. <b>ඕනම bucket එකක් ඕනම පිළිවෙළකට</b> ගන්න පුළුවන් – කලින් එක ගත්තත් නැතත්. අලුත් එක ඔයා අතේ තියෙන එකට වඩා බලවත් නම් විතරක් ඒක අතට ගන්නවා. හැම bucket එකක්ම වෙනස් ද්‍රව්‍යයකින් – ලී, ටින්, තඹ, candy, අයිස්, ලාවා, රත්තරන්, මැණික්, rainbow, galaxy …</p>
  <ul>
    <li><b>★ Stars:</b> තමන්ගේ bucket එකක stand එකට ගිහින් stars ${BUCKET_STARS}ක් දක්වා upgrade කරන්න පුළුවන්. හැම star එකකටම scoop එක +${starPercent}% (★${BUCKET_STARS} = x${(STAR_POWER ** BUCKET_STARS).toFixed(2)}). Star එකක මිල ඊළඟ bucket එකේ මිලෙන් 8%–15%ක් – ඒ නිසා ඊළඟ bucket එකට එකතු කරනකම් හැම විනාඩි කීපයකටම මොනවා හරි ගන්න දෙයක් තියෙනවා.</li>
    <li><b>අන්තිම bucket එක (${BUCKETS[BUCKETS.length - 1].name})</b> ට stars වලට සීමාවක් නෑ: ★${BUCKET_STARS} න් පස්සෙත් හැම star එකක්ම කලින් එකට වඩා x${STAR_ENDLESS_GROWTH} මිල. ඒ නිසා දිගටම සෙල්ලම් කරන අයටත් ඉලක්කයක් තියෙනවා.</li>
    <li>"Bot ගත්තේ" = බොට් player (තත්පරයකට tap 4ක්, auto win/potions/packs නැතුව) ඒ bucket එක ගත්ත වෙලාව. පළමු පැය තුළ විනාඩි 3–4කට සැරයක් අලුත් දෙයක්; පැය 3–6 දී උපරිම විනාඩි 15–20ක්.</li>
  </ul>
  ${table(['#', 'නම', 'Rarity', 'Power (scoop එකකට)', '★' + BUCKET_STARS + ' Power', 'මිල (Wins)', 'Star මිල (★1 – ★' + BUCKET_STARS + ')', 'Bot ගත්තේ'], rows(bucketRows))}
</section>

<section id="wells">
  <h2><span class="no">8</span>Training wells 7</h2>
  <p>Lobby එකේ බටහිර පැත්තේ, ගල් බැම්මක් සහ කොළ පාට වහලක් තියෙන ළිං. ළිඳ ළඟට ගියාම character එක ඒ දිහාට හැරිලා bucket එකෙන් වතුර උකහනවා. ලොක් වෙලා තියෙන ඒවාට ඇතුල් වෙන්න බෑ.</p>
  ${table(['Well', 'ගුණකය', 'Unlock'], rows(wellRows))}
</section>

<section id="world2">
  <h2><span class="no">9</span>World 2</h2>
  <p><b>World 1 escape කළාම</b> (stage ${WORLD_PORTALS.world2.stage}) portal එක විවෘත වෙනවා. World 2 කියන්නේ ගේම් එකේ දෙවෙනි භාගය: එහි මුල් stages World 1 අන්තිම stages තරම් ගැඹුරුයි (ඒ නිසා පළවෙනි run එකේම stages ගොඩක් එකපාරට – first-visit prizes ගොඩක්), ඊට පස්සේ World 1 ට වඩා ගොඩක් ගැඹුරුයි (Level ${WORLD_STAGES[1][LAST_STAGE].level} දක්වා). හැම Wins pad එකක්ම x${WORLDS[1].wins}. ආපහු එන එක නොමිලේ.</p>
</section>

<section id="quests">
  <h2><span class="no">10</span>Daily quests</h2>
  <p>හැමදාම (UTC 00:00) අලුත් quests ${QUESTS_PER_DAY}ක් – හැමෝටම එකමයි. Left menu එකේ <b>Quests</b> tile එකෙන් බලන්න. Quest එකක් ඉවර වුණු ගමන් reward එක Items වලට; තුනම ඉවර කළොත් bonus ${itemName(QUEST_BONUS)}.</p>
  ${table(['Quest', 'ඉලක්කය'], rows(QUESTS.map((q) => [q.text.replace('{n}', n(q.target)), n(q.target)])))}
  <p>Rewards පිළිවෙළට: ${QUEST_REWARDS.map(itemName).join(', ')}.</p>
</section>

<section id="extras">
  <h2><span class="no">11</span>Pets, collection, cosmetics, weekly board</h2>
  <ul>
    <li><b>Golden pets:</b> එකම pet ${GOLDEN_FUSE}ක් Pets panel එකේ "Make Golden" එකෙන් එකට එකතු කරලා Golden pet එකක් – bonus එක x${GOLDEN_BOOST}.</li>
    <li><b>Bucket collection:</b> Tiny Pail එකට අමතරව ගත්ත හැම bucket එකකටම Water +${Math.round(COLLECTION_BONUS * 100)}% (24ම = +${Math.round(COLLECTION_BONUS * (BUCKETS.length - 1) * 100)}%). BUCKETS board එකට උඩින් පෙන්නනවා.</li>
    <li><b>Cosmetics</b> (Store): වක්කරන වතුරේ පාට සහ ඔයා පිටිපස්සෙන් එන trail එකක් – බලය නෑ, ලස්සනට විතරයි. Trails පේන්නේ Medium/High graphics වල.</li>
    <li><b>Weekly board</b> (Leaderboards): සඳුදා UTC 00:00 ඉඳන් Wins pads සහ coins වලින් හොයපු Wins. සතිය ඉවර වෙද්දී top 10ට ${WEEKLY_REWARDS.map((r, i) => `${i ? `#${WEEKLY_REWARDS[i - 1].upTo + 1}-${r.upTo}` : '#1'}: ${r.amount}`).join(', ')} Volcano Eggs (ඊළඟ පාර ගේම් එකට ආවම).</li>
    <li>අනිත් players ගේ නමට යටින් ඔවුන්ගේ rebirths සහ හොඳම stage එක පේනවා.</li>
  </ul>
  ${table(['Pour colour', 'මිල (Wins)'], rows(lookRows(STREAMS)))}
  ${table(['Trail', 'මිල (Wins)'], rows(lookRows(TRAILS)))}
</section>

<section id="length">
  <h2><span class="no">12</span>ගේම් එක කොච්චර කල් යයිද</h2>
  <p>බොට් player (තත්පරයකට tap 4ක්, potions/packs/skips නැතුව): World 1 escape <b>${hours(escapeAt(0))}</b>, World 2 escape <b>${hours(escapeAt(1))}</b>. ඇත්ත player කෙනෙක් 1.5–2 ගුණයක් විතර හෙමින් යයි. ඊට පස්සෙත් Infinity Bucket stars, rebirths, weekly board, cosmetics දිගටම තියෙනවා.</p>
</section>

<section id="shop">
  <h2><span class="no">13</span>Shop සහ passes</h2>
  ${table(['Item', 'මිල (Wins)'], rows(Object.entries(SHOP).map(([, item]) => [item.name, n(item.price)])))}
  <p>Bloxity Gems products (x2 Water, x2 Wins, Auto Win, Galaxy Well, Wins packs, potions, eggs) Gems වලින් – මිල Bloxity catalog එකේ.</p>
</section>
</main>
</body>
</html>
`
writeFileSync(page, `${head}\n${body.trim()}\n`, 'utf8')
console.log(`wrote ${page.pathname}: ${STAGES.length - 1} stages, ${BUCKETS.length} buckets, rebirths sampled at ${rebirthAt.length} points`)
