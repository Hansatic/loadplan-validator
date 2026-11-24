# Submitting a model to the leaderboard

Anyone can add a model. You run it yourself; this repository re-judges every answer with `validate.mjs`, so the numbers on the board are computed from your placements, not reported by you.

## 1. Run the model

`data/r10/prompts.json` holds one `system` and one `user` message for each of the 26 runs. Send each pair to your model as is, one conversation per run, no examples, no retries chosen by score. Any temperature or reasoning setting is fine; say which in `settings`.

If you change the prompts in any way (extra instructions, a different format, tools, several attempts), set `"prompt": "modified"` and describe the change in `prompt_notes`. Modified entries are marked on the board.

## 2. Add a folder

Create `submissions/<your-model>/` (lowercase letters, digits, `.`, `_`, `-`), with two files.

`meta.json`:

```json
{
  "model": "Example Model 1.0",
  "submitted_by": "Your name or lab",
  "date": "2026-12-01",
  "prompt": "standard",
  "settings": "temperature 0, reasoning high",
  "link": "https://example.org/your-paper-or-model-card",
  "notes": "optional"
}
```

`model`, `submitted_by`, `date` (the day you ran it, `YYYY-MM-DD`) and `prompt` (`standard` or `modified`) are required. `prompt_notes` is required when `prompt` is `modified`. `link` and `notes` are optional.

`answers.json`, keyed by run (the `key` field in `prompts.json`):

```json
{
  "runs": {
    "H01-ldm": { "placements": [{ "id": "I01", "x": 0, "y": 0, "z": 0, "dx": 1200, "dy": 800, "dz": 1000 }] },
    "H02-ldm": null
  }
}
```

Use the `placements` from the model's JSON answer unchanged. Put `null` (or leave the run out) when the model gave no parseable answer; it counts as no answer. Do not repair or post-process placements: an answer that breaks a rule is scored as illegal, like every official entrant.

## 3. Check and open a pull request

```sh
node leaderboard.mjs     # prints your verdicts and rewrites the table in README.md
npm test                 # what CI runs
```

Commit your folder and the updated `README.md`, then open a pull request. CI fails if a file is malformed or if `README.md` does not match what `leaderboard.mjs` produces.

## What gets merged

- One folder per model version. A new run of the same model replaces the old folder.
- We may ask for the raw model outputs if a result looks out of line.
- The 20 cases are public, so a model can have seen them. Community rows say who ran them; official rounds are run by Hansatic.
- By submitting, you agree that your answers are published here under the repository licence.
