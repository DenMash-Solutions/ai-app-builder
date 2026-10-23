/**
 * Keyed Pokédex wrapper — live spot-check server for the keyed API lane
 * (docs/plan/050) and the per-card detail fan-out (docs/plan/051). A
 * deliberately PROTECTED API around pokeapi.co: every endpoint but /health
 * requires `Authorization: Bearer <DEMO_KEY>`, which is exactly the
 * situation the keyed lane exists for — the browser can never hold that
 * key, so a design reading this API through the keyed lane must route
 * through the app's /api/data-proxy route (server-held env pairs inject
 * the header).
 *
 * Route map (the 051 approach: list first, then one detail read per card):
 *   GET /pokemon        — pokeapi's list envelope forwarded as-is
 *                         (itemsPath "/results" unwraps it in the spec);
 *                         pagination params (?offset=…&limit=…, plan 052)
 *                         ride through, paramless defaults to 12
 *   GET /pokemon/{id}   — pokeapi's detail, SHAPED server-side for cards:
 *                         label (Title-Case), types (display labels),
 *                         typeKey (first type — anchors the card color),
 *                         artwork URL, height/weight in m/kg, trimmed
 *                         stats; upstream's huge `moves` is dropped.
 *                         Shaping happens HERE so the spec binds plain
 *                         fields — no $template/string surgery client-side
 *                         (template-derived-strings lesson).
 *
 * CORS IS enabled (demo convenience kept from 050) so hand-testing the
 * keyless 401 contrast from a browser tab stays readable. The API stays
 * protected either way: no header → 401, regardless of origin.
 *
 * Run:      bun run demo/keyed-pokedex-server.ts            (port 4100)
 * Pair it:  DATA_PROXY_POKEDEX_ORIGIN=http://localhost:4100
 *           DATA_PROXY_POKEDEX_KEY=pkdex-demo-key-2026      (dev server env)
 * Design:   demo/pokedex-keyed-spec.json — import it via the playground's
 *           History drawer → "Import JSON" (config.auth.ref = "pokedex";
 *           config.itemDetail fans each list row out to /pokemon/{id}).
 *
 * Logs the presence of a key, never its value.
 */

const PORT = 4100;
const DEMO_KEY = "pkdex-demo-key-2026";
const POKEAPI = "https://pokeapi.co/api/v2";
/** No-param default for GET /pokemon — the first 12. */
const POKEAPI_LIST_DEFAULT_LIMIT = 12;

/** "bulbasaur" → "Bulbasaur"; "mr-mime" → "Mr Mime" (server-side shaping). */
const displayName = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

/** pokeapi's detail payload — only the fields the shaping reads. */
interface PokeDetail {
  id: number;
  name: string;
  height: number; // decimetres
  weight: number; // hectograms
  types: { slot: number; type: { name: string } }[];
  stats: { base_stat: number; stat: { name: string } }[];
  sprites: {
    other?: { "official-artwork"?: { front_default: string | null } };
  };
}

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
    const { pathname, search } = new URL(request.url);
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }));
    }
    const authorized =
      request.headers.get("authorization") === `Bearer ${DEMO_KEY}`;
    console.log(
      `[pokedex-wrapper] ${request.method} ${pathname}${search} — key ${authorized ? "present" : "MISSING/wrong"}`,
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
      // The list forwarded as-is — the design unwraps the envelope with
      // itemsPath "/results" and reads each card's content from the
      // per-row detail route below (051 fan-out). The client's own
      // pagination params ride along verbatim (?offset=…&limit=… — plan
      // 052); a paramless request keeps the first 12.
      const query =
        search === "" ? `?limit=${POKEAPI_LIST_DEFAULT_LIMIT}` : search;
      const upstream = await fetch(`${POKEAPI}/pokemon${query}`);
      if (!upstream.ok) {
        return withCors(
          Response.json({ error: "pokeapi upstream failure" }, { status: 502 }),
        );
      }
      return withCors(Response.json(await upstream.json()));
    }
    const detailId = pathname.match(/^\/pokemon\/(\d+)$/)?.[1];
    if (detailId) {
      const upstream = await fetch(`${POKEAPI}/pokemon/${detailId}`);
      if (!upstream.ok) {
        return withCors(
          Response.json({ error: "pokeapi upstream failure" }, { status: 502 }),
        );
      }
      const data = (await upstream.json()) as PokeDetail;
      const typeKeys = data.types.map((entry) => entry.type.name);
      return withCors(
        Response.json({
          id: data.id,
          name: data.name,
          label: displayName(data.name),
          types: typeKeys.map(displayName), // display labels for chips
          typeKey: typeKeys[0] ?? "unknown", // first type anchors the color
          artwork:
            data.sprites.other?.["official-artwork"]?.front_default ?? "",
          height: data.height / 10, // decimetres → metres
          weight: data.weight / 10, // hectograms → kilograms
          stats: data.stats.map((entry) => ({
            name: entry.stat.name,
            value: entry.base_stat,
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
