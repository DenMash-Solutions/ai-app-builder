---
name: json-render
description: Generative UI framework — AI generates JSON specs constrained to a catalog, rendered natively. Use when working with @json-render/core or @json-render/react, defining schemas, catalogs, specs, registries, data-binding, computed values, visibility, watchers, validation, directives, streaming, or generation modes.
---

# json-render

Framework for **Generative UI**: AI generates the interface (components, layout, bindings, actions) as JSON. You constrain what AI can use via a **catalog**, map it to real components via a **registry**, and render natively — no arbitrary code execution.

Source material: same directory `*.md` (fetched as `https://json-render.dev/docs/<slug>.md`). Note: there is no `/docs/rendering.md` or `/docs/core.md` page — Core maps to `api-core.md` (`@json-render/core`), Rendering is covered by `registry.md` + `renderers.md`.

## Mental model

- **Schema** (`schemas.md`): grammar — JSON structure of specs. `schema` import comes from platform package (`@json-render/react`, `@json-render/react-native`). Core is schema-agnostic.
- **Catalog** (`catalog.md`): vocabulary — components, actions, functions AI may use. Built with `defineCatalog(schema, {...})` from `@json-render/core`.
- **Spec** (`specs.md`): JSON document AI outputs. React schema = flat tree: `{ root, elements }`.
- **Registry** (`registry.md`): implementation — `defineRegistry(catalog, { components, actions })` maps catalog types to real components + action handlers.
- **Renderer** (`registry.md`, `renderers.md`): `<Renderer spec registry />` inside providers turns spec into native output.

Workflow: `defineCatalog` → `catalog.prompt()` as system prompt → AI outputs spec / JSONL patches → `Renderer` + providers renders, streams update progressively.

## Schemas

Built-in React schema is flat `root` + `elements` map (optimized for AI generation + streaming):

```json
{
  "root": "card-1",
  "elements": {
    "card-1": { "type": "Card", "props": { "title": "Dashboard" }, "children": ["text-1"] },
    "text-1": { "type": "Text", "props": { "content": { "$state": "/user/name" } }, "children": [] }
  }
}
```

Element shape: `{ type, props, children: string[], slots?: Record<string,string[]>, visible?, repeat?, watch?, on? }`. Use `children` for default slot, `slots` object for named slots.

Schema vs catalog: schema = structure/grammar, catalog = available components/vocabulary. Custom schemas supported via `@json-render/core` — see `schemas.md` + `custom-schema` docs.

## Catalog

From `@json-render/core`. `schema` import varies by platform only.

```typescript
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const catalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({
        title: z.string(),
        description: z.string().nullable(),
        padding: z.enum(["sm", "md", "lg"]).nullable(),
      }),
      slots: ["default"],
      description: "Container card for grouping content",
    },
    Metric: {
      props: z.object({
        label: z.string(),
        value: z.union([z.string(), z.number()]),
      }),
      description: "Display a single metric value",
    },
    Layout: {
      props: z.object({}),
      slots: ["default", "header", "footer"],
      description: "Layout with header/content/footer regions",
    },
  },
  actions: {
    submit_form: {
      params: z.object({ formId: z.string() }),
      description: "Submit a form",
    },
  },
  functions: {
    fullName: { description: "Combines first and last name" },
  },
});
```

Rules: use `.nullable()` for optional props. Always add `description` to guide AI. Use `"default"` for normal children; add named slots only for multi-region components.

Prompt generation:

```typescript
const systemPrompt = catalog.prompt();
const custom = catalog.prompt({
  customRules: ["Always use Card as root for forms"],
  mode: "inline", // or omit for standalone, see Generation Modes
});
```

## Specs

Validate with `validateSpec(spec)` from `@json-render/core`. Check `result.valid` / `result.issues`. Sources: AI generation, DB, API, static files.

React rendering shell:

```tsx
import { Renderer, StateProvider, VisibilityProvider, ActionProvider } from "@json-render/react";

<StateProvider initialState={state}>
  <VisibilityProvider>
    <ActionProvider handlers={handlers}>
      <Renderer spec={spec} registry={registry} />
    </ActionProvider>
  </VisibilityProvider>
</StateProvider>
```

Streaming hook: `const { spec, isStreaming, send, clear, error } = useUIStream({ api: "/api/generate" })`.

## Registry + Rendering

`defineRegistry` conditionally requires `actions` only when catalog declares them.

Component context:

```typescript
interface ComponentContext {
  props: T;
  children?: React.ReactNode; // default slot
  slots?: Record<string, React.ReactNode>; // named slots
  emit: (event: string) => void;
  on: (event: string) => EventHandle; // { emit, shouldPreventDefault, bound }
  loading?: boolean;
  bindings?: Record<string, string>; // paths from $bindState/$bindItem
}
```

