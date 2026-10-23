import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import {
  dataMutateParamsSchema,
  dataReadParamsSchema,
  DATA_MUTATE_ACTION,
  DATA_READ_ACTION,
} from "@/lib/data-sources/types";
import { SWITCH_LANGUAGE_ACTION } from "@/lib/i18n/language-switcher";
import { PLAYGROUND_FUNCTIONS } from "@/lib/playground/computed-functions";
import { LUCIDE_ICON_NAMES } from "@/lib/playground/icons";
import { SWITCH_THEME_ACTION } from "@/lib/theme/spec-theme";

const STYLE_PROPS = {
  className: z
    .string()
    .nullable()
    .describe(
      'Extra CSS/Tailwind classes merged onto this element\'s root node (e.g. "w-full bg-blue-400 text-blue-950")',
    ),
  style: z
    .record(z.string(), z.union([z.string(), z.number()]))
    .nullable()
    .describe(
      'Inline React style object with camelCase CSS properties merged onto this element\'s root node — use when Tailwind classes are not enough (e.g. {"backgroundColor": "#60a5fa"})',
    ),
} as const;

type StyledDefinition<D> = D extends { props: infer P }
  ? Omit<D, "props"> & {
      props: P extends {
        extend: (shape: typeof STYLE_PROPS) => infer R;
      }
        ? R
        : P;
    }
  : D;

type StyledDefinitions = {
  [K in keyof typeof shadcnComponentDefinitions]: StyledDefinition<
    (typeof shadcnComponentDefinitions)[K]
  >;
};

// The model's icon vocabulary is a constrained enum (decision: docs/plan/
// catalog-icons) — the prompt shows the union inline, the editor's property
// form derives its Select from it, and the renderer resolves against the
// same map, so a name that parses always draws.
const iconDefinition = {
  props: z
    .object({
      name: z
        .enum(LUCIDE_ICON_NAMES)
        .describe("Lucide icon to draw (kebab-case, from the allowed list)"),
      size: z
        .number()
        .nullable()
        .optional()
        .describe("Icon edge length in px (default 16)"),
    })
    .extend(STYLE_PROPS),
  description:
    "Lucide vector icon (inline SVG). Color via className (e.g. text-muted-foreground); fires press when tapped — bind on.press to make it an icon button.",
  events: ["press"],
  example: { name: "sparkles" },
};

// Spec-driven theme (docs/plan/042-tool-rail-and-spec-theme): a light/dark
// toggle whose value IS the design's theme state. The switcher flips the
// bound /theme itself and emits change — the model's switch_theme binding
// hands it to the page, which persists the visitor's decision.
const themeSwitcherDefinition = {
  props: z
    .object({
      value: z
        .unknown()
        .nullable()
        .optional()
        .describe(
          'Theme state binding — use {"$bindState": "/theme"} (seed state.theme with "light" or "dark")',
        ),
    })
    .extend(STYLE_PROPS),
  description:
    'Light/dark theme toggle for the design (sun when dark, moon when light). Wire "value" to {"$bindState": "/theme"} and bind on.change to the switch_theme action with params.theme bound to {"$state": "/theme"}; seed state.theme with the default theme.',
  events: ["change"],
  example: { value: { $bindState: "/theme" } },
};

// D5/D7 (docs/plan/040-catalog-icons): per-component additions on top of the
// shared STYLE_PROPS extension. The catalog owns these two definitions, so
// lib/playground/overrides.tsx owns the matching renderers.
const componentExtensions: Record<
  string,
  { props?: z.core.$ZodLooseShape; events?: readonly string[] }
> = {
  // D5: icon-carrying buttons (the model's Previous/Next lesson) — the
  // override draws them around the label and keeps a single press emission.
  Button: {
    props: {
      leadingIcon: z
        .enum(LUCIDE_ICON_NAMES)
        .nullable()
        .optional()
        .describe('Lucide icon drawn before the label (e.g. "chevron-left")'),
      trailingIcon: z
        .enum(LUCIDE_ICON_NAMES)
        .nullable()
        .optional()
        .describe('Lucide icon drawn after the label (e.g. "chevron-right")'),
    },
  },
  // D7: upstream's Input only emits submit/focus/blur — our override also
  // emits `change` on every keystroke so specs can search/filter live.
  Input: { events: ["change"] },
};

const components = {
  ...(Object.fromEntries(
    Object.entries(shadcnComponentDefinitions).map(([name, definition]) => {
      const extension = componentExtensions[name];
      // Not every upstream definition carries `events` in its type union.
      const upstreamEvents = (definition as { events?: readonly string[] })
        .events;
      const events =
        extension?.events !== undefined
          ? [...new Set([...(upstreamEvents ?? []), ...extension.events])]
          : upstreamEvents;
      return [
        name,
        {
          ...definition,
          ...(events !== undefined ? { events } : {}),
          props: (
            definition.props as z.ZodObject<z.core.$ZodLooseShape>
          ).extend({
            ...STYLE_PROPS,
            ...(extension?.props ?? {}),
          }),
        },
      ];
    }),
  ) as unknown as StyledDefinitions),
  Icon: iconDefinition,
  ThemeSwitcher: themeSwitcherDefinition,
} as unknown as StyledDefinitions & {
  Icon: typeof iconDefinition;
  ThemeSwitcher: typeof themeSwitcherDefinition;
};

