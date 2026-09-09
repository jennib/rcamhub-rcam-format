# rcam file format (`.rcam`)

This repository holds the public, open-source contract for the **rcam project
file format** — the `.rcam` files produced and consumed by the rcam CAD/CAM
application (https://rcamhub.com).

It contains the machine-readable JSON Schema, the authoring guide, the golden
example projects, and the dependency-free git merge driver. It does **not**
contain the rcam application, its loader, its constraint solver, or its CAM
engine — those remain closed.

## What is here

| Path | What it is | Published at |
|------|-----------|-------------|
| `schema/rcam-v3.schema.json` | JSON Schema (draft 2020-12) — the machine-readable contract; this URL is its `$id` | `https://rcamhub.com/schema/rcam-v3.schema.json` |
| `docs/rcam-format-v3.md` | the authoring guide and stability contract | `https://rcamhub.com/docs/rcam-format-v3.md` |
| `examples/*.rcam` | golden example projects, validated against the schema | `https://rcamhub.com/examples/<name>` |
| `examples/index.json` | generated index of the examples | `https://rcamhub.com/examples/index.json` |
| `llms.txt` / `llms-full.txt` | AI-facing index and single-fetch bundle | `https://rcamhub.com/llms.txt` |
| `rcam-merge.mjs` | dependency-free three-way git merge driver (run by `node`) | `https://rcamhub.com/rcam-merge.mjs` |

## License

The format itself — the JSON Schema, the authoring guide, the examples, and the
`llms*.txt` files — is released under **CC0-1.0** (see [`LICENSE`](LICENSE)): do
anything with it, no attribution required.

The code in this repository — [`rcam-merge.mjs`](rcam-merge.mjs) and
[`scripts/check.mjs`](scripts/check.mjs) — is released under the **MIT** license
(see [`LICENSE-MIT`](LICENSE-MIT)).

## How this repository is maintained

This is a **mirror**, not the source of truth. The format is authored in the
rcam application repository; on every passing CI run the schema, guide, and
examples are published here automatically. Changes are welcome as issues or
pull requests, but they are applied upstream and re-published — the canonical
authoring location is the rcam source repository. Full schema validation of the
examples runs in that repository before anything reaches here; run
`node scripts/check.mjs` locally to verify a published tree's structure.

## Authoring `.rcam` files

Start with the [authoring guide](docs/rcam-format-v3.md), validate against
`schema/rcam-v3.schema.json` with any JSON Schema (draft 2020-12) validator, and
model your file on the [examples](examples/).