Minimal registry:

```tsx
import { defineRegistry } from "@json-render/react";

const { registry, handlers, executeAction } = defineRegistry(catalog, {
  components: {
    Card: ({ props, children }) => <div><h2>{props.title}</h2>{children}</div>,
    Button: ({ props, emit }) => <button onClick={() => emit("press")}>{props.label}</button>,
    Layout: ({ children, slots }) => (
      <div><header>{slots?.header}</header><main>{children}</main><footer>{slots?.footer}</footer></div>
    ),
  },
  actions: {
    submit_form: async (params, setState) => {
      const res = await fetch("/api/submit", { method: "POST", body: JSON.stringify(params) });
      const result = await res.json();
      setState((prev) => ({ ...prev, formResult: result }));
    },
  },
});
```

Events: `emit("press")` for simple fire. Use `on("click")` when needing `shouldPreventDefault`:

```tsx
Link: ({ props, on }) => {
  const click = on("click");
  return <a href={props.href} onClick={(e) => { if (click.shouldPreventDefault) e.preventDefault(); click.emit(); }}>{props.label}</a>;
}
```

Spec binding: `"on": { "press": { "action": "submit_form", "params": {...} } }` or array for sequential actions.

Two-way inputs use `useBoundProp`:

```tsx
import { useBoundProp } from "@json-render/react";
TextInput: ({ props, bindings }) => {
  const [value, setValue] = useBoundProp<string>(props.value, bindings?.value);
  return <input value={value ?? ""} onChange={(e) => setValue(e.target.value)} />;
}
```

Never use a `statePath` prop for binding — use `{ "$bindState": "/path" }` on the natural value prop.

## Renderers

Same catalog/spec concept, different output (`renderers.md`):

React, Vue 3, Svelte 5, SolidJS, React Native, TanStack Start (full apps with routes/SSR), shadcn/ui (36 pre-built, uses React renderer), Image (SVG/PNG via Satori), React PDF, Remotion (video timelines), Ink (terminal). See `renderers.md` for per-platform snippet.

React supports full data-binding, visibility, actions, validation, repeat, streaming. Filtered-list `$item` on repeat container is React-only; other renderers evaluate container condition outside repeat scope.

## Data Binding

State paths are JSON Pointer RFC 6901: `/user/name`, `/todos/0/title`.

Expressions usable in any prop:

- `{ "$state": "/path" }` — one-way read
- `{ "$item": "field" }` / `{ "$item": "" }` — current repeat item field / whole item
- `{ "$index": true }` — current repeat index (0-based)
- `{ "$bindState": "/path" }` — two-way bind on natural value prop (`value`, `checked`, `pressed`)
- `{ "$bindItem": "field" }` — two-way bind to repeat item field
- `{ "$cond": <cond>, "$then": v, "$else": v }` — $then/$else may nest expressions
- `{ "$template": "Hi ${/user/name}" }` — interpolation, missing path = ""
- `{ "$computed": "fn", "args": {...} }` — registered function, args may be expressions

Repeat is top-level (sibling of type/props/children), not in props:

```json
{
  "type": "Column",
  "repeat": { "statePath": "/todos", "key": "id" },
  "children": ["todo-item"]
}
```

Nested list: `"repeat": { "statePath": { "$item": "comments" }, "key": "id" }`. Filtered list: put `$item` visible condition on the same container that declares `repeat`.

External store: `createStateStore(data)` + `<StateProvider store={store}>`. When `store` is set, `initialState`/`onStateChange` ignored.

## Computed Values

`$template` for strings, `$computed` for functions. Register function names in catalog `functions`, implement at runtime via `functions` prop on provider / `createRenderer`:

```tsx
<JSONUIProvider registry={registry} functions={{ fullName: (args) => `${args.first} ${args.last}` }}>
```

## Visibility

`visible` field on element. Forms:

```json
{ "$state": "/form/hasErrors" }
{ "$state": "/x", "not": true }
{ "$state": "/user/role", "eq": "admin" }
[{ "$state": "/a" }, { "$state": "/b" }]
{ "$or": [{ "$state": "/a" }, { "$state": "/b", "gt": 200 }] }
{ "$and": [...] }
true
false
```

Operators (one per condition, precedence `eq > neq > gt > gte > lt > lte`): `eq, neq, gt, gte, lt, lte`, plus `not: true` invert. Comparison RHS may be literal or `{ "$state": "/other" }`.

Repeat scope: `{ "$item": "isOverdue" }`, `{ "$item": "price", "gt": 100 }`, `{ "$index": true, "gt": 0 }`. `$item` on repeat container filters items.

