"use client";

import { defineRegistry } from "@json-render/react";
import type { Components } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { DATA_MUTATE_ACTION } from "@/lib/data-sources/types";
import { SWITCH_LANGUAGE_ACTION } from "@/lib/i18n/language-switcher";
import { SWITCH_THEME_ACTION } from "@/lib/theme/spec-theme";
import { playgroundCatalog } from "./catalog";
import { IconImpl } from "./icons";
import {
  ButtonWithActionState,
  GridImpl,
  InputImpl,
  ThemeSwitcherImpl,
} from "./overrides";
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
  Button: withStyleProps(ButtonWithActionState as unknown as AnyComponentImpl),
  // D7: the catalog's Input declares a `change` event — upstream's renderer
  // never emits it, so we override it too.
  Input: withStyleProps(InputImpl as unknown as AnyComponentImpl),
  // D3 (docs/plan/041-responsive-ui): `columns` is the desktop target — the
  // override emits the responsive ladder so grids fit phone viewports.
  Grid: withStyleProps(GridImpl as unknown as AnyComponentImpl),
  // The catalog's Icon draws from the curated Lucide map (icons.ts) — the
  // same single source the name enum derives from.
  Icon: withStyleProps(IconImpl as unknown as AnyComponentImpl),
  // Spec-driven theme (docs/plan/042-tool-rail-and-spec-theme) — our catalog
  // owns the definition, so it owns the renderer too.
  ThemeSwitcher: withStyleProps(
    ThemeSwitcherImpl as unknown as AnyComponentImpl,
  ),
} as unknown as Components<typeof playgroundCatalog>;

const { registry } = defineRegistry(playgroundCatalog, {
  components,
  actions: {
    // Registry-level default is inert: every surface supplies the real
    // switch_language handler through JSONUIProvider's handlers prop — the
    // editor switches in place, live surfaces navigate (decision 13).
    [SWITCH_LANGUAGE_ACTION]: async () => {},
    // Same pattern: author surfaces need no handler (the ThemeSwitcher's
    // bindState write IS the persistence there); public surfaces persist
    // the visitor's decision via their own handler.
    [SWITCH_THEME_ACTION]: async () => {},
    // Data sources (docs/plan/043-data-sources, rev 1.2): this map is a type
    // requirement of defineRegistry, not a wiring point — the real
    // data_mutate handler is registered at runtime inside the provider
    // tree by <QueryLoader> (auth-actions precedent).
    [DATA_MUTATE_ACTION]: async () => {},
  },
});

export { registry };
