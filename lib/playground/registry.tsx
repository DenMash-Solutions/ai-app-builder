"use client";

import { defineRegistry } from "@json-render/react";
import type { Components } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { SWITCH_LANGUAGE_ACTION } from "@/lib/i18n/language-switcher";
import { playgroundCatalog } from "./catalog";
import { IconImpl } from "./icons";
import { ButtonImpl, InputImpl } from "./overrides";
import { withStyleProps } from "./with-style-props";
import type { AnyComponentImpl } from "./with-style-props";

const components = {
  ...Object.fromEntries(
    Object.entries(shadcnComponents).map(([name, Impl]) => [
      name,
      withStyleProps(Impl as unknown as AnyComponentImpl),
    ]),
  ),
  // D5: the catalog's Button declares leadingIcon/trailingIcon — upstream's
  // renderer doesn't know them, so we override it (single press emission,
  // icons drawn around the label).
  Button: withStyleProps(ButtonImpl as unknown as AnyComponentImpl),
  // D7: the catalog's Input declares a `change` event — upstream's renderer
  // never emits it, so we override it too.
  Input: withStyleProps(InputImpl as unknown as AnyComponentImpl),
  // The catalog's Icon draws from the curated Lucide map (icons.ts) — the
  // same single source the name enum derives from.
  Icon: withStyleProps(IconImpl as unknown as AnyComponentImpl),
} as unknown as Components<typeof playgroundCatalog>;

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