Requires `<VisibilityProvider>`. Programmatic: `useIsVisible(condition)`. Helpers from `@json-render/core`: `visibility.when/unless/eq/and/or/always/never`.

## Watchers

Top-level `watch: { "<statePath>": action | action[] }`. Fires on value change only (reference `===`), never initial render. Params support `$state/$item/$index`.

```json
{
  "type": "Select",
  "props": { "value": { "$bindState": "/form/country" }, "options": ["US","Canada"] },
  "watch": { "/form/country": [
    { "action": "loadCities", "params": { "country": { "$state": "/form/country" } } },
    { "action": "setState", "params": { "statePath": "/form/city", "value": "" } }
  ]}
}
```

`on` = user interaction; `watch` = any state change (user, handler, external store).

Built-in actions (React, auto-injected in prompts): `setState`, `pushState`, `removeState`, `validateForm`:

```json
{ "action": "setState", "params": { "statePath": "/activeTab", "value": "home" } }
{ "action": "validateForm", "params": { "statePath": "/formResult" } }
```

## Validation

Prop-level `checks` + `validateOn: change|blur|submit`. Value under test is the `$bindState` path (`bindings?.value`).

```json
{
  "type": "TextField",
  "props": {
    "label": "Email",
    "value": { "$bindState": "/form/email" },
    "checks": [
      { "type": "required", "message": "Email is required" },
      { "type": "email", "message": "Invalid email" }
    ],
    "validateOn": "blur"
  }
}
```

Built-ins: `required, email, url, numeric, minLength {min}, maxLength {max}, min {min}, max {max}, pattern {pattern}, matches/equalTo {other:$state}, lessThan/greaterThan {other:$state}, requiredIf {field:$state}`.

Cross-field uses `$state` in args. Custom validators: declare in catalog `functions`, implement via `<ValidationProvider customFunctions={...}>`, consume via `useFieldValidation(boundPath, { checks, validateOn, enabled })`. Form-wide: `validateForm` action writes `{ valid, errors }` to state; gate submit manually.

## Directives

Custom `$`-prefixed dynamic values. Built-ins (`$state`, `$computed`, `$cond`, `$template`, etc.) always win; `defineDirective` throws on conflict.

```typescript
import { defineDirective, resolvePropValue } from "@json-render/core";
const doubleDirective = defineDirective({
  name: "$double",
  description: "Double a numeric value.",
  schema: z.object({ $double: z.unknown() }),
  resolve(value, ctx) {
    const resolved = resolvePropValue(value.$double, ctx);
    return resolved * 2;
  },
});
```

Runtime: `<JSONUIProvider directives={directives}>` (all of React/Vue/Svelte/Solid accept it). Prompt: `catalog.prompt({ directives })`. Pre-built: `@json-render/directives` `standardDirectives` (`$format`, `$math`, `$concat`, `$count`, `$truncate`, `$pluralize`, `$join`) + `createI18nDirective(config)`. Directives compose via nested `resolvePropValue`.

## Streaming

SpecStream = JSONL, one RFC 6902 patch per line (`add, remove, replace, move, copy, test`), paths are JSON Pointer into spec (`/root`, `/elements/card-1`, `/elements/card-1/props`).

Server: `streamText({ model, system: catalog.prompt(), prompt })` → `result.toTextStreamResponse()`.

Low-level: `createSpecStreamCompiler<Spec>()` → `compiler.push(chunk)` → `{ result, newPatches }`, `compiler.getResult()`; one-shot `compileSpecStream(jsonl)`.

React: `useUIStream({ api, onComplete, onError })` → `{ spec, isStreaming, error, send, clear }`. `send` aborts previous. Render `<Renderer spec registry loading={isStreaming} />`.

## Generation Modes

Same JSONL format, different envelope:

- **Standalone (default)**: AI outputs only JSONL. For builders, dashboards, forms, playgrounds. `catalog.prompt({ customRules })`.
- **Inline (`mode: "inline"`)**: AI writes prose + JSONL patches on own lines; text-only allowed when no UI needed. For chatbots/copilots. Server pipes via `pipeJsonRender(result.toUIMessageStream())` → `data-spec` parts; client extracts with `useJsonRenderMessage(message.parts)` → `{ spec }`.

## References

- `docs.md` — intro / Generative UI
- `specs.md`, `schemas.md`, `catalog.md`, `registry.md`, `renderers.md`
- `data-binding.md`, `computed-values.md`, `visibility.md`, `watchers.md`, `validation.md`, `directives.md`
- `streaming.md`, `generation-modes.md`, `api-core.md`
