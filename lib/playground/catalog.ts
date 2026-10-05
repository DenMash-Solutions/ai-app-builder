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
