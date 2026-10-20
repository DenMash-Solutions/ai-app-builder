# Derived Strings & The `$template` JS Anti-Pattern

## The trap

`{"$template": "…/${$index + 1}.png"}` LOOKS like string interpolation to any
LLM (and to humans) — but `$template` only interpolates `${/state/paths}`
(JSON Pointers). Anything else (`${$index + 1}`, `${$item.name}`) resolves to
**"" silently** — a URL like `…/pokemon/.png` that 404s with no error anywhere
(core design: missing path = ""; a directive may never throw).

## Evidence (Pokédex steer test, 2026-10-19)

| Run | Model | Outcome |
| --- | ----- | ------- |
| fresh gen ×2 | Gemini 3.1 Flash Lite | JS form `${$index + 1}` → empty → broken images |
| fresh gen | Gemini 3.5 Flash Lite | dodged the anti-pattern by omitting the Image `src` entirely |
| steer (plain language) | Gemini 3.5 Flash Lite | one revision → correct spec, all 20 sprites → 200 |

The runtime had the right tools all along (`appDirectives` = standard +
custom); no fresh gen reached them. The steer that fixed it never mentioned
syntax — it stated the DATA relationship ("the number is the Pokemon's
position in the list, starting at 1") and the model emitted:

```json
{"$concat": ["https://…/pokemon/", {"$math": "add", "a": {"$index": true}, "b": 1}, ".png"]}
```

## Rule

- Derived strings (URLs, labels built from item fields / index / state) are
  `{"$concat": [...]}` — its parts MAY be expressions (`$item`, `$index`,
  `$math`, `$state`).
- `$template` = `${/state/paths}` ONLY; missing path = "" (cannot be made to
  throw).
- The recipe line in `lib/playground/styling-rules.ts` teaches both — keep it
  when editing the prompt.

## Triage

- A prop renders empty or a URL has a gap (`…//…`) → first suspect JS inside
  `$template`; read the STORED spec (localStorage `genui-playground-history`)
  before blaming the model.
- "Model won't do X" after ONE attempt → check whether the prompt teaches the
  composition; the steer experiment shows models one-shot it once the data
  relationship is stated.
- Fixing via steer in the UI: describe the relationship in plain language,
  never the syntax.

## Memory triggers

- Image/URL prop renders with a gap → `$template` JS anti-pattern
- About to conclude "model adherence gap" → grep the recipe for the pattern
  first (one attempt is not evidence)
