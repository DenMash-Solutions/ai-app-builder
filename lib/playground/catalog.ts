import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { SWITCH_LANGUAGE_ACTION } from "@/lib/i18n/language-switcher";
import { PLAYGROUND_FUNCTIONS } from "@/lib/playground/computed-functions";
import { LUCIDE_ICON_NAMES } from "@/lib/playground/icons";

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

// D5/D7 (docs/plan/catalog-icons): per-component additions on top of the
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
} as unknown as StyledDefinitions & { Icon: typeof iconDefinition };

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
