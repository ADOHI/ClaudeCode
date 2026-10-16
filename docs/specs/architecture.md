<!-- Verbatim source spec (track "architecture"), saved by the tech lead so work-package agents can resolve "A§" references.
     Where a work package's instructions or the combined plan differ from this text, the work package / combined plan wins. -->

# LUMINA: final implementation spec, track "architecture"

User feedback being answered: "건물이 너무 스타일이 비슷해서 재미가 없어. 판타지 세계관이니까 매우 독창적인 건물들이 여럿 나올 수 있으면 좋겠어."

Secondary goal (feedback #1): "청크별 유기성이 없다". Inside this track, buildings should make relations between chunks readable. Road and district changes belong to the other track and are orthogonal to this one.

---

## 0. Synthesis decision

**Backbone.** Proposal 2 (P2) supplies the engine: a road-geodesic style field, a component grammar and per-tier entity budgets. J2 picked it outright, and J1 and J3 both graft it as the generative core.

**Grafted from P1** (the fantasy content):
- silhouette-first crown families, one per vocabulary;
- the flatMin crown quota;
- the slot-borrowing ladder;
- campus `crownLock`;
- block roof colour and row palette alternation;
- most of the signature catalogue;
- friendly-border gateways with split left/right piers;
- the alley canopy.

**Grafted from P3** (the readability guards):
- the 4-level hierarchy (Landmark / Signature / Accent / Common);
- block genes with a single mutation;
- hard and soft edges with a block-shared threshold `u_B`;
- contextual dialects;
- the frame rule, in its height-only, softened form;
- vista-yield and the height cap;
- coverage fill;
- the ground-floor use band;
- the glow lint;
- `params.arch=0` legacy parity, `params.wow`, and colour modes;
- the mansard geometry.

**Cut or deferred.** These are not in this spec:
- P1 mana-floating crowns on ordinary buildings, crystal clusters on every roof, and per-lot `echo` motifs. The road-geodesic field does the same job coherently.
- The inhabited bridge, and waterfront over-water decks.
- `gear` and `star` geometries.
- Twist, split, court and U footprints on ordinary buildings. They are allowed only inside signatures.
- Cantilevers past the lot line.
- 72-ray vista scoring for signatures. A 5-ray frontal march is used instead.
- The saturation cap of 0.30.
- The planRail/genRail split.
- 12-pattern facades. 8 patterns are kept.
- Banning signs inside the frame. Only rooftop billboards are banned there.
- Duplicate border systems. There is one gateway pass for friendly edges, and rival edges get the existing checkpoints plus merlons and a banner.
- The 30- and 22-entry catalogues. The catalogue here is 16 recipes: 13 city and 3 campus.

**Ley lines.** These are kept only as an optional phase P6, behind `params.ley`. They are rebuilt so they follow the approach-avenue geodesic paths rather than cutting across blocks. This removes J1's objection, because the lines now respect street structure.

All new randomness uses `lot.rng.fork('arch')`, `ctx.rng.fork('arch:b'+blockId)` and `ctx.rng.fork('arch-sig')`. `RNG.fork` hashes key+label and does not consume parent state (verified in `src/core/rng.js`). Because of this, zoning picks and every other stage's streams are unchanged.

---

## 1. Measured baseline (seed `lumina`, current code)

| item | value |
|---|---|
| total gen (Node) | ~3.0 s (kivotos 4.3 s, academy-7 3.9 s on this box) |
| `buildings` stage | 42 ms |
| `flow0` stage | 120–165 ms |
| entities | 12 722 |
| building + roof + facade entities | 736 + 1 437 + 2 064 = 4 237 |
| draw buckets | 47 |
| AC units | 1 044. A cap of 2 per building removes 317 |
| buildings | 675 |
| entities per building (ref) | 6.3 |
| (footprint \| crown \| window) entropy | **0.95 bits**: 519 rect\|flat\|grid, 123 rect\|gable\|grid, 33 multi\|flat\|grid |
| rooftop | 6 routes / 27 roofs, 5 of 6 in commercial. 428 rooftop-eligible main roofs |
| landmark visibility | landmarkVisible 0.99, spireVisible 0.89 |
| landmark-only reach | 0.878 of main-flow samples see a landmark (top 0.7h) within 180 m. **Signature reach must therefore be measured separately (§12).** |
| lots | 857. frontRank 5: 330, 3: 313, 0: 169. 401 corner, 175 interior |
| front-axis ≥ 90 m (5 rays ±12°) | 27 lots (≥110 m: 13). Computed in 8 ms |
| node-adjacent corner lots (≤ 30 m, two faces rank ≥ 3) | 168 |
| block-face rows (`block\|nominalFront`) | 346, mean 1.97 lots. **Block, not row, is the main coherence unit.** |
| 4 faction Dijkstras on the 256² road raster | 28 ms total |
| districts | commercial#5 (-92,-145) r=171 is labelled "북부"; commercial#7 (189,251) r=314 is "남부". residential#8 (-230,-290) and #11 (-14,-357) are adjacent |

---

## 2. Files

| file | status | contents |
|---|---|---|
| `src/core/archstyles.js` | new, data only | `STYLES`, `CROWNS`, `WIN`, `HYBRID_OK`, `IDENTITY_RANK`, `PIER`, `TIER_MAX`, `LINT_PIN_HUES`, `FACTION_EMIT`, `SIG_NAMES` |
| `src/core/style.js` | new | `prepareArchitecture(ctx)` and its sub-steps (§4–§7) |
| `src/core/archgrammar.js` | new | `buildArchitecture(ctx,b,spec,P,rng)` with footprints, tiers, ops, crowns, attachments, accents and decay (§8) |
| `src/core/signatures.js` | new | `SIGNATURES` catalogue, `chooseSignatureSites`, `buildSignature`, `buildCampusSignature`, `genPlazaIsles` (§9) |
| `src/core/archurban.js` | new | `genArchUrban(ctx)` = `genSkybridges` + `genGateways` + `genPlazaIsles` (+ `genLeyInlay` in P6); `genRowArcades`; `canopyStyleOf` (§7) |
| `src/core/archmetrics.js` | new | `archMetrics(ctx)` (§12) |
| `src/core/render-keys.js` | new, no three import | `GROUP_OF`, `shapeKey`, `bucketKey(e)`, `ROUND_SHAPES`, `footprintOf(e)`. Shared by renderer, collision, analysis, props and headless |
| `tools/arch-check.mjs` | new | baseline capture, parity, metric gates (§13) |
| `src/core/config.js` | edit | add `RULES['arch.*']` and `micro.canopy` (§11) |
| `src/core/generator.js` | edit | `DEFAULT_PARAMS.arch=1, wow=1, ley=0`; stage wiring (§3); `removeBuilding` also deletes entities with `ref2 === b.id` |
| `src/core/analysis.js` | edit | `roadFlow`: store `ctx.roadCost4 = cost`. `rasterSolids`: use `footprintOf(e)` |
| `src/core/buildings.js` | edit | `makeBuilding` delegates to the grammar; `decorate` is exported and gets arch caps (§8.7) |
| `src/core/city.js` | edit | `genCityBuildings` becomes two-pass in arch mode; `lotFeatures` is reused; signature/accent branches; mall on landmark lot gets tier A + crownLock flat; `export vistaScore` (unchanged) |
| `src/core/campus.js` | edit | faction style per academy, main `crownLock:'flat'`, special → signature builder, oldschool → relic decay (§10) |
| `src/core/rail.js` | edit | gaado keeps style; signature demotion (§10) |
| `src/core/props.js` | edit | graffiti driven by `ctx.factionInf.free_academy`; laundry generalised to canopy (§7.6); `buildOccupancy` uses `footprintOf` |
| `src/core/intent.js` | edit | rooftop roof substitution + skybridge edges + natural entries; `ctx.climbSites`; third signpost plate; minor-landmark filter (§10) |
| `src/core/collision.js` | edit | `footprintOf`; the round set gains `dome`, `onion`, `frus`, `cyl8` |
| `src/core/metrics.js` | edit | skip `l.minor`/`l.deleted` in landmarkVisible; call `archMetrics` |
| `src/core/export.js` | edit | schema `academy-city/2`, `buildings[]`, entity arch fields |
| `src/render/world.js` | edit | 9 geometries, facade shader attributes, `bldR`, `applyColors` (§11) |
| `src/render/ground.js` | edit | `'arch'` overlay; `'line'` decal (P6) |
| `src/main.js`, `index.html` | edit | inspector 건축 section, colour mode, overlay button, `arch` rule group, `sig` labels and POI type, legacy select |
| `tools/headless.mjs` | edit | `--param k=v`, `--style` PNG, round footprints, `arch:` summary |
| `docs/DESIGN.md` | edit | new chapter "건축 문법: 양식장 · 구성 문법 · 위계 · 시그니처" |

---

## 3. Pipeline wiring (`src/core/generator.js`)

```js
['flow0', ..., (c) => { buildHubs(c); roadFlow(c); chooseLandmarkSites(c); prepareArchitecture(c); }],
['buildings', ..., (c) => { genCenter(c); genCityBuildings(c); genContainerYard(c); genHarborFeatures(c); genRowArcades(c); }],
['campus', ...]   // genCampuses passes arch specs
['rail', ...]     // clearance keeps style; demotes hit signatures
['props', ..., (c) => { genArchUrban(c); genProps(c); }],   // skybridges, gateways, plaza isles before occupancy
```

Every new entry point starts with `if (ctx.params.arch === 0) return;`.

`prepareArchitecture` order is:
1. `assignDialects`
2. `computeLotFeatures`
3. `computeFactionField`
4. `computeLotStyles` (field → s1, s2, t)
5. `assignBlockGenes` (+ majority filter, rows)
6. `chooseSignatureSites` (+ coverage fill, vista-yield)
7. `applyFrames`
8. `chooseAccents`
9. `applyBudget`
10. `buildStyleRaster`

---

## 4. Style vocabularies (`archstyles.js › STYLES`)

Silhouette first: each vocabulary owns one crown family that reads at map zoom (★ in the table). Window pattern ids are defined in §11.2.

Small glow colours are lint-safe (§12.6). The allowed small-glow set is: `#ff5a4a` red-lantern (h5), `#ff4fd8` neon-magenta (h313), `#6f8cff` periwinkle (h228), `#e27bff` lilac (h287), `#9dff6a` lime (h99), plus near-white. Glow parts ≥ 2.5 m are exempt and may use gold `#ffe28a` or rose `#ff9fd0`.

| key · 이름 · used by | walls (palette) | trim / roofs | win (weights) · floorH · bay | footprints | ops | crowns (★ = signature family; W = walkable) | flatMin | attachments | accent: hinge / terminus | canopy · gate pier |
|---|---|---|---|---|---|---|---|---|---|---|
| **halo** 헤일로 신고전 · center + civic field | #eef1f7 #e4e8f2 #f6f1e4 #dfe5f0 | #c9a646 / #7f93b8 | curtain .6, round-arch .4 · 3.8 · 2.4 · flags plinth+cornice | rect 3, oct 1, L 1 | taper(.82–.90) 3, setback 1, none 1; float (S/A only) | flat W 4, ★dome W(ring) 2, mansard W 2, halo-ring W 1 | .55 | lightstrip(gold) 2, pinnacles 1, colonnade (A) 1 | cyl8 chamfer corner + oct crystal (std gold) / drum + dome + halo torus | – · cyl column + floating torus |
| **neon** 네온 적층 · commercial nearer centre | #f3e3cf #ead6e0 #d9e0e6 #f0e6c8 #e6d3f0 | #3b3f52 / #8d8f99 | lattice .5, grid .5 · 3.2 · 2.0 · lit .3, string course | rect 4, L 1 | ★stackJitter(σ .5 m, yaw ±.06) 3, cantilever 2, none 1 | flat W (com props) 6, capsule W 1 | .80 | balcony 2, signStack 2, lightstrip(#ff4fd8) 1 | mascot head (box + 2 pyr ears + 2 glow eyes) / capsule crown Ø5 + torus | lantern strings (#ff4fd8/#6f8cff) · stacked boxes + glow band |
| **lantern** 등롱 바자르 · commercial farther | #ead7b8 #dcc0a0 #f2cc8f #e9c46a #d9a07a | #8a2f28 / #b5523b #2a6f6f #3b4a6b | lattice .7, grid .3 · 3.0 · 1.6 · lit .35 warm | rect 4, L 1 | ★eaves (non-solid hip skirts every 2 F) 3, cantilever 2, none 1 | ★eaves W 5, pavilion W 2, gable 1 | .75 | lanternRow (#ff5a4a) 2, balcony 1, bay 1 | pagoda bay tower (+2 F, 2 hip skirts, pyr finial) / same taller | lantern strings (#ff5a4a) · lacquer post + lantern |
| **cottage** 지붕 마을 · residential, drier | #f3e9d2 #e8d6b0 #dfe8e0 #f2d7c9 #e9e4f2 | #6b5a4a / one per block of #b5523b #2f6b7a #6b4f8a #4a7a4a | round-arch .5, grid .5 · 3.0 · 2.2 | rect 3, L 2 | none 3, setback 1 | ★gable(.35d ≤ 3.2 m) 4, hip 2, mansard W 1, flat W 2 | .25 | chimney 2, dormer 2, bay 1 | corner turret (cyl + cone, +1 F) / clock gable (front gable + glow disc ≥ 2.5 m) | laundry (existing) · brick pier + small gable |
| **terrace** 물길 테라스 · residential, wetter | #f5f3ee #e3edf2 #f1e9dc #e8f0e6 | #2f6f8f / #5d8aa8 #c0643c | round-arch .5, grid .5 · 3.0 · 2.4 | rect 3, L 2 | ★terrace (water-facing side recedes 2.5 m every 2 F) 3, none 1 | garden+pergola W 4, gable 2, flat W 2 | .60 | balcony 2, planters 2 | glass dome greenhouse on roof / same + bay | laundry · pergola post |
| **lumiere** 장미 고딕 · trad_academy | #f4efe2 #ebe4d4 #e6dccb | #8a7a5c / #4a6a8a #3e5a78 | lancet .85, grid .15 · 3.8 · 2.2 · plinth + string | rect 3, L 1 | none (buttress is an attachment) | ★steep gable (.75d ≤ 9 m) 4, spire(pyr, footprint ≤ 10 m) 1, flat+pinnacles W 2 | .30 | buttress 3, pinnacles 2, rose (A) 1 | cyl8 turret + pyr spire (h = 2.5⌀) / rose-window gable front (glow disc + gold torus) | – · box pier + pyr pinnacle |
| **arche** 에테르 기계 · tech_academy | #e8eef3 #d6e0e8 #c9d5df #cfdde6 | #2a6f9f / #5a6b7a | ribbon .6, curtain .4 · 3.4 · 1.4 · lit .15 | rect 3, round 1, oct 1 | pilotis 2, cantilever 1, none 2 | flat W (tech props) 4, ★halo-ring W 2, sawtooth W 2, dish W 1 | .65 | lightstrip(#6f8cff) 2, fins 1, pipes 1 | glass drum + halo ring / floating top tier (1 m gap + glow plate) | glow pipe · frus pillar + vertical glow ring |
| **redline** 고철 펑크 · free_academy | #c7a69a #a8857a #b9a17d #8f8a84 #a2584f | #e0413b (std) / #6a3a34 | sparse .7, grid .3 · 2.9 · 2.6 | rect 4, L 1 | ★stackJitter(σ .8, yaw ±.12) 4, addon (side shack) 2, none 1 | flat W (tank) 3, ★junk W 3, lean-to W 2 | .70 | scaffoldSteps 2, flags 1, pipes(#ff4fd8) 1 | billboard tower + tank / giant graffiti wall (glow plane ≥ 2.5 m) | – (graffiti carries it) · container on end |
| **stella** 성좌 오페라 · arts_academy | #ece4f3 #e0d3ee #f3e8ef #d9d6ee | #6b4a8a / #6b4a8a #3d5a80 | round-arch .7, porthole .3 · 4.0 · 2.6 · lit .2 | rect 2, round 2, oct 1 | taper 2, none 2 | ★dome W(ring) 3, ★onion 2, mansard W 1, flat W 2 | .35 | starFinial (oct, std gold) 2, colonnade (A) 1, lightstrip(#e27bff) 1 | cyl8 rotunda + onion + star / dome | – · round arch + star |
| **tide** 청해 부두 · harbor | #9fb7c4 #c2ccd1 #c9b49a #8fa3ad #b0775a | #2f4b5c / #c84b31 #5a6e7a #2d4a6a | porthole .6, ribbon .4 · 4.2 · 3.0 | rect 5 | none | ★vault 3, ★sawtooth W 3, flat W 2 | .35 | silo 2, vent 1 | silo watch tower / anchor sign tower | – · bollard + rope beam |
| **grove** 숲의 정자 · park outer band | #eadfc4 #d9c9a3 #c9d8b5 | #6b4f2f / #5f8f4f #c0643c | round-arch .6, grid .4 · 3.0 · 2.2 | rect 2, round 2 | none | ★mushroom 3, thatch(cone) 2, flat W 1 | .20 | roots 1, vines 1 | big mushroom cap | – · frus trunk + leaf sphere |
| **relic** 옛 루미나 (modifier) · ruins | ghost palette lerped 50 % toward #8e877c | ghost trim desaturated | sparse 1.0 · ghost floorH | ghost | existing `broken` massing + ghost op at 50 % strength | `decay(ghostCrown)`: 40 % none, else ghost crown with rx/rz ±.25, y −0.4 | ghost | overgrowth sphere, rubble | leaning top tier (rz .05) + overgrowth | laundry · broken pier + overgrowth |

Further constants:

- **`HYBRID_OK`** (crown and body borrowing are allowed only for these unordered pairs; palette, ornament and window borrowing are always allowed): lumiere–stella, lumiere–cottage, lumiere–halo, arche–redline, arche–neon, arche–halo, neon–halo, neon–lantern, lantern–cottage, lantern–terrace, lantern–stella, stella–terrace, stella–halo, tide–lantern, tide–redline, grove–cottage, grove–terrace.
- **`IDENTITY_RANK`** (used by gateways): academies 3; harbor, ruins, park and commercial 2; residential 1; center 0.
- **`FACTION_EMIT`**:

  | faction | district type | A | L (m) |
  |---|---|---|---|
  | lumiere | trad_academy | 0.9 | 150 |
  | arche | tech_academy | 0.9 | 130 |
  | redline | free_academy | 0.9 | 120 |
  | stella | arts_academy | 0.9 | 150 |

  Civic emitter: `halo`, A = 0.7, L = 150, measured from the plaza edge (r − 62).

### 4.1 Dialects (`assignDialects`, contextual, P3)

- **Commercial.** With 2 or more instances, the instance with the smallest `hypot(d.x, d.z)` is `neon` and the others are `lantern`. With a single instance, it is `neon` if r < 220 and `lantern` otherwise. On lumina this gives #5 → neon and #7 → lantern.
- **Residential.** Compute `wet = mean over the district's lots of min(distRiver, distSea)`. The smallest `wet` gets `terrace` and the others get `cottage`. If |Δwet| < 10 m, the instance farther from the centre is `cottage`.
- **Other districts** use their table style. `d.style` and `d.dialect` hold the Korean name, which is shown in the district panel.

---

## 5. Lot features and the style field (`style.js`)

### 5.1 `computeLotFeatures(ctx)` → `lot.F`

This is computed once and reused by `genCityBuildings`. Extract the existing flow sampling into `lotFeatures(ctx, lot)` in `city.js` and call it from both places.

| feature | definition |
|---|---|
| `area, corner, frontRank, interior, r, sea, river` | as today (`sea = distSea`, `river = distRiver` at the lot centre) |
| `flow` | max of `roadFlow.at` at front face + n·{4, 8, 12} (existing code) |
| `axis` | from the front face centre, 5 rays at angles {−12°, −6°, 0, 6°, 12°} off the outward normal, stepping 2 m up to 320 m. Each ray counts road, river and lake cells after entering within 8 m and stops at the first other cell. `axis` = max ray length, and `V = clamp((axis − 40)/140, 0, 1)`. `axisDir` = the best ray |
| `N` | `max over nodes w_n · exp(−max(0, d − 12)/18) · (corner ? 1 : .6)`, with `w_n` = 1.0 if `mainCount ≥ 2`, 0.7 if `= 1`, 0.4 otherwise |
| `X` | openness: over 16 rays × 90 m, the fraction of 2 m samples that are road, water, park zone or plaza |
| `W` | `river < 25 \|\| sea < 30`. `waterDir` = direction of decreasing `min(distRiver, distSea)` |
| `parkEdge` | distance to `ZONE.PARK` ≤ 50 m |
| `passage` | `interior && ctx.blocks[lot.block].passages?.length > 0` |
| `dB, nd, hard` | border march: 16 directions up to 48 m in 2 m steps on `ctx.district`. The first district ≠ own and ≠ 255 gives `nd` at distance `dB`. `hard = true` if any step before the hit lies on a `ROAD.MAIN`, `ROAD.COAST` or `TERRAIN.RIVER` cell. `rivalB` = `dB` when `(own, nd)` is a RIVALS pair |

Cost is about 25 ms.

### 5.2 `computeFactionField(ctx)` (P2, road-geodesic)

For each academy district f with `d.gate`:

- **Sources:** 4 m cells of `ctx.roadCost4` within 12 m of the gate, with initial cost 0; plus road cells 4-adjacent to the campus zone boundary of f, with initial cost 40 m.
- **Search:** `dijkstra(256, 256, cost, src, 900, false, 4, srcDist)` gives `g_f`.
- **Result:** `ctx.factionInf[f.type] = Float32Array` with `exp(−g_f / L_f)`.
- **Per lot:** `inf_f(lot)` = the value at `snap(front face centre + n·4 m)`. Interior lots use their block's nearest passage, or the lot centre.

The approach avenue then becomes a faction high street: influence decays along the road network, not radially. Cost is about 30 ms.

### 5.3 `computeLotStyles(ctx)` → `lot.arch.{w, s1, s2, t, ghost, decay}`

```
w[base(lot.district)] += 1.0                      // dialect-resolved style; ruins base is skipped (see decay)
if (!F.hard && nd not rival && F.dB ≤ 48) w[base(nd)] += 0.5·(1 − dB/48)^1.3      // soft-edge blend only
for each faction f: if (lot district type is a RIVAL of f's type) skip           // rivals never blend
                    else w[f.style] += 0.9 · inf_f(lot)
if (district ≠ center) w.halo += 0.7 · exp(−max(0, r − 62)/150)
normalise; s1 = argmax, s2 = second (or s1); t = w2/(w1 + w2) ∈ [0, .5]
campus-zone buildings and purity:1 specs → t = 0
ruins district: decay = true; s1 = ghost = argmax over the remaining weights (fallback 'cottage')
fort = F.rivalB ≤ 40
```

### 5.4 `assignBlockGenes(ctx)` (P3 block genes + P2 majority filter)

1. **Block style.** For each block, the style is the frontage-length-weighted mode of the non-interior lots' `s1`.
2. **Majority filter.** If a lot's `s1 ≠ blockStyle`, `s2 == blockStyle` and `t ≥ 0.2`, swap s1 and s2.
3. **Block gene.** Using `ctx.rng.fork('arch:b'+blk.id)`, roll from the block style table:
   - `env {wallPair:[i, j], win, trim}`
   - `mass {footprint, op}`
   - `crown {family, roofColor}`

   The crown pick uses the flatMin quota: `P(walkable) = flatMin + (1 − flatMin)·Σw_walk/Σw`. Roll walkable or non-walkable first, then pick by weight inside that group.

   In route districts (neon, lantern, arche) a block with ≥ 3 lots of expected height ≥ 5 m is forced to a walkable crown in ≥ 80 % of blocks. This is the rooftop-route guard.
4. **Block-shared thresholds.** Roll `u_B[slot]` for the five slots palette, ornament, window, crown and body.
5. **Lot gene.** Each lot inherits the block gene. With p = 0.35 (lot rng), exactly one layer mutates: env 0.4, mass 0.3, crown 0.3. A lot whose `s1 ≠ blockStyle` rolls its own gene.
6. **Borrowing ladder.** Thresholds are τ = {palette .12, ornament .12, window .22, crown .30, body .40}. Compute `p_s = clamp((t − τ_s)/(.5 − τ_s), 0, 1)`. Slot s takes `s2`'s vocabulary iff `u_B[s] < p_s`; for crown and body the pair must also be in `HYBRID_OK`. Because `u_B` is shared per block and `t` is monotone in border and faction distance, the gradient is monotone with no salt-and-pepper.
7. **Rows.** `ctx.archRows` groups `block|nominalFront` for non-interior lots, sorted along the face tangent. Each row has:
   - `palettePair`: wall colour alternates `wallPair[k % 2]` for lantern, neon, cottage and terrace; it is a single colour for lumiere, halo, arche and stella.
   - `arcade`: true when `STYLES[s].arcadeProb` (lantern .35, lumiere .25, halo .30, others 0) passes, ≥ 2 lots, all frontRank ≥ 3, and row length ≥ 20 m.
   - `idx` per lot.
8. **Floor clamp (P3).** After pass 1 of `genCityBuildings` (§10), common-tier floors are clamped to `[m − 2, m + 2]`, where m is the block median of C-tier floors. `skylineFactor` stays as it is.

### 5.5 Raster for the overlay

`ctx.archLotStyle` holds per-lot `s1` index, `t`, and a borrowed bitmask. `ctx.factionInf` is reused for the road tendrils.

---

## 6. Hierarchy and budgets (`chooseAccents`, `applyFrames`, `applyBudget`)

| tier | who | arch parts max (bodies + crown + attachments + accent) | decorate max | notes |
|---|---|---|---|---|
| L | existing landmarks | – | – | unchanged |
| S | signatures (§9) | 60 | 6 | `b.tier='S'` |
| A | accents: terminus, hinge, rowhead; campus main and special; landmark-lot mall; tech supercomputer | 14 | 8 | one bold feature |
| C | common | 6 | 8 | |
| D | interior-lot buildings, shed, gaado, area < 60 m², budget demotions | 2 | 4 | box + crown only |

decorate caps in arch mode:
- facade ≤ 4 (door, awning, sign, terrace set);
- AC ≤ 2 per building, facade and roof combined;
- roof props ≤ 3 (A: 5): stairhut 1, tank 2, billboard 1, antenna ≤ 2, solar rows ≤ 2.

**`chooseAccents`** (after signatures):
- **Candidates:**
  - `terminus`: `F.axis ≥ 90`; top 20 by axis, with spacing ≥ 60 m.
  - `hinge`: one per node with `mainCount ≥ 1`. Pick the lot within 30 m that is a corner, has 2 faces with rank ≥ 3, and is closest to the node.
  - `rowhead`: the end lots of rows with ≥ 3 lots and frontRank ≥ 3.
  - Campus main and special get A directly.
- **Exclusions:** signature lots, frame lots, interior lots, landmark lots.
- **Quota per district:** `round(0.12 · nBuildingsEst_d · wow)`, minimum 2.
- **Order:** greedy by priority terminus > hinge > rowhead, then by flow. Accents must be ≥ 45 m apart, and the same treatment ≥ 90 m apart.
- **Expected:** about 70–110 on lumina.
- `fort` is an attachment flag and does not consume quota.

**`applyFrames`** (P3, softened):
- **Which lots:** lots in the signature's block within 24 m (centre distance), plus lots whose front centre is within 20 m of the signature's front centre with `dot(n1, n2) < −0.7`.
- **Effects:**
  - `floorsCap = max(1, sigFloors − 2)`, where `sigFloors = round(sigH / 3.2)`;
  - no accent;
  - no rooftop billboard (`b.noBillboard`).
- Ground-level signs stay.

**`applyBudget`** (P2):
- `projected = Σ tierMax(arch) + 5 · nBuildings`.
- If `projected > ctx.archBudget.cap = 9500` (building + roof + facade entities), demote C lots to D in ascending `F.flow` until it fits.
- Log `arch.tier: S n, A n, C n, D n, demoted n`.

---

## 7. Urban rules (building-to-building relations)

### 7.1 Hinge, terminus, rowhead (accent tier, grammar §8.6)

- **Hinge:** treatment at the corner facing the node. The centre is inset `r` from both street faces, and height is `b.h + 1–2 floors`.
- **Terminus:** a centred tower bay, `0.3 ×` face width, rising `b.h + 2 floors`, with the style's ★crown, on the face the axis looks at.
- **Rowhead:** +1 floor and the style's corner accent.

### 7.2 Rival fortification (`arch.rival`)

Applies to lots with `fort`:
- up to 5 merlons (box 0.8 × 0.9 × 0.8) on the roof edge facing the rival, only when the crown is walkable;
- 1 banner (glow box 0.15 × 3.2 × 1.2 in the own district's accent colour) on the rival-facing face.

The existing `placeBorders` checkpoints are unchanged. There is no blending across rival borders (§5.3).

### 7.3 Row arcade (`arch.arcade`, `genRowArcades`, end of `buildings` stage)

For rows with `arcade`:
- Each building's tier 0 (height `fh`) is recessed 2.4 m on the front face, so `b.groundInset = 2.4`. Upper tiers keep the full footprint from `y = fh`; collision puts them in the deck layer, so they are walkable underneath.
- Along the union of the row's front line, place an `arch` entity every 3.2 m: `w 3.2, h fh − 0.2, d 0.5`, trim colour, **`solid:false`**. Add one pier box (0.5 × (fh − 0.2) × 0.5, solid) at each joint.
- `decorate` puts the door on the recessed face, suppresses the awning, and raises the sign to `y = fh + 0.3`.
- Expected: about 20–30 rows, about 500 entities.

### 7.4 Skybridges (`arch.skybridge`, `genSkybridges`, props stage, after rail)

- **Candidate buildings:** `s1 ∈ {halo, neon, lantern, arche, lumiere}`, tier C or A, `h ≥ 7`, walkable main roof.
- **Pair search:** PointHash at 24 m. Faces must be opposite (`dot ≤ −0.95`), with a gap of 3.5–9 m between face centres along the normal, lateral overlap ≥ 3 m, and 5 samples in the gap that are ALLEY or MINOR road or empty land. Also require `|hA − hB| ≤ 1.5`, and no rail track within 6 m when `|y − 11| < 4`. If the alley line is `covered`, require y ≥ 9.
- **Deck:** a box with top at `min(hA, hB)`, w 2.4, length gap + 1.2, `solid, deck:true`, `ref = A.id`, `ref2 = B.id`.
- **Dressing:**
  - lumiere: non-solid gable roof over the deck;
  - arche: non-solid glass `cyl` (rz π/2) tube;
  - neon and lantern: 2 glow spheres plus 2 non-solid rail boxes;
  - halo: gold rails.
- **Limits:** ≤ 1 per building, ≤ 8 per district, ≥ 40 m apart.
- `ctx.skybridges.push({a, b, y})`.

### 7.5 Gateways (`arch.gateway`, `genGateways`, props stage before `genProps`)

1. Resample each level-1 `roadLine` at 2 m. A **transition** is index k where `district(k−1) ≠ district(k)`, both ≠ 255, and 20 m before and after the crossing stay in A and B respectively.
2. **Rejections:**
   - a rival pair;
   - `style(A) == style(B)`;
   - within 25 m of a node, 12 m of rail track or station OBBs, or 30 m of a campus gate;
   - on bridge points.
3. **Score:** `roadFlow.at(pt)`. Keep the best per unordered pair. Accept globally by score with spacing ≥ 120 m, at most 10.
4. **Piers:** at `±(line.width/2 + 1.2)` along the normal. Each must be on a `ROAD.SIDEWALK` cell; nudge outward ≤ 2 m, else skip the gateway.
   - The left pier (A side) uses `PIER[style(A)]` and the right pier uses `PIER[style(B)]`. Each pier recipe is ≤ 4 entities (§4 table).
   - Lintel: 2 boxes (A trim, B trim) at y 6.6, h 1.1, non-solid.
   - Nameplate: glow box 3.2 × 0.7, `name = "${A.name} · ${B.name}"`.
   - The owner is the side with the higher `IDENTITY_RANK`; on a tie, the side farther from the centre. The owner's colour goes on the plate.
5. Total ≤ 10 entities each. `why = "${A}↔${B} 우호 경계 · 흐름 xx% — 두 양식이 만나는 문"`.

### 7.6 Alley canopy (`micro.canopy`, in `props.js` alley loop)

Replace `if (d.type === 'residential' || d.type === 'ruins')` with `canopyStyleOf(line)`, the majority `s1` of lots touching the alley:
- **neon / lantern:** every 7 points with p = .5. A catenary of 3 box segments (sag 0.12 L) at y 5–6, plus 2 glow spheres Ø0.6 (#ff5a4a for lantern; #ff4fd8 / #6f8cff for neon).
- **arche:** every ~20 m, one glow cyl Ø0.25 along the alley at y 5 plus 2 bracket boxes.
- **cottage, terrace, relic:** the existing laundry code, keeping rule `micro.laundry`.

No other variants.

### 7.7 Graffiti (one field drives both)

In `props.js`, replace `0.75·exp(−dd/170)` with `0.75 · infAt(ctx.factionInf.free_academy, building)`. Free-academy campus buildings use 1.0. Graffiti count must stay within ±35 % of legacy.

---

## 8. Component grammar (`archgrammar.js`)

### 8.1 Entry from `makeBuilding` (`buildings.js`)

```js
export function makeBuilding(ctx, spec, rng) {
  const arch = ctx.params.arch !== 0 && spec.arch;           // spec.arch built by city/campus/rail
  ... b record (unchanged) ...; b.arch = arch || undefined;
  if (arch) buildArchitecture(ctx, b, spec, prog, rng.fork('arch'));   // bodies + crown + attachments, fills b.roofs
  else { /* legacy massing + gable block, byte-for-byte unchanged */ }
  b.h = Math.max(...b.roofs.map(r => r.y));
  decorate(ctx, b, prog, rng, spec);                          // arch caps applied inside when b.arch
  return b;
}
```

`spec.arch` has the shape:

```
{ s1, s2, t, slots, gene, tier, decay, ghost, accent, fort, crownLock, formal, purity,
  envelope: {u0,u1,v0,v1}, row, rowIdx, floorsCap, noBillboard, groundInset }
```

`envelope` is the lot rectangle in building-local coordinates, minus 0.3 m.

### 8.2 Kit resolution

`resolveKit(arch)` takes each slot from `slots[s] === 'B' ? STYLES[s2] : STYLES[s1]`, and applies `decay` (relic modifier) last. Key values:

- `fh = kit.floorH`, or 4.2 when `prog.tallFloors`;
- `H = floors · fh + (groundShop ? 0.8 : 0)`;
- wall colour = `row.palettePair[rowIdx % 2]`, jittered ±4 %;
- roof colour = block gene colour.

Floor heights stay ≤ 3.4 in the route districts (neon 3.2, lantern 3.0, arche 3.4), so the rooftop jump rule `dh ≤ 3.5` keeps working.

### 8.3 Footprints (ordinary buildings)

| footprint | rule | bodies |
|---|---|---|
| `rect` | 1 part `box` | `mat 'bld'` |
| `L` | existing slab-L formula, generalised: front bar `0.55·d`, wing `0.35·w` on a random side; needs `w > 18` | 2 |
| `round` | aspect ≤ 1.4 and `min(w, d) ≥ 9`: `cyl`, D = min(w, d) | `mat 'bldR'`. Roof record = inscribed square 0.7 D, `round:true` |
| `oct` | same condition, `cyl8` | `mat 'bldR'` |

Program massing hints (`PROGRAMS.massing`) weight the choice ×3: `slab` → L, `podium` → op podium, `stepped` → op taper, `broken` → relic. `formal` (campus) allows rect and L only.

### 8.4 Tier plan and operators (`planTiers`)

- F ≤ 2 or tier D: a single tier.
- F ≥ 6: 2 segments, split at `round(.6F)`.
- F ≥ 10: 3 segments.
- Tier C uses ≤ 2 segments; A uses ≤ 3.

| op | effect | constraints |
|---|---|---|
| `taper(k)` | segment parts scaled about the centre, `w,d *= k` (k .82–.90, cumulative). The lower segment's top becomes a `terrace:true` roof record | stop when `min(w, d) < 5` |
| `setback` | upper segments: front edge recedes 1.5 m | front rank ≥ 3 |
| `cantilever` | segments with `y0 ≥ 4.5` shift toward the front normal by `min(1.2, envelope margin)` | front rank ≥ 3; **never past the lot envelope** |
| `stackJitter(σ, ρ)` | each segment offset by N(0, σ) in u and v, yaw ±ρ, clamped inside the envelope | not on `formal` |
| `pilotis` | tier 0 (3.6 m) becomes a core box `0.5w × 0.5d` plus ≤ 6 cyl columns Ø0.6. The body starts at y 3.6 (deck layer, walkable under) | arche only; **no ramps (sawtooth or lean-to) on elevated bodies**, because ramp collision is floor-layer only |
| `eaves` | a non-solid `hip` skirt (`w + 2.4, d + 2.4, h .9`) at every 2nd floor line, ≤ 3 | lantern |
| `terrace` | every 2 floors, the side facing `waterDir` (else front) recedes 2.5 m; terrace roof records get 2 planter boxes | terrace |
| `addon` | 1–3 side shacks (box 3–5 × 2.9–5.8 × 3–4, rz ±.04) on non-front faces inside the envelope | redline |
| `podium` | base 2 F full footprint plus a tower of 0.55–0.75 offset (legacy podium) | mall, gov |
| `float` | crown lifted 1.5 m with a glow oct (`#6f8cff`, ≥ 2.5 m) in the gap; the crown is `solid:false` | halo; tier S/A only |

Twist, split, court, U and cross are **signature-only**.

### 8.5 Crowns (`CROWNS` table: `{walk, ents, build}`)

Crowns are applied to the top roof record `r`. Non-walkable crowns set `r.pitched = true` and `r.walk = false`.

| crown | recipe | walk |
|---|---|---|
| `flat` | existing roof props by style: halo `com`; neon `com`; lantern `res`; arche `tech`; redline `res` + tank; terrace `garden`. Halo's gold coping is done by shader flag `cornice` with 0 entities | W |
| `eaves` | non-solid `hip` (`r.w + 2.4, r.d + 2.4, h 1.0`) with **top at r.y − 0.05**, so it reads as a pagoda eave and the roof stays walkable | W |
| `pavilion` | 4 cyl posts (0.3 × 2.4) + solid `hip` 4.2 × 4.2 × 1.6 at r.y + 2.4 (deck) | W |
| `garden` | existing roof garden + pergola (4 thin cyl + 1 slab deck at +2.4) | W |
| `junk` | 1–2 containers (6.1 × 2.6 × 2.44, yaw ±.1, solid, `COLORS.container`), optional bus box 8 × 2.8 × 2.5 with a glass band | W |
| `leanto` | 1 ramp (`w r.w, h 1.6, d .5·r.d`) | W (floor-layer bodies only) |
| `halo-ring` | mast cyl 0.3 × 4–6 + glow torus (`w .8·min`, rx π/2) at r.y + 4–7, non-solid | W |
| `dish` | existing tech dish | W |
| `sawtooth` | `floor(long/5)` ramps, each 5 × short × 2.2 | W (floor-layer only) |
| `mansard` | solid `mansard` (`r.w + .4, r.d + .4, h 2.2`). Updates `r.y += 2.2` and `r.w, r.d *= .7` | W |
| `dome` | drum cyl (h 1.5, w .8·min) + `dome` (`w .75·min, h .6w`) + lantern cyl. Walkable ring if `min − w ≥ 6` | W / – |
| `onion` | drum + `onion` (`w .7D, h 1.1D`) + needle cyl | – |
| `gable` / `steep` | existing `gable` shape, ridge on the long axis (swap w/d and rotate π/2 if `d > w`). Pitch: cottage .35d (≤ 3.2), lumiere .75d (≤ 9), tide .25d | – |
| `hip` | solid `hip` (`w + .6, d + .6, h .3·min ≤ 3.5`) | – |
| `spire` | `pyr` (`min·.7`), `h = 2.5·min` | – |
| `vault` | `vault` on the long axis, `h .4·short` | – |
| `mushroom` | `dome` (`w 1.25·max, h .35w`, red #c0643c / orange) + 3–5 white spheres | – |
| `thatch` | cone (`w 1.15·max, h .6w`) | – |
| `capsule` | non-solid sphere Ø ≥ 3 (neon palette) + glow torus band | W |
| `decay(c)` | relic: 40 % none; else crown c with rx/rz ±.25, y − .4, colour lerped 50 % to #8e877c | per c |

Crowns that occupy the roof centre (`dome`, `onion`, `halo-ring`, `sawtooth`, `capsule`, `pavilion`) suppress `decorate` roof props except AC, which goes to the corners. `crownLock:'flat'` forces `flat`.

### 8.6 Attachments and accents

Attachments are picked by face rank from `b.sides`: the street face gets ornament; the alley and back faces get services. Priority order applies when the budget is tight.

| attachment | placement | ents |
|---|---|---|
| `buttress` | lumiere; long non-front faces, every 4.5 m, ≤ 2/face (C) or ≤ 3 (A); box 0.8 × .7H × 1.2 (A adds a pyr cap) | 2–6 |
| `pinnacles` | 4 corner `pyr` 1.0 × 3.0 on a walkable roof | 4 |
| `bay` | front oriel box 2.4 × (F−1)·fh × .9 from y = fh, `mat bld` with the same `fac`; ≤ 2 | 1–2 |
| `balcony` | thin slab per floor (.6·len × .15 × 1.0), non-solid; ≤ 3 | ≤ 3 |
| `lightstrip` | glow box `len × .25 × .12` at each tier's top front edge; ≤ 2 | ≤ 2 |
| `signStack` | 3 vertical glow boxes .35 × 4–8 × 1.0 on the front | 3 (A) / 1 (C) |
| `lanternRow` | 2 glow spheres Ø.6 under eave skirts | 2 |
| `scaffoldSteps` | redline. Requires `b.h ≤ 9.8` and a non-front face with `len ≥ 1.4·ceil(h/1.6) + 1`. Crate boxes from y 0 rising 1.6 m per 1.4 m run (jump 1.6 / mantle 3.6 compatible, all floor-layer). Sets `roof.entry = true` | ≤ 6 |
| `pipes` | 1–2 cyl Ø.35 on the alley face (redline glow #ff4fd8, others std) | ≤ 2 |
| `chimney` | `frus` .9 × 1.8 on the roof | 1 |
| `dormer` | small gable 1.8 × 1.2 × 1.6 on the front slope, ≤ 2 | ≤ 2 |
| `silo` | cyl Ø3–4.5, h = b.h + 2, + cone cap, on a non-front side inside the envelope | 2 |
| `colonnade` | A only, front setback ≥ 1.5: ≤ 8 cyl Ø.8 + entablature box | ≤ 9 |
| `starFinial` | std gold oct 1.2 × 1.6 on the crown apex | 1 |
| `roots` / `vines` | 3 tilted cyl / 2 green boxes | ≤ 3 |
| `fort` | §7.2 | ≤ 6 |

Accent treatments are listed per style in §4. Each is built from these parts plus the style's ★crown, within ≤ 14 arch entities.

Every crown, attachment and accent entity carries:
- `rule`: `arch.grammar`, `arch.corner`, `arch.terminus`, `arch.rival` or `arch.arcade`;
- `why`, e.g. `"루미에르 영향 0.42 (정문에서 도로거리 160m) · 경계 차용: 왕관"`.

Bodies keep `spec.rule` (e.g. `meso.zoning`), so existing rule counts stay the same.

### 8.7 Body entity fields (shader input) and decorate

- **Every body** gets `fac: [win, fh, bay, flags]`, `trim: '#hex'` and `lit`.
- **Tier-0 bodies (y = 0)** with shop programs also get `band: PROGRAMS[prog].color` and `bandMask` (bit k = face k with `b.sides[k] ≥ 3`). Shop programs: shophouse, convenience, cafe, arcade_game, karaoke, bookstore, laundromat, mall, fishmarket, gaado. This keeps use readable now that wall colour encodes style.
- **Flags:** 1 plinth, 2 cornice, 4 string course, 8 lit.
- **Bookkeeping:** `b.footprint`, `b.ops[]`, `b.crown`, `b.win`, and `b.grammar[]`, a trace of chips such as `['fp:L', 'op:taper .86', 'crown:steep', 'att:buttress×4', 'accent:hinge']`.
- **decorate in arch mode:** caps from §6; `noBillboard`; door and sign handling under `groundInset`; awning colour stays the district accent; roof grammar style taken from the kit.

---

## 9. Signatures (`signatures.js`)

### 9.1 Contract

```
SIGNATURES[id] = { name, styles:{style:affinity}, where(lot,F,ctx), filter(F), site(F,lot) → [0,1], tall:bool, prog,
                   poiName, hMax, build(ctx, site, rng) → b, why(site) }
site = { lot, x,z,w,d,rot, front, faceDir, axisDir, hMax, style, kit, F, score, parts }
```

- `newSigBuilding(ctx, site, meta)` pushes a building record with `tier 'S'`, `signature id`, `prog`, `label`, `district`, `lot`, `front`, `sides`, `ents[]`, `roofs[]`.
- `part(b, e)` adds `{district, ref: b.id, rule: 'arch.signature', sig: id, solid: true, mat: 'std', cat: 'building', ...e}`. The topmost focal element uses `cat 'landmark'`.
- Each signature adds a POI `{type: 'sig', tier: 1, name, why, building}`.
- If the top is ≥ 18 m: `ctx.addLandmark({..., kind: 'signature', sig: id, minor: true})`.
- Climbable recipes push `ctx.climbSites.push({b, face, top, name})`.
- Walkable floaters are XZ-disjoint, one deck per 1 m cell. Decorative floaters are `solid:false`.

### 9.2 Catalogue: 13 city recipes and 3 campus recipes

| # | id · 이름 | style · site rule (`where` ∧ `filter` → `site`) | recipe (primitives, ≈ ents) | hook |
|---|---|---|---|---|
| 1 | `sky_isles` 부유 정원섬 | halo. **Not a lot**: plaza annulus. Placed by `genPlazaIsles` in the props stage, after rail | 10 islands, i = 0..9: θ_i = θ0 + 14°·i, r_i = 34 + 1.2i, deck top y_i = 1.2 + 1.5i, Ø6 (last Ø9). Each island: inverted `cone` (rx π, h .8Ø) non-solid + `cyl` deck (h .4, grass, solid, deck); a small tree on every other island; under-glow oct #9dff6a. The last island has a glass dome gazebo on 4 posts, a `view` secret and a vantage. θ0 is the best of 24 candidates with clearance ≥ 6 m from rail track, stations and bigscreens, and with the final island toward the highest-flow radial avenue. Consecutive gap ≈ 2.6 m, rise 1.5 (jump-reachable, XZ-disjoint) (≈ 40) | parkour loop around the spire |
| 2 | `lantern_tower` 천등 바자르탑 | lantern (.5 neon). commercial, area ≥ 220, frontRank ≥ 3 → `.5 flow + .3 V + .2 N` | 2 F podium (lattice, lit) + 5 tiers (1 F each, side ×.86ⁱ, yaw ±.16 alternating), each with a non-solid hip eave skirt (`+2.6`) + 2 glow spheres #ff5a4a; `pyr` finial + `frus` spire + glow sphere Ø1.2; lantern strings to 2–4 neighbour roofs within 30 m. prog `arcade_game` (≈ 50) | ladder (climbSite) → top tier vantage |
| 3 | `whale_market` 하늘고래 갈비뼈 시장 | lantern / neon. commercial, `F.passage`, area ≥ 300 (fallback 220) → `area/600 + .4·flow(passage mouth)` | 7 ribs: `torus` with `y = 0` (half-arch), `rot = spineAngle + π/2`, span_i = W·(.75 + .25 sin(π(i + .5)/7)), bone #efe6d2, **non-solid**. Spine box (non-solid), skull `sphere` 8 × 5 × 6 + `cone` jaw, 6 stalls (box + awning), 7 hanging glow spheres. Replaces the courtyard program, so `placeGates` no longer sees it as a courtyard (≈ 30) | hidden anchor at the end of the passage |
| 4 | `gacha_tower` 가챠 캡슐탑 | neon. commercial corner, frontRank ≥ 3 → `N·(.5 + flow)` | 1 F podium + core `cyl` (`bldR`, lattice) Ø4.5 h 24 + 10 capsule spheres Ø3.6 on a spiral (36°/2.2 m, radius 3.2, **non-solid**) each with a glow torus band; top glow sphere Ø5 + torus. prog `arcade_game` (≈ 26) | crossroads eye-catcher |
| 5 | `book_tower` 책탑 기숙사 | cottage / terrace; affinity ×(1 + 2·(w.lumiere + w.stella)). residential, area ≥ 220, frontRank ≥ 3 → `.5(w.lum + w.ste) + .3V + .2X` | 8 books k: box (`fpW − 1.2k`) × 2.9 × (`.7fpD − .8k`), y = 2.9k, yaw ±.12 alternating, spine palette #7a2e2e #2e4a7a #3f6f4a #c9a227 #6b4a8a, + white page box on one long side; desk lamp (`frus` + tilted cyl + cone + glow bulb). prog `dorm` (≈ 21) | ladder → top |
| 6 | `teapot_cafe` 찻주전자 카페 | cottage / terrace / lantern / grove. `V ≥ .35` OR (`parkEdge` ∧ frontRank ≥ 3) → `.6V + .2flow + .2·parkEdge` | 1 F plinth box (bld) + sphere body (`.8·min × .68·min`) at y 3 + torus band + `frus` spout tilted toward `axisDir` (rz −.9) + vertical torus handle on the back + `dome` lid + knob + 3 pale steam spheres + terrace tables. prog `cafe` (≈ 14) | the spout faces the street axis |
| 7 | `inverted_cottage` 거꾸로 오두막 | cottage. residential, `axis ≥ 90`, area 120–400 → `V` | 2 F house + gable; at y = h + 4.5 an upside-down house (gable rx π + box, yaw +.3, **non-solid**); 6 floating stair slabs (non-solid); ladder to the real roof with a `memory` secret (≈ 12) | "시선 끝은 이상해야 한다". Visible but unreachable tease |
| 8 | `water_mill` 수차 방앗간 | cottage / terrace / tide / lantern. not park; a side whose probe at 3–8 m hits `TERRAIN.RIVER` → `1 − river/12 + .2·flow`; max 2, ≥ 200 m apart | 2 F bld + gable; wheel `torus` Ø9 vertical, `rot` = water-face normal angle, centre y 1.0 at face + n·1.2, non-solid; 8 paddles (box) + axle `cyl`. prog `cafe` "방앗간 카페" (≈ 14) | uses the river edge |
| 9 | `container_babel` 컨테이너 바벨 | tide / redline. harbor or redline-belt lot, area ≥ 250 → `.4 w(tide\|redline) + .3X + .3flow` | 7 levels × 2 containers, level ℓ at y 2.6ℓ, yaw lot.rot + .49ℓ, centre circling radius 1.4; flag + billboard on top. Contiguous stacking (one deck), mantle-able corners. prog `warehouse` (≈ 17) | ladder + treasure on top |
| 10 | `gravity_scar` 중력 흉터 | relic. ruins, area ≥ 150 → `.5·dist(MAIN)/120 + .3(1 − F.X) + .2 area/400`. **Crater merge:** the seed lot plus same-block lots whose centres are within 16 m (≤ 3); merged lots get `prog 'scar'` (rubble decal, no building) | broken base (relic box h 2) + 8 debris boxes (3.5–5 × 1.4 × 3.5–5, tilt ≤ .15) on a growing spiral: r_k = 4 + 1.4k, angle step 4.0/r_k, top y_k = 2.4 + 2.6k, each touching the previous (gap ≤ .3 m) and XZ-disjoint (no wrap). Below 12 m debris must stay off non-crater lots (+1 m). Central glow oct crystal (h 6, y 22) + glow torus + 4 non-solid shards; `memory` secret on top (≈ 16) | vertical mantle parkour → 잊혀진 기록 |
| 11 | `witch_hat` 마녀 모자 탑 | lumiere-ghost relic, lumiere, grove. ruins or trad outer band, area 120–300, w.lumiere ≥ .2 or ghost = lumiere → `.5V + .3w.lum + .2X` | `cyl8` body (`bldR`, lancet) 5 F, Ø .8·min ≥ 7; brim cyl ×1.6; 3 stacked cones with rz 0 / .18 / .42 (bent hat); glow crescent torus. prog `bookstore` if allowed, else `house` (≈ 8) | silhouette |
| 12 | `junk_fortress` 고철 요새 | redline. redline s1, area ≥ 250, `rivalB ≤ 120` → `1 − rivalB/120 + .1 area/250` | container ziggurat (L0 3 × 2, L1 2 × 2 rotated 90°, L2 1 + bus with glass band, yaw ±.06); scaffold watch post + big red flag; glow `frus` searchlight tilted toward the rival; 2 ramps (run 6.5, rise 2.6). prog `shed`, POI "고철 요새" (≈ 24) | vantage + `tag` secret; ties to `intent.border` |
| 13 | `gyro_observatory` 자이로 천문대 | arche. tech outer band, area ≥ 260 → `.6X + .4V` | drum `cyl` (`bldR`, ribbon) Ø .8·min h 9 + `dome` + dark slit box + 3 glow armillary tori (Ø1.3 drum, rx 0 / π/3 / 2π/3) + `frus` telescope (rz .8) + catwalk ring deck at y 9. prog `lab` (≈ 10) | ladder → catwalk vantage |
| C1 | `rose_cathedral` 장미창 대성당 | lumiere campus `special` (replaces 성당) | nave box (bld lancet, fh 5) + steep gable; twin front towers + `pyr` spires h 12; glow rose disc (cyl rx π/2, Ø5) + gold torus; 8 flying buttresses (box rx ±.5) + pinnacles (≈ 24) | existing wonder "혼자 울리는 성당 오르간" |
| C2 | `colossus_garage` 레드라인 거신 차고 | redline campus `special` (replaces 오토바이 차고) | garage box + `vault` roof in 60 % of the rect; seated robot in the rest: torso 6 × 7 × 4, head 3 × 2.6 × 3 + glow visor, arms tilted rz ±.35, legs forward, shoulder cyls, antenna (≈ 14) | `tag` secret on the head |
| C3 | `organ_hall` 파이프오르간 홀 | stella campus `special` (replaces 콘서트홀 box + sphere) | 2 F hall box (round-arch) + `mansard`; 16 cyl pipes Ø1.4 on an arc behind the facade, `h_i = 10 + 18 sin(π i/15)`, gold cone caps; front ramp stair; gold star (≈ 36) | dominant silhouette |

The tech campus special (supercomputer) is **not** a signature. It is a formal grammar recipe at tier A: `oct` footprint (`cyl8`, curtain) + 3 halo rings + the existing dish.

Expected on lumina: 3 campus + 10–13 city signatures, plus the plaza isles.

### 9.3 `chooseSignatureSites(ctx)` (flow0, after `chooseLandmarkSites`)

1. **Landmark anchors** for spacing, the height cap and coverage, with estimated heights `LM_EST_H`: spire (0,0) 238; landmark lots (ferris 41, clocktower 49, unfinished 86); campus `d.core` 45; park `d.core` 34; harbor seed 33.
2. **Candidates per recipe:** `where ∧ filter ∧ !lot.landmark ∧ !(interior unless recipe needs it) ∧ dist(anchor) ≥ 70`. `score = site(F) · Σ affinity_s · w_s(lot) · sizeFit`, normalised to [0, 1] within the recipe; keep the top 30.
3. **Vista-yield (P3).** The viewer is at `front + axisDir · axis`, looking back at the lot. If any anchor within 600 m lies within ±6° of that view direction beyond the lot, `tall` recipes take score × .5 and `hMax = blockMedianFloors + 1` floors.
4. **Height cap:** `hMax = min(recipe.hMax, .7 · min LM_EST_H of anchors within 250 m)`. Builders scale tiers to fit.
5. **Greedy pass:** sort all (lot, recipe) pairs with score ≥ .25 by `score · (.85 + .3u)` (u from `ctx.rng.fork('arch-sig')`). Accept if:
   - the recipe is unused (mill ≤ 2);
   - spacing ≥ 110 m to other signatures and ≥ 70 m to anchors;
   - district quotas hold: commercial 2 each, residential 2 each, ruins 2, harbor 1, park 1, each academy outer band 1, center 0 (the isles are separate);
   - the total stays ≤ `round(14 · wow)`.
6. **Coverage fill (P3).** Sample `roadFlow` cells in the top 20 % at 8 m stride. While more than 20 % of samples are > 170 m from any signature or anchor, and the city count is < 16: take the farthest sample, and pick the best unused recipe and candidate within 90 m of it with score ≥ .15, at spacing ≥ 90 m.
7. **Record** `lot.signature = id` and `lot.sig = {score, parts: {V, N, F, X, W, …}, rank, hMax, face, axis}`. Program unique counts include signature programs.
8. **Log** `arch.signature: 시그니처 n (도시 c + 캠퍼스 3) — 천등 바자르탑@흐름 1위 …`.

`why` example: `"비스타 축선 132m 종결 · 흐름 61% · 등롱 바자르 영향 0.88 → 도시 13개 중 2위 (0.84)"`.

---

## 10. Integration with existing stages

- **`city.js genCityBuildings`.** With arch on it is two-pass; with arch off it is unchanged, single-pass.
  - Pass 1 per lot: features (reuse `lot.F`), zoning pick, footprint, floors. This consumes `lot.rng` exactly as today.
  - Pass 2 builds:
    - signature lots → `buildSignature`;
    - frame and floor clamp applied;
    - otherwise `makeBuilding` with `spec.arch` from `lot.arch`.

  The landmark mall uses `arch: {…, tier: 'A', crownLock: 'flat'}`.
- **`campus.js`.**
  - `FACTION_STYLE = {trad_academy: 'lumiere', tech_academy: 'arche', free_academy: 'redline', arts_academy: 'stella'}`.
  - Every `makeBuilding` call gets `arch: {s1: style, t: 0, purity: 1, formal: true, tier}`.
  - Main building: `tier 'A'`, **`crownLock: 'flat'`**, `roof: 'school'`, no stackJitter. Style shows through windows and trim, pinnacles (lumiere), lightstrip (arche), buttresses (lumiere wings). `placeClimbables` therefore keeps working unchanged.
  - Wings, club, cafeteria, dorm, gym: crowns follow the style.
  - Oldschool: `decay: true, ghost: style`.
  - `special` → `buildCampusSignature` for trad, free and arts, and the formal recipe for tech. The `it.dome` sphere and chapelspire additions are skipped when arch is on.
- **`rail.js` clearance.**
  - Gaado conversion passes `arch: {...b.arch, tier: 'D', crownLock: 'flat'}`.
  - Buildings with `b.signature` that are hit are rebuilt as gaado as today, their minor landmark is marked `deleted`, and `arch.signature` logs a demotion. Gate: ≤ 1.
  - No planRail split.
- **`intent.js placeRooftopRoutes`.**
  - If the main roof is `pitched` or `walk === false`, substitute the building's largest roof with `!pitched && walk !== false && w·d ≥ 45` (e.g. a taper terrace). This keeps one node per building.
  - After the jump and plank edges, add `ctx.skybridges` as pre-connected `bridge` edges (no plank).
  - The entry of a component is the roof with `entry: true` (redline scaffold) when present. In that case no ladder is spawned and the log reports it.
- **`intent.js placeClimbables`.** Add a loop over `ctx.climbSites`: a ladder on `face`, a vantage at `top`, and a `view` secret when `top > 15`.
- **`intent.js placeSignposts`.**
  - Targets filter `!l.global && !l.minor && !l.deleted`.
  - Add a 3rd plate (colour #b05cd8) for the nearest minor landmark within 220 m, e.g. `→ 천등 바자르탑 140m`.
- **`metrics.js`.** `landmarkVisible` skips `minor` and `deleted`. It then calls `archMetrics(ctx)` when arch is on.
- **`collision.js`, `analysis.rasterSolids`, `props.buildOccupancy`, headless PNG** all use `footprintOf(e)`:
  - **round:** cyl, sphere, cone, torus, oct, dome, onion, frus, cyl8;
  - **OBB:** box, gable, ramp, pyr, hip, mansard, vault;
  - **`arch`:** always `solid:false`; collision is carried by pier boxes.

  This also fixes the existing drift where `rasterSolids` did not treat torus and oct as round.

---

## 11. Renderer, UI, export

### 11.1 Geometries (`world.js makeGeometries`)

All use the unit convention: base at y = 0, footprint [−.5, .5]², scaled (w, h, d). `entityMatrix` is unchanged.

| key | construction |
|---|---|
| `dome` | `SphereGeometry(.5, 16, 6, 0, 2π, 0, π/2).scale(1, 2, 1)` |
| `onion` | `LatheGeometry` with points (r, y) (.36, 0)(.46, .12)(.5, .3)(.42, .5)(.22, .7)(.08, .86)(.001, 1), 12 segments |
| `frus` | `baseGeo(CylinderGeometry(.32, .5, 1, 12))` |
| `cyl8` | `baseGeo(CylinderGeometry(R, R, 1, 8).rotateY(π/8))`, R = .5/cos(π/8) (faces axis-aligned at ±.5) |
| `pyr` / `hip` / `mansard` | `frus4(k)` = `baseGeo(CylinderGeometry(k·.5√2, .5√2, 1, 4).rotateY(π/4))`, with k = 0 / .2 / .7 (unit-square base) |
| `vault` | `CylinderGeometry(.5, .5, 1, 12, 1, false, 0, π).rotateZ(π/2).scale(1, 2, 1)`, with axis along local x and rise 1 |
| `arch` | Shape (−.5, 0)→(−.3, 0)→(−.3, .55)→arc(0, .55, r .3, π→0)→(.3, 0)→(.5, 0)→(.5, 1)→(−.5, 1), Extrude depth 1, curveSegments 8, translate z −.5 |

`gear` and `star` are not added.

### 11.2 Facade shader (instance attributes, no extra draw calls)

**Buckets.** In `buildWorldMeshes`, buckets with mat `bld` or `bldR` do `geo = geos[shape].clone()` and add three `InstancedBufferAttribute(Float32Array(n·4), 4)`:
- `aFac = (win, fh, bay, flags)`, default (0, 3.2, 2.6, 0);
- `aTrim = (rgb, lit)`, default 0;
- `aBand = (rgb, faceMask)`, default 0.

**Materials.** `mats.bldR` is the same material with `defines: {ROUND: ''}` and `customProgramCacheKey` `'bld-round'`. Only grammar-produced entities use `mat 'bldR'`, so the lighthouse stays legacy.

**Vertex shader.** Add `vSc = sc; vY0 = instanceMatrix[3].y`, and pass through `vFac`, `vTrim`, `vBand`.

**Fragment shader**, in the `color_fragment` replacement, for wall normals only:
- `along`: in `ROUND` mode `atan(vLocal.z, vLocal.x)·.5·vSc.x`; otherwise the existing expression.
- **Pattern 0 (legacy, byte-identical):** uses `vLocal.y/3.2` and `along/2.6`.
- **Patterns ≥ 1:** compute `gy = vLocal.y + vY0`, `fy = fract(gy/fh)`, `fi = floor(gy/fh)`, `fx = fract(along/bay + .5)`, `ci = floor(along/bay + .5)`. Using `vY0` keeps window rows aligned across stacked tiers.

| id | pattern | `win` mask | glass tint |
|---|---|---|---|
| 1 | lancet | `step(.16, fy)·step(fy, .66)·step(\|fx − .5\|, .16)` + tip `step(.66, fy)·step(\|fx − .5\|·bay + (fy − .66)·fh·.8, .16·bay)` | (.62, .55, .85) |
| 2 | ribbon | `step(.40, fy)·step(fy, .82)·step(.05, fract(along/1.5))` | (.55, .68, .9) |
| 3 | porthole | `step(length(vec2((fx − .5)·bay, (fy − .58)·fh)), .32·min(bay, fh))` | (.45, .55, .7) |
| 4 | lattice | grid(.30–.84, .12–.88) × (1 − .7·bars(.45 m)) | (.55, .45, .35) |
| 5 | sparse / boarded | grid × `step(.45, hash(ci, fi))`; boarded where `hash < .18`, coloured wood #6b5a4a | (.4, .42, .48) |
| 6 | curtain | `step(\|fx − .5\|, .47)·step(.06, fy)·step(fy, .96)` | (.5, .7, .85) |
| 7 | round-arch | body (.22–.62, \|fx − .5\| < .2) ∪ arc `step(.62, fy)·step(length(vec2((fx − .5)·bay, (fy − .62)·fh)), .2·bay)` | (.6, .6, .8) |

Then:
- **Flags:** bit 1 plinth (`gy < .6` → ×.82); bit 2 cornice (`vLocal.y > vSc.y − .45` → trim); bit 4 string course (`fy < .07 && mod(fi, 2) == 0` → trim).
- **Use band:** `fidx` comes from `vNrm` (0 u−, 1 u+, 2 v−, 3 v+; for ROUND, any bit set). If `(mask >> fidx) & 1` and `vLocal.y < min(3.4, fh)`, paint the band colour with storefront glass (`.15 < fx < .85`, `.25 < y/3.4 < .85`).
- **Emissive:** declare `float gWin` at main scope. After `#include <emissivemap_fragment>` add `totalEmissiveRadiance += litCol(ws)·gWin·vTrim.a·.55`. `litCol`: lattice warm (1, .62, .3); ribbon and curtain (.45, .6, 1); round-arch (1, .6, .9); default (1, .8, .5).

### 11.3 Colour modes and highlight

Generalise `highlightRule` into `applyColors(ctx, world, {mode: 'style' | 'use' | 'tier', pred})`:
- `use`: entities with `ref` and `cat building` get `PROGRAMS[b.prog].color`;
- `tier`: base #d9d9d9, accent #ffb000, signature #ff2d8a, landmark #e0213b;
- `pred`: entities not matching it are greyed, as today.

The 레이어 panel gets a "건물 색: 양식 / 용도 / 위계" toggle.

### 11.4 Inspector (`main.js select`)

When `e.ref` names a building with `b.arch`, add a **건축** section:
- a style chip with 4 swatches, plus the s2 chip and a `t` bar (e.g. "장미 고딕 71 % | 지붕 마을 29 %");
- a tier badge, the dialect and the block gene layers (with the mutated layer marked "변이");
- borrowing per slot, e.g. "왕관 ← 장미 고딕 · 경계 18m · 소프트 엣지 · 임계 0.42", or "간선/하천이 경계 → 차용 안 함";
- faction influence for the top 2 factions with geodesic distance;
- `b.grammar` chips.

For signatures, also show the site-type score bars, rank, frame neighbour count and vista-yield status.

Buttons: [같은 양식 강조] [이 위계만 강조] [시선축 보기] (pink line along `axisDir`), plus the existing ones.

### 11.5 Other UI

- **Overlay:** `paintOverlay(ctx, 'arch')` paints lot OBBs in style colour at 45 % alpha, hatches borrowed lots in the s2 colour, and paints roads with the faction accent where `max inf ≥ .25` (alpha ∝ inf), so the tendrils are visible. It also marks gateways and draws 170 m signature reach rings. Add the button `<button data-overlay="arch">건축 양식</button>`.
- **Rule group:** `groups.arch = '건축 · 양식과 위계'`.
- **Labels:** minor landmarks get `cls 'sig'`, pri 1.5, maxDist 520.
- **POI type:** `poiTypeKo('sig') = '시그니처'`.
- **Generate bar:** a "건축: 판타지 / 레거시" select sets `params.arch`.

### 11.6 RULES (`config.js`, `layer: 'arch'`)

| rule | 이름 | desc |
|---|---|---|
| `arch.style` | 양식 어휘 | 구역마다 300m 밖에서도 읽히는 지붕 실루엣 가족 하나 |
| `arch.dialect` | 방언 | 같은 유형 구역 둘은 맥락으로 갈린다 (중심 가까움=네온, 물가=테라스) |
| `arch.field` | 세력 양식장 | 학원 정문에서 도로망을 따라 양식이 번진다 — 진입대로가 세력의 거리 |
| `arch.block` | 블록 유전자 | 블록은 한 가족, 필지는 한 층만 변이 |
| `arch.borrow` | 경계 차용 | 소프트 경계에서 색→창→지붕→몸체 순으로 차용. 간선·하천 경계는 차용 없음 |
| `arch.grammar` | 구성 문법 | 발자국·층군 연산·왕관·부착물 |
| `arch.tier` | 위계·예산 | 랜드마크 › 시그니처 › 악센트 › 바탕 |
| `arch.corner` | 모서리 경첩 | 간선 교차점마다 표지 건물 |
| `arch.terminus` | 비스타 종결 | 직선가로 끝은 탑 파사드로 닫는다 |
| `arch.rival` | 대치 요새화 | 라이벌 경계는 섞이지 않고 흉벽과 깃발 |
| `arch.frame` | 시그니처 무대 | 주변은 시그니처보다 2층 낮게 |
| `arch.arcade` | 가로 회랑 | 블록면 전체에 이어지는 아치 회랑 |
| `arch.signature` | 시그니처 건축 | 구조적 이유가 있는 자리에만 서는 판타지 건물 |
| `arch.gateway` | 경계 관문 | 우호 경계를 넘는 간선의 문, 좌우 기둥은 각자의 양식 |
| `arch.skybridge` | 구름다리 | 같은 양식 건물을 잇는 옥상 높이 다리 (옥상 루트 간선) |
| `micro.canopy` | 골목 캐노피 | 골목 머리 위 양식별 등롱줄·빛 배관 (빨래줄 일반화) |
| `arch.ley` (P6) | 레이 상감 | 광장에서 학원 정문까지 진입대로를 따라 빛나는 상감선 |

### 11.7 Export (`export.js`)

- Schema `academy-city/2`.
- Entities gain `fac, trim, lit, band, bandMask, sig, ref2`.
- New `buildings[]`: `{id, prog, label, district, tier, style: {s1, s2, t, slots, decay}, footprint, ops, crown, win, signature, accent, ents}`.
- The schema notes list the 9 new shapes. Engine importers map `kind + crown` to mesh sets.

---

## 12. Metrics (`archmetrics.js`; printed by headless as `arch:`)

1. **Entropy and silhouettes:**
   - `archEntropy`: Shannon bits over `${b.footprint}|${b.crown}|${b.win}` for non-deleted buildings;
   - `silhouetteKinds`: distinct crowns;
   - `crownKindsMin`: minimum over districts with ≥ 40 buildings;
   - `nonFlatCrownShare`.
2. **Coherence:**
   - `styleSalt`: share of C-tier buildings whose `s1` differs from all same-block neighbours (OBB gap < 6 m) while those neighbours agree;
   - `blockCoherence`: share of adjacent same-block pairs with the same `s1`, among pairs with both `t < .1`;
   - `bandMix`: the same ratio for pairs with both `t ≥ .3` (report only);
   - `borrowRate`: lots with any borrowed slot / non-interior lots;
   - `hardBorrow`: borrowed lots with `F.hard`;
   - `archDistinct`: minimum CIE76 ΔE over adjacent district pairs of (.6·mean wall Lab + .4·mean roof Lab).
3. **Tendrils:** `tendril[f]` = mean `w_f` on lots fronting f's approach line within 150 m of the gate ÷ mean `w_f` on non-approach lots in the same Euclidean distance band.
4. **Signatures:**
   - `signatures`, `sigCity`, `sigMinSpacing`;
   - `sigCoverage`: share of districts with ≥ 60 lots that have ≥ 1 city signature;
   - `sigRailDemoted`;
   - `sigNear`: share of 900 main-flow samples within 170 m of an S building;
   - `sigReach`: line of sight to an S top (.7h) within 180 m;
   - `archWow`: S or landmark, the P3 definition; legacy is .878;
   - `accentGap`: share of samples within 60 m of an S or A building centre;
   - `sigHeightViolations`: S taller than .7 × the nearest landmark within 250 m.
5. **Rooftop:** `rooftopEligible` (roofs passing the route filter after substitution), `rooftopRoutes`, `skybridges`, `skybridgeRouteEdges`, `naturalEntries`.
6. **Lint:**
   - `glowLint`: `arch.*`, `micro.canopy` and gateway glow entities with `max(w, h, d) < 2.5` and HSV S ≥ .35 whose hue is within 15° of {30, 33, 46, 48, 50, 150, 175, 186, 193, 194, 267, 330, 345};
   - `floaterReach`: for isles and scar, consecutive gap and rise from geometry;
   - `deckMerges`: cells where two elevated solids of the same signature are non-contiguous (> 2 m gap) and get merged by the single deck layer.
7. **Perf:** `buckets` via `bucketKey`; `archEnts` (building + roof + facade); entities; stage timings; `acMax` per building.

---

## 13. Tooling and phases

**`tools/headless.mjs`:**
- `--param k=v` (repeatable) → `generateSync(seed, cb, params)`;
- `--style` paints lots by style colour;
- round shapes are drawn as discs;
- prints `arch:` with tier counts, style counts, crown histogram, the signature list (name@district score), gateways and skybridges.

**`tools/arch-check.mjs <seeds…> [--baseline] [--legacy]`:**
- `--baseline` must be run **before any generator edit**. It writes `tools/baseline/<seed>.json` with the legacy metrics, stage timings, bucket count, and the SHA-1 of the entity list (fields `shape kind cat x y z w h d rot rx rz color solid rule`, rounded to 1e-3).
- Normal runs generate with `arch=0` (parity) and `arch=1`, evaluate the gates in the acceptance list, print a JSON table, and exit non-zero on failure.

**Phases** (each is gated by `arch-check` on `lumina kivotos academy-7`):

- **P0 Tooling:** `--param`, `render-keys.js`, `arch-check --baseline`.
- **P1 Renderer and collision base:** 9 geometries, facade attributes, `bldR`, `applyColors`, `footprintOf` everywhere. Gate: legacy SHA unchanged, and a browser map.png diff ≤ 0.5 % against `review/before/map.png` (arch=0).
- **P2 Field and vocabulary:** `archstyles.js`, dialects, features, faction field, lot styles, block genes, rows, overlay, inspector style chip. Buildings get palette, windows, trim and use band, but massing stays legacy (grammar off via `params.archGrammar=0`). Gates: coherence, tendrils, hardBorrow = 0, archDistinct.
- **P3 Grammar:** footprints, ops, crowns, attachments, decay, tiers and budget, decorate caps, rooftop substitution, scaffold steps, canopy, graffiti field. Gates: entropy, silhouettes, rooftop, budgets, perf.
- **P4 Urban relations:** accents (hinge, terminus, rowhead), frame, fortification, row arcade, gateways, skybridges. Gates: accents, gateways, skybridges, explore tests.
- **P5 Signatures:** catalogue, site selection, coverage fill, vista-yield, campus recipes, plaza isles, climb sites, signposts, labels, inspector signature panel, export, DESIGN.md. Gates: signature counts, reach, visibility.
- **P6 (optional, `params.ley = 1`) ley inlay.**
  - One extra Dijkstra from the plaza (road cells within 70 m of the origin) gives paths to each academy gate and to the ruins seed.
  - Each path is drawn as a `'line'` ground decal (width 1.2 m, glow colour α .55).
  - Pylons go every 48 m on sidewalk cells ≤ 6 m off the path: `frus` + glow oct + torus, 3 entities.
  - The ruins line stops at 60 %, followed by 2 toppled pylons (rz 1.2). `gravity_scar` gets +.3 site score within 60 m of the break.
  - Crystal oct finials go only on S and A buildings within 6 m of a line.
  - It is enabled by default only if P5 gates still pass with it on.

---

## 14. Performance budget (lumina; gates in acceptance)

| item | now | budget |
|---|---|---|
| flow0 | ~120–165 ms | ≤ 320 ms (features 25 + faction Dijkstra 30 + styles/genes 10 + signatures/accents 25) |
| buildings | 42 ms | ≤ 350 ms |
| campus, props, analysis, intent | 189 / 31 / 585 / 341 ms | +20 / +40 / +60 / +30 ms |
| total (Node) | 3.0 s | ≤ min(6.0 s, 1.3 × legacy total measured in the same run) |
| entities | 12 722 | ≤ 22 000 (expected about 17 k: −317 AC, +~4.2 k building/roof/facade, +~600 arcade/gateway/canopy/isles) |
| building + roof + facade | 4 237 | ≤ 9 500 (`archBudget.cap`) |
| draw buckets | 47 | ≤ 100 (expected about 80) |
| browser | – | ≤ 5 cloned bld/bldR geometries; shader branches are uniform per instance; no external assets; single-file build unchanged |

## Acceptance (as specified by the track)
- P0 ordering: `node tools/arch-check.mjs --baseline lumina kivotos academy-7` is run before any generator edit and writes tools/baseline/<seed>.json (legacy metrics, timings, bucket count, entity SHA-1).
- Legacy parity: with `--param arch=0`, each seed's entity SHA-1 equals the baseline (lumina: exactly 12722 entities). With arch=0, the browser map.png diff against review/before/map.png is ≤ 0.5 % of pixels.
- Performance (arch=1): total Node generation ≤ min(6.0 s, 1.3 × the arch=0 total measured in the same run). `buildings` stage ≤ 350 ms and `flow0` ≤ 320 ms on lumina.
- Budgets: entities ≤ 22000; building+roof+facade entities ≤ 9500; draw buckets (bucketKey) ≤ 100; no building has more than 2 AC units; tier part maxima hold (S ≤ 60, A ≤ 14, C ≤ 6, D ≤ 2 arch parts).
- Variety: archEntropy ≥ 3.5 bits (baseline 0.95); silhouetteKinds ≥ 14; every district with ≥ 40 buildings has ≥ 3 crown kinds; nonFlatCrownShare between 0.25 and 0.50.
- Coherence: styleSalt ≤ 0.05; blockCoherence (pairs with t < 0.1) ≥ 0.85; borrowRate between 0.04 and 0.20; hardBorrow == 0 (no borrowing across MAIN/COAST roads or the river); archDistinct (min ΔE between adjacent districts) ≥ 12.
- Dialects on lumina: commercial #5 at (-92,-145) resolves to neon and commercial #7 at (189,251) to lantern. The two residential districts resolve to different dialects (cottage vs terrace) and are named in the district panel.
- Road-propagated faction field: for each academy, the tendril ratio (mean faction weight on approach-avenue lots within 150 m of the gate ÷ non-approach lots at the same Euclidean distance) is ≥ 2.0.
- Signatures: lumina has ≥ 12 (3 campus + ≥ 9 city) and kivotos/academy-7 have ≥ 10; no recipe is used twice (water_mill ≤ 2); minimum spacing ≥ 90 m; sigCoverage = 1.0 on lumina (every district with ≥ 60 lots has a city signature); sigRailDemoted ≤ 1; sigHeightViolations == 0.
- Every signature has a type-'sig' tier-1 POI and a `why` that cites its site scores (vista/flow/node/water/border) and style influence. Signatures ≥ 18 m tall are registered as minor landmarks, and signposts show a third plate pointing to one within 220 m.
- Encounter rate on 900 main-flow samples: sigNear ≥ 0.80 (an S building within 170 m), sigReach ≥ 0.50 (line of sight to an S top within 180 m), accentGap ≥ 0.85 (an S or A building within 60 m). archWow ≥ the legacy 0.878.
- No visibility regression: landmarkVisible and spireVisible each ≥ their arch=0 value − 0.02 (minor landmarks excluded from the metric).
- Rooftop gameplay survives pitched crowns: rooftopRoutes ≥ 6 on lumina and ≥ max(5, legacy − 1) on the other seeds; rooftopEligible ≥ 0.9 × the legacy eligible count (lumina legacy 428); ≥ 4 skybridges and ≥ 1 used as a route edge; ≥ 1 redline natural entry (`entry` roof) logged.
- Other intent invariants: deadEndCoverage == 1.0; poiCoverage ≥ 0.99; secrets ≥ legacy − 5; key/gate pairs ≥ legacy − 1; graffiti count within ±35 % of legacy (212 on lumina).
- Urban relations: accents between 50 and 130 (hinge, terminus and rowhead all > 0); no frame lot taller than signature floors − 2 and no rooftop billboard inside a frame; gateways between 6 and 10 on lumina, none on rival pairs, every pier on a SIDEWALK cell; rival checkpoints unchanged (2 on lumina); ≥ 1 fortified lot on each rival border with a lot within 40 m.
- Glow lint: glowLint == 0 (no architectural glow part under 2.5 m with saturation ≥ 0.35 within 15° of a gameplay pin hue).
- Floater safety (static check on the collision heightfield): for sky_isles, consecutive island gap ≤ 3.0 m and rise ≤ 1.6 m, all XZ-disjoint; for gravity_scar, consecutive debris touch (gap ≤ 0.3 m) with rise ≤ 3.2 m; deckMerges == 0 for both; arch shapes are never solid; no ramp crown sits on an elevated (pilotis/float) body.
- Explore regression: `node tools/test-explore.mjs` passes every existing check (ladder, roof landing, key→gate, secret pickup, mantle) plus new checks: the player walks under a pilotis body and through a row arcade at ground level, and a campus main-roof ladder still reaches the fence vantage.
- Browser smoke: `node tools/shot.mjs` reports no console errors with arch=1. Screenshots saved to review/after/ (map, close-ups of commercial north/south, trad_academy, ruins, harbor, residential, center, plus the '건축 양식' overlay and the 위계 colour mode) show distinct roofscapes per district (spires, pagoda eaves, onion domes, vaults/sawtooth, container stacks, mushroom caps), at least 8 identifiable signature silhouettes, the floating isles around the spire, and no z-fighting or floating debris outside signatures.
- Inspector: clicking any ordinary building shows its style chip with swatches, the s2 share bar, tier badge, block-gene layers (with the mutated layer marked), borrowing reason (soft or hard edge, distance, threshold), faction influence with geodesic distance, and grammar trace chips. Clicking a signature also shows site score bars, rank and vista-yield status, and [시선축 보기] draws its axis.
- Export: `node tools/headless.mjs lumina --json out.json` writes schema 'academy-city/2' with a buildings[] array (style, tier, footprint, crown, win, signature) and entity fields fac/trim/band/bandMask. The `arch:` summary prints tier counts, the crown histogram and the signature list.
