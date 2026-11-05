This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Documentation

- [ADR: In-spec languages](docs/plan/038-spec-languages/convention.md) — the `state.copy` seed + `state.i18n.<tag>` overlay contract every renderer, editor surface, and publish bake follows
- [Implementation plans](docs/plan/) — per-feature plans with decisions and task logs
- [Security](docs/security/) — RLS audit notes

## Demo: ecommerce reference app

`demo/ecommerce/` holds the committed seed specs of a 7-screen storefront
(Home, Products, Product details, Cart, Checkout, Orders, Order details)
plus 7 catalog components in two versions each. The plan that defines the
whole system is [`docs/plan/070-ecommerce-reference-demo/plan.md`](docs/plan/070-ecommerce-reference-demo/plan.md).

Replay:

1. **Fixtures** — `GET /api-public/products` and `/api-public/customers`
   serve `demo/ecommerce/fixtures/*.json` (read-only; the route allowlists
   resources and 404s anything else).
2. **Env (keyed lane)** — the products/customers data sources declare
   `config.auth.ref: ecommerce` (the 067 publish gate refuses an api
   source without one on a project screen). The server proxy pairs
   `DATA_PROXY_ECOMMERCE_ORIGIN` + `DATA_PROXY_ECOMMERCE_KEY` (append both
   to `.env.local`, see `.env.example`; **restart `next dev`** to pick
   them up). The e2e suite needs no env — MSW forwards the ref to the
   fixture route in the browser.
3. **Specs** — screens live in `demo/ecommerce/screens/*.spec.json`,
   components in `demo/ecommerce/components/*.{v1,v2}.spec.json`; all are
   validated by `bun test demo/ecommerce/specs.test.ts`
   (`validateSpec` + the in-project data-source gate).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
