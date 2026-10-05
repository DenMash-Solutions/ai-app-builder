"use client";

import { defineRegistry } from "@json-render/react";
import type { Components } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { playgroundCatalog } from "./catalog";
import { withStyleProps } from "./with-style-props";
import type { AnyComponentImpl } from "./with-style-props";

const components = Object.fromEntries(
  Object.entries(shadcnComponents).map(([name, Impl]) => [
    name,
    withStyleProps(Impl as unknown as AnyComponentImpl),
  ]),
) as unknown as Components<typeof playgroundCatalog>;

const { registry } = defineRegistry(playgroundCatalog, {
  components,
});

export { registry };
