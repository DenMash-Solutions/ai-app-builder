import { NextResponse } from "next/server";
import customers from "@/demo/ecommerce/fixtures/customers.json";
import products from "@/demo/ecommerce/fixtures/products.json";

/**
 * Read-only fixture API (docs/plan/070-ecommerce-reference-demo, decision 5
 * + 13): serves `demo/ecommerce/fixtures/*.json` under `/api-public/<name>`.
 * The demo's api data sources point their baseUrl here (through the keyed
 * `/api/data-proxy` lane in real deployments; e2e forwards the ref to this
 * route directly), so e2e, the MCP spot-check and the README replay all read
 * the same committed fixtures.
 *
 * Shapes: `GET /api-public/products` → the list; `GET /api-public/products/
 * <id>` → one record; anything outside the allowlist (unknown resource,
 * unknown id, extra path segments) is a 404. Read-only by design — the cart
 * and orders collections are writable localStorage resources instead.
 */

const FIXTURES: Record<string, Array<Record<string, unknown>>> = {
  customers: customers as Array<Record<string, unknown>>,
  products: products as Array<Record<string, unknown>>,
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ resource: string; path?: string[] }> },
): Promise<NextResponse> {
  const { resource, path } = await params;
  const rows = FIXTURES[resource];
  if (rows === undefined) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const segments = path ?? [];
  if (segments.length === 0) {
    return NextResponse.json(rows);
  }
  if (segments.length > 1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const row = rows.find((candidate) => candidate.id === segments[0]);
  if (row === undefined) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
