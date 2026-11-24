---
license: other
license_name: polyform-noncommercial-1.0.0
license_link: https://github.com/Hansatic/loadplan-validator/blob/main/LICENSE.md
pretty_name: Hansatic LoadBench r10
language:
- en
size_categories:
- n<1K
task_categories:
- text-generation
tags:
- benchmark
- llm-evaluation
- 3d-bin-packing
- operations-research
- constraint-optimization
- cargo-loading
- physics-validation
- neuro-symbolic
configs:
- config_name: prompts
  default: true
  data_files: data/prompts.jsonl
- config_name: cases
  data_files: data/cases.jsonl
- config_name: answers
  data_files: data/answers.jsonl
---

# Hansatic LoadBench r10

Can a language model plan how cargo goes into a container, a truck, an air ULD or onto a pallet, so that the plan obeys physics and the way warehouses actually load?

LoadBench r10 is 20 real customer cases (26 scored runs) from the Hansatic load planner, the exact prompts every model received, and every answer that was scored: eight frontier language models and the Hansatic packing engine. Each answer is a list of box placements, judged by one open validator that checks geometry, support, stacking limits, weight and loading doctrine.

- **Validator and leaderboard:** [github.com/Hansatic/loadplan-validator](https://github.com/Hansatic/loadplan-validator) (validator {{VERSION}})
- **Write-up and paper:** [hansatic.com/en/neuro-symbolic-load-planning](https://hansatic.com/en/neuro-symbolic-load-planning)

## Configs

| Config | Rows | What a row is |
|---|---:|---|
| `prompts` | 26 | One run: the `system` and `user` message sent to every model, the case and the objective |
| `cases` | 20 | One case: vehicle (JSON string; its fields depend on `vehicle_kind`) and the item list |
| `answers` | 234 | One entrant's answer to one run: published status, items placed, loading metres, height, pallet positions, the validator's summary and the raw placements |

```python
from datasets import load_dataset
prompts = load_dataset("hansatic/loadbench-r10", "prompts", split="train")
answers = load_dataset("hansatic/loadbench-r10", "answers", split="train")
```

Units are millimetres and kilograms. A placement is `{id, x, y, z, dx, dy, dz}`: the item's corner and its extent along each axis, so the orientation is in `dx, dy, dz`.

**Objectives.** `ldm`: place every item, then the shortest load wins (loading metres). `pallets`: fewest pallet positions, then loading metres. `count`: most items placed. `interlock`: highest interlock share of a built pallet, then the lowest build. In every run an illegal answer loses to any legal one.

**Status.** `legal`, `illegal` (breaks at least one rule), `noAnswer` (no parseable placement list) or `error` (the provider failed). The pallet-position count comes from Hansatic's counter; everything else is reproducible with the open validator.

## Evaluate a new model

1. Send each row of `prompts` to the model as is, one conversation per run.
2. Judge the placements with `validate.mjs` from the GitHub repository.
3. To appear on the leaderboard, open a pull request there as described in its `CONTRIBUTING.md`. Every submission is re-judged in CI.

## Results

The current table, re-judged from these answers, is in the [repository README](https://github.com/Hansatic/loadplan-validator#leaderboard). On the 20 runs the open validator can rank on its own, the best model gives a legal answer on 19 and the engine on all 20; no model beats the engine on any of them.

## Licence

[PolyForm Noncommercial 1.0.0](https://github.com/Hansatic/loadplan-validator/blob/main/LICENSE.md). Research, teaching and personal use are free. Commercial use needs a licence from Hansatic: [hansatic.com](https://hansatic.com).

Required Notice: Copyright Hansatic (https://hansatic.com)

## Citing

Name the release (r10, {{DATE}}) and the validator version ({{VERSION}}), and link this dataset or the GitHub repository.
