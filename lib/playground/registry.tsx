"use client";

import { defineRegistry } from "@json-render/react";
import type { Components } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { SWITCH_LANGUAGE_ACTION } from "@/lib/i18n/language-switcher";
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
  actions: {
    // Registry-level default is inert: every surface supplies the real
    // switch_language handler through JSONUIProvider's handlers prop — the
    // editor switches in place, live surfaces navigate (decision 13).
    [SWITCH_LANGUAGE_ACTION]: async () => {},
  },
});

export { registry };
