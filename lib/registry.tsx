"use client";

import { defineRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { playgroundCatalog } from "./catalog";

const { registry } = defineRegistry(playgroundCatalog, {
  components: shadcnComponents,
});

export { registry };
