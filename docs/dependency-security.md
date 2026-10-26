# Dependency security review

Reviewed **2026-10-26** against the primary sources
(<https://github.com/vercel/next.js/security/advisories>,
<https://github.com/facebook/react/security/advisories>, the Next.js 15.5.x release
notes, each package's own advisory page) and the **resolved** dependency tree, including
the code Next.js vendors into its own bundle and the image stack shipped in the
standalone build. `npm audit` returning zero was not taken as sufficient on its own.

## Versions

| Package | Before | After | Notes |
|---|---|---|---|
| `next` | 15.5.28 | 15.5.28 | latest 15.x backport (dist-tag `backport`); 16.x is a major upgrade, not required for any fix |
| `react` / `react-dom` | 19.2.8 | **19.2.9** | aligned with the React line that carries the Oct 2026 RSC fixes (see below) |
| `sharp` (via next) | 0.35.5 | 0.35.5 | the minimum the image-optimiser RCE advisory requires |
| `drizzle-orm` | 0.45.3 | 0.45.3 | ≥ 0.45.2 (identifier-escaping SQL injection fix) |
| `pg` | 8.23.1 | 8.23.1 | no published advisories |
| `postcss` (override) | 8.5.29 | 8.5.29 | single version across next, tailwind and vite |

## Applicability of recent advisories

| Advisory | Affects | Status for this app |
|---|---|---|
| Next GHSA-2464-fhr4-w9xw — RCE in Image Optimization with SVG (critical) | `next` ≤ 15.5.27; fixed 15.5.28 with `sharp` ≥ 0.35.5 | **Patched** (15.5.28, sharp 0.35.5 in the standalone bundle). Defence in depth: `images.unoptimized = true`; `/_next/image` now returns 404 (verified against the production build) |
| Next GHSA-p3m5-59mp-jv5r — DoS via Server Actions (high) | `next` 13.0–15.5.27; fixed 15.5.28 | Patched. Also not reachable: the app defines no Server Actions (`"use server"` appears nowhere) |
| React GHSA-xqc2-xf4c-x3h3 — RCE in RSC with multiple typed arrays (critical) | `react-server-dom-*` 19.2.0–19.2.8; fixed 19.2.9 | Next 15.x vendors its own RSC runtime. Diffing the vendored `react-server-dom-webpack` of 15.5.27 vs 15.5.28 shows 15.5.28 adds the typed-array / detached-buffer transport guard; the guard is present in the shipped `app-page.runtime.prod.js`. Not otherwise reachable: no Server Actions, no `use cache`, no typed arrays in server-component props. Top-level `react`/`react-dom` moved to 19.2.9 |
| React GHSA-h3gv-c5rc-p453 — DoS in Server Functions (high) | `react-server-dom-*` ≤ 19.2.8 | Covered by the Next 15.5.28 fix above (Next's counterpart is GHSA-p3m5); no Server Functions in the app |
| Next GHSA-673q-mjm6-r5xr — RCE in `use cache` returning typed arrays (critical) | `next` 16.0.0–16.4.0 only | Not affected (15.x; no `use cache`) |
| Next GHSA-vcvr-r3jv-pc5j — RCE in `next/og` ImageResponse (critical) | `next` 16.2.0–16.3.5 | Not affected (15.x; `next/og` not used) |
| Next GHSA-cjq9-62q9-8jv4 — SSRF in Image Optimization (high) | 16.x, only with `images.remotePatterns` | Not affected (no `remotePatterns`; optimiser disabled) |
| Next GHSA-4jqv-mc3x-m676, GHSA-mcj8-r9mp-w47p — SSG/ISR cache poisoning (moderate) | ≥ 15.0.0; fixed in 15.5.27 | Patched; also not applicable (App Router only, every route dynamic, no root catch-all) |
| Next GHSA-39w2-rjm5-chcv — dev-server MCP endpoint disclosure (low) | development server | Not applicable to production builds |
| Drizzle GHSA-gpj5-g38j-94v9 — SQL injection via identifiers (high) | ≤ 0.45.1 | Patched (0.45.3); also not reachable (no identifiers built from input) |

## Verification performed

```
npm audit                 → found 0 vulnerabilities
npm audit --omit=dev      → found 0 vulnerabilities
npm ls react react-dom    → single react@19.2.9 / react-dom@19.2.9 (deduped under next)
grep "Cannot transport a detached buffer" .next/standalone/node_modules/next/dist/compiled/next-server/app-page.runtime.prod.js
curl /_next/image?...     → 404 (production standalone build)
```

Followed by typecheck, lint, unit, integration, statistical, build and e2e runs (see the
README's testing section for the latest results).

## Remaining findings and plan

* **No known unpatched critical/high/moderate advisory applies.**
* `next` 15.5.x is in backport-only maintenance. Plan: upgrade to the 16.x line in a
  separate change (App Router APIs are compatible, but `eslint` integration, caching
  defaults and the `next lint` removal need a dedicated pass and a full e2e run).
* The Docker base image (`node:22-bookworm-slim`) carries OS packages outside npm's view:
  rebuild regularly and scan the image (e.g. `docker scout cves` or Trivy) in the
  deployment pipeline. Not run here (no registry scanner available in this environment).
* Re-run this review on every Next.js / React security release; the CI workflow runs
  `npm audit --audit-level=moderate` on every push.
