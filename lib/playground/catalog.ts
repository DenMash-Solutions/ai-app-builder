import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";

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

const components = Object.fromEntries(
  Object.entries(shadcnComponentDefinitions).map(([name, definition]) => [
    name,
    {
      ...definition,
      props: (definition.props as z.ZodObject<z.core.$ZodLooseShape>).extend(
        STYLE_PROPS,
      ),
    },
  ]),
) as unknown as StyledDefinitions;

export const playgroundCatalog = defineCatalog(schema, {
  components,
  actions: {},
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