export const playgroundCatalog = defineCatalog(schema, {
  components,
  // D7: filterItems — the prompt lists the name automatically; STYLING_RULES
  // documents the search/filter wiring that uses it.
  functions: PLAYGROUND_FUNCTIONS,
  actions: {
    // Declared intent, app-implemented (decision 13): the model binds this
    // to the design's language switcher; each surface supplies the handler
    // (editor = in-place switch, live surfaces = navigation).
    [SWITCH_LANGUAGE_ACTION]: {
      params: z.object({ tag: z.string() }),
      description:
        'Switch the design\'s language to <tag> (a BCP-47 tag the spec carries, e.g. "es" or "pt-BR"). Bind it to the language switcher ButtonGroup\'s change event with params.tag bound to the group\'s selected value ({"$state": "/locale"}).',
    },
    // Spec-driven theme (docs/plan/042-tool-rail-and-spec-theme): the
    // ThemeSwitcher flips /theme itself and emits change — this binding
    // hands the new value to the page, which persists the visitor's choice.
    [SWITCH_THEME_ACTION]: {
      params: z.object({ theme: z.enum(["light", "dark"]) }),
      description:
        'Switch the design\'s theme to <theme> ("light" or "dark"). Bind it to the ThemeSwitcher\'s change event with params.theme bound to the switcher\'s value ({"$state": "/theme"}).',
    },
    // Data sources (docs/plan/043-data-sources): the model declares the
    // top-level dataSources/resources/queries blocks; reads mirror into
    // /queries/<name>, and this action persists writes through the
    // adapter. Registered at runtime by <QueryLoader> (registry actions
    // are inert here — rev 1.2).
    [DATA_MUTATE_ACTION]: {
      params: dataMutateParamsSchema,
      description:
        'Persist a change to a declared resource (data sources): create ({ op: "create", resource, input }), update ({ op: "update", resource, id, input }), or delete ({ op: "delete", resource, id }). Requires top-level "dataSources"/"resources" declarations; lists bound to a query mirror ("/queries/<name>/data") refresh automatically. Build create/update input as an object whose fields read form state ({"input": {"title": {"$state": "/new-todo"}, "done": false}} — nested expressions resolve); inside a repeat pass the record id as ({"id": {"$item": "id"}}).',
    },
    // Server pagination (docs/plan/052): a re-run action over one declared
    // query — the counterpart to data_mutate for reads. Registered at
    // runtime by <QueryLoader> alongside it.
    [DATA_READ_ACTION]: {
      params: dataReadParamsSchema,
      description:
        'Re-run one declared query (data sources): { query: "name" }. For paged lists bind the query params to state — {"params": {"page": {"$state": "/page"}, "limit": {"$state": "/limit"}}, "pagination": {"pageParam": "offset", "totalPath": "/count"}} (pageParam "offset" sends ?offset=page×limit&limit=…, "page" sends 1-based ?page=…; totalPath is a JSON pointer to the response\'s total count) — then point a watcher at the page state: "watch": {"/page": {"action": "data_read", "params": {"query": "name"}}}. Next/Prev are plain setState actions moving /page with {"$computed": "stepPage"} (pass maxPage from the mirror); the mirror then exposes /queries/<name>/page (0-based), maxPage (null when the API has no total), hasNext/hasPrev (bind Next/Prev "visible" to them) and the label via {"$computed": "pageLabel", "args": {"page": {"$state": "/page"}, "maxPage": {"$state": "/queries/<name>/maxPage"}}}. Declare "urlSync": ["page", "limit"] at the spec root to deep-link and share the current page in the URL. Rapid page changes coalesce into one trailing fetch.',
    },
  },
});

interface CatalogDefinitionLike {
  slots?: string[];
  description?: string;
  example?: Record<string, unknown>;
}

function rawDefinition(type: string): CatalogDefinitionLike | undefined {
  const definitions = playgroundCatalog.data.components as unknown as Record<
    string,
    CatalogDefinitionLike | undefined
  >;
  return definitions[type];
}

/** True when the component accepts children (declares catalog slots). */
export function isContainerType(type: string): boolean {
  return (rawDefinition(type)?.slots?.length ?? 0) > 0;
}

/** Default props for a freshly inserted element of `type`. */
export function examplePropsFor(type: string): Record<string, unknown> {
  return { ...(rawDefinition(type)?.example ?? {}) };
}

export interface PickerItem {
  name: string;
  description: string;
  container: boolean;
}

/** Catalog components for the insert/group pickers — containers first. */
export function pickerItems(onlyContainers = false): PickerItem[] {
  const items = Object.keys(
    playgroundCatalog.data.components as unknown as Record<string, unknown>,
  ).map((name) => ({
    name,
    description: rawDefinition(name)?.description ?? "",
    container: isContainerType(name),
  }));
  return items
    .filter((item) => !onlyContainers || item.container)
    .sort(
      (a, b) =>
        Number(b.container) - Number(a.container) ||
        a.name.localeCompare(b.name),
    );
}
