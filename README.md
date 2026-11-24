# Load-plan validator

The judge of the [Hansatic load-planning benchmark](https://hansatic.com/en/neuro-symbolic-load-planning). One file, `validate.mjs`, with no dependencies. Given a vehicle, a cargo manifest and a placement answer, it reports every rule the answer breaks. The benchmark uses this same function to judge every entrant: each language model and our own packing engine.

This repository also holds the r10 release: the 20 cases and every answer that was scored, so anyone can check the published verdicts.

**This is not a load-securing certificate.** It checks geometry and simple statics. It does not check lashing, friction, dunnage, road law or how a real crew would brace the load.

## Quick start

Node 18 or later, nothing to install.

```sh
node test/fixtures.mjs     # 36 synthetic fixtures, each built to trip one rule or none
node verify-r10.mjs        # re-judges all published r10 answers against their published verdicts
node bin/cli.mjs case.json answer.json   # judge one answer, prints the verdict as JSON
```

`npm test` runs the first two.

```js
import { validatePlan, summarize } from './validate.mjs';
const r = validatePlan({ vehicle, items, placements }); // support defaults to 0.95
r.legal          // no physics fault and no answer fault
r.legalDoctrine  // legal, and the floor layer follows loading practice
summarize(r)     // e.g. "floating=2 crush=1"
```

## The r10 data

- `data/r10/cases.json`: 20 cases (`vehicle` and `items`), 6 large and 12 regular real customer loads plus 2 practitioner-built cases (an air ULD and a pallet).
- `data/r10/answers.json`: 26 runs (a case under one objective). Each run lists every entrant's published `status`, `placed`, `ldm_mm`, `height_mm`, `pallets` and its `placements`. Entrants that returned no parseable answer have `placements: null`.

Customer names, references and plan ids are not part of the data.

## Input

| field | meaning |
|---|---|
| `vehicle` | `kind` (`container`, `truck`, `uld` or `pallet`), `length_mm`, `width_mm`, `height_mm`, `max_payload_kg`, `tare_kg`; optional `max_floor_load_kg_m2`. Trucks also have `kingpin_from_front_mm`, `bogie_from_front_mm`, `max_kingpin_kg`, `max_bogie_kg`. ULDs may have `wings: [{ side, overhang_mm, height_mm }]` and `chamfer: { side, inset_mm, start_height_mm }`. Pallets give `base_height_mm`, `max_build_height_mm` and `max_weight_kg`. |
| `items` | `{ id, l, w, h, kg, stackable, max_stack_kg, fragile, tiltable }` (mm, kg) |
| `placements` | `{ id, x, y, z, dx, dy, dz }` |

**Frame.** x runs from the front wall (x = 0) to the doors. y runs from the left wall, and z runs up from the deck. `(dx, dy, dz)` is the item's extent along x, y and z after it is oriented. It must be a permutation of `(l, w, h)` within 0.5 mm. Internally the checks run in a frame measured from the doors. Only two things care which end is which: the container centre-of-gravity percentage (measured from the doors) and the tip-over bracing (the front wall braces a load, the doors do not).

## Rules

Every number is a constant in `RULES`. Changing one changes the benchmark.

**Answer faults** (each makes the answer illegal):
- `unknownId`: the id is not in the manifest.
- `duplicateId`: the same id is placed twice.
- `badDims`: the dims are not a permutation, or not a number.
- `illegalTilt`: an item with `tiltable: false` is not upright.

**Physics** (each makes the answer illegal; every contact and overlap test allows 1 mm):
- `outOfBounds` / `overHeight`: the item is outside the cargo space.
- `overlap`: two items intersect in 3D.
- `floating`: an item above the deck rests less than 95% of its base on tops at exactly its z.
- `badBase`: something rests on a non-stackable item, or on a fragile item with no `max_stack_kg` above 0.
- `crush`: everything at or above an item's top that overlaps its footprint, at any height, weighs more than its `max_stack_kg`.
- `overPayload`: the placed weight is above `max_payload_kg`.
- `cog`: the centre of gravity is outside the band. The CoG is taken over placed cargo plus `tare_kg`, with the tare as a point mass at the floor centre. Across the width the band is 40–60%. For containers, the band along the length is 35–65% measured from the doors.
- `axle` (trucks): the total weight is split between kingpin and bogie as a beam on two supports, and either share is above its limit. Not checked when the total is within both limits.
- `cog` and `axle` are skipped for a light load: the whole manifest (placed or not) is under 15% of payload, under 25% of the cargo space, and has no item of 500 kg or more.
- `slenderPile`: an item standing on another item's top, together with the comparable items directly below it, is more than 5x as tall as its narrowest braced width. An item's braced width is the narrower side of the bounding box of its block: items at the same z that touch it side to side (gap at most 10 mm, faces overlapping), each at least half as tall as its neighbour, chained. Walls do not brace. A lone column's braced width is its own narrower side. The pile ends at the deck, or at an item whose narrower side is more than 1.5x wider. A pile that reaches the deck, and a single item on a proper base, are not limited.

**Loading practice** (`doctrine`, a separate verdict reported as `legalDoctrine`; only floor items count):
- `islands`: the floor load splits into more blocks than allowed, where a gap longer than 300 mm along x separates blocks. A truck allows 1 block, a container 2.
- `misalignedRuns`: floor items at least 85% of the width wide that share a footprint (10 mm buckets) do not line up at the same y (20 mm buckets).

**Advisory** (reported, never scored):
- `floorLoad`: kg/m² over a floor item's footprint, against `max_floor_load_kg_m2`.
- `notAnchored`: the floor block stands more than 150 mm from both end walls.
- `lateralGaps`: more than 3 gaps of 60 mm or more in one cross-section.
- `tipOver`: items of 1000 kg or more that would tip at 1.25x the limit under the design accelerations. Truck: 0.8 g forward, 0.5 g rear, 0.5 g side. Container: 0.8, 0.5, 0.8. Only items standing at an open edge of their block count.

**Metrics:** `placed`, `missing`, `ldm_mm` (frontmost to rearmost cargo face) and `height_mm`.

## Where the rules come from

These are the checks our production packer applies to its own layouts, ported into one file. We checked the port with a parity harness. It generated 369 random layouts over real manifests, half of them deliberately broken, and compared this file with the production checks: overlap, bounds, height, support, base, crush, payload, axle, CoG, the doctrine hard rules and the tip-over warning. They matched on every layout, 0 differences. The harness ran at the engine's own support share (60%); the benchmark runs at 95%.

Known limits, disclosed:
- **Open-top and flat-rack units are out of scope.** The app caps their load at `max_stack_height_mm` rather than the box height, so the validator would wrongly report over-height items on them. Air ULD contours (sloped sides, chamfered roofs) and pallet decks are in scope since 2.x.
- **Slender piles** were ported line for line but are not covered by the parity harness, because the production function is internal.
- **The engine's 300 mm window:** under the LDM objective our engine accepts up to 300 mm more length when that saves a pallet position. Scored on LDM alone, this can only cost the engine. We left it as it ships.
- **Tiltable by default:** the cases copy the app's default, so an item the customer never marked as upright has `tiltable: true`. The manifests state the flag explicitly for every item, so every entrant sees the same thing.
- **The pallet-position count** (the `pallets` objective) is not in this file. Every entrant is counted by the same closed counter, the one the app bills with. `verify-r10.mjs` reproduces legality and LDM; the published pallet counts can be inspected in `data/r10/answers.json` but not recomputed here.

## Licence

**PolyForm Noncommercial License 1.0.0.** Full text in [LICENSE.md](LICENSE.md). It covers everything in this repository: the validator, the CLI, the tests and the r10 data.

Copyright Hansatic (https://hansatic.com).

**Free, no need to ask:**

- Academic and non-profit research, including published papers and benchmarks
- Personal study, experiments and testing
- Use by universities, public research institutes, charities and government bodies

**Needs a commercial licence from Hansatic:**

- Use inside a company, including evaluating your own models or products
- Building it into a product, service, API or internal tool
- Selling, hosting or offering it as part of paid work

For a commercial licence, contact us via [hansatic.com](https://hansatic.com).

If you share a copy or a modified version, include LICENSE.md (or the licence URL) and the line `Required Notice: Copyright Hansatic (https://hansatic.com)`.

**Citing:** if you publish results judged with this validator, please name the validator version (`VERSION` in validate.mjs) and link this repository.
