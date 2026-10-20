/**
 * Keyed Pokédex wrapper — live spot-check server for the keyed API lane
 * (docs/plan/050-keyed-api-lane). A deliberately PROTECTED API around
 * pokeapi.co: every endpoint but /health requires
 * `Authorization: Bearer <DEMO_KEY>`, which is exactly the situation the
 * keyed lane exists for — the browser can never hold that key, so a
 * design reading this API through the keyed lane must route through the
 * app's /api/data-proxy route (server-held env pairs inject the header).
 *
 * The /pokemon response enriches each row with `image` (official artwork
 * URL derived from the id in `url` — derived SERVER-side, so the spec
 * itself needs no string surgery, per template-derived-strings).
 *
 * CORS IS enabled (demo decision) so the spec's second, keyless
 * browser-direct section (Lane 1 style) receives a *readable* 401 instead
 * of an opaque CORS failure — the UI then renders the real adapter
 * message. The API stays protected either way: no header → 401,
 * regardless of origin.
 *
 * Run:      bun run demo/keyed-pokedex-server.ts            (port 4100)
 * Pair it:  DATA_PROXY_POKEDEX_ORIGIN=http://localhost:4100
 *           DATA_PROXY_POKEDEX_KEY=pkdex-demo-key-2026      (dev server env)
 * Design:   demo/pokedex-keyed-spec.json — import it via the playground's
 *           History drawer → "Import JSON" (config.auth.ref = "pokedex").
 *
 * Logs the presence of a key, never its value.
 */

const PORT = 4100;
const DEMO_KEY = "pkdex-demo-key-2026";
const POKEAPI_LIST = "https://pokeapi.co/api/v2/pokemon?limit=12";
const ARTWORK_BASE =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork";

/** PokeAPI official-artwork URL for a row's id — "" when unparseable. */
const artworkUrl = (url: string): string => {
  const id = url.match(/\/(\d+)\/?$/)?.[1];
  return id ? `${ARTWORK_BASE}/${id}.png` : "";
};

/** Clone the response with CORS headers attached (demo decision — see header). */
const withCors = (response: Response): Response => {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "authorization");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

Bun.serve({
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    const authorized =
      request.headers.get("authorization") === `Bearer ${DEMO_KEY}`;
    console.log(
      `[pokedex-wrapper] ${request.method} ${pathname} — key ${authorized ? "present" : "MISSING/wrong"}`,
    );

    if (pathname === "/health") {
      return new Response("ok"); // keyless liveness probe for the operator
    }
    if (!authorized) {
      return withCors(
        Response.json(
          { error: "This API requires Authorization: Bearer <key>." },
          { status: 401 },
        ),
      );
    }
    if (pathname === "/pokemon") {
      // Forward the public upstream; the envelope ({count, results}) is
      // returned as-is, with each row enriched with its artwork URL — the
      // design unwraps the envelope with itemsPath "/results".
      const upstream = await fetch(POKEAPI_LIST);
      if (!upstream.ok) {
        return withCors(
          Response.json({ error: "pokeapi upstream failure" }, { status: 502 }),
        );
      }
      const data = (await upstream.json()) as {
        count: number;
        next: string | null;
        previous: string | null;
        results: { name: string; url: string }[];
      };
      return withCors(
        Response.json({
          ...data,
          results: data.results.map((row) => ({
            ...row,
            image: artworkUrl(row.url),
          })),
        }),
      );
    }
    return withCors(Response.json({ error: "Not found" }, { status: 404 }));
  },
});

console.log(
  `[pokedex-wrapper] listening on http://localhost:${PORT} — requires "Authorization: Bearer ${DEMO_KEY}"`,
);
