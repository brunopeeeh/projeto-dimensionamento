# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Dimensionamento Care** — internal Yooga tool for workforce planning/scheduling of the customer support (Care) team. Models support demand in 10-minute time blocks with dynamic allocation and overflow across channels, computes deficits, and drives hiring decisions. Full domain writeup: [DOCUMENTACAO_DIMENSIONAMENTO.md](DOCUMENTACAO_DIMENSIONAMENTO.md), [PRODUCT.md](PRODUCT.md). Portuguese-BR only, no i18n.

Stack: React 19 + TypeScript, TanStack Start (SSR, file-based routing, over Vite), Tailwind v4 + Radix/shadcn (`new-york` style), Supabase (Postgres) for persistence, Zustand-backed context store, Recharts, xlsx for import/export.

## Commands

```bash
npm run dev              # vite dev
npm run build             # vite build (nitro, vercel preset)
npm run typecheck          # tsc --noEmit
npm run lint / lint:fix
npm run format             # prettier --write .
npm run test                # vitest run
npm run test:watch
npx vitest run <path>      # single file
npm run db:migrate          # scripts/db-migrate.mjs — applies supabase/migrations/*.sql
npm run db:status           # npx supabase migration list
```

No test runner filter flag is wired up in package.json — pass the file path directly to `vitest run`.

## Architecture

### Routing (TanStack Start file-based)

`src/routes/` — every `.tsx` is a route, `__root.tsx` is the only layout shell. Each route ships as a pair: `foo.tsx` (route definition/loader) + `foo.lazy.tsx` (the actual page component, code-split). `routeTree.gen.ts` is **auto-generated** — never hand-edit it; it regenerates from the dev/build process. See [src/routes/README.md](src/routes/README.md) for the file-naming convention (`$id`, `{-$optional}`, `$.splat`).

Main routes: `/` (index), `/painel` (ops dashboard), `/escala` (schedule/Team Manager grid), `/capacidade` (capacity + Freshchat sync), `/calculadora-anual` (annual headcount planning), `/contratacoes`, `/previsao-escala`, `/helpdesk`.

### State: DimensionamentoContext (Zustand-backed React context)

`src/context/DimensionamentoContext.tsx` is the app's central store — almost every page reads from it via `useDimensionamento(selector)`. It's a plain React context wrapping a Zustand `createStore`, synced via `useLayoutEffect` on every render (not idiomatic Zustand usage — state lives in `useState`, Zustand is just the selector/subscription layer to avoid re-rendering everything on every keystroke).

The provider composes logic split into sibling hooks in `src/context/`:
- `useInitialData` — seeds default time blocks / helpdesk volumes / capacity agents.
- `useScheduleActions` — interval toggling and shift presets on the schedule grid.
- `useDataImport` — PowerBI CSV import into helpdesk volumes.
- `useMonthActions` — switching/creating months, orchestrating load/save against Supabase.

`src/hooks/useSupabasePersistence.ts` is the actual read/write bridge to Supabase, driven off a `persistenceSnapshot`/`persistenceSetters` pair built in the context. When `supabase` client is `null` (no env vars), state falls back to `localStorage` (`yooga_team_agents`, `yooga_capacity_agents`) — this local-only mode is intentional for dev/offline use, not a bug.

Calculations (`computeDynamicTmaFactors`, `computeGridCalculations` in `src/lib/calculations.ts`) are pure functions run through `useMemo` in the context — this is the core dimensioning engine: per-10-minute-block capacity vs. volume, overflow, and deficit math. Read `src/lib/calculations.ts` + its test file together before changing scheduling math.

### Calculadora Anual (separate sub-feature)

`src/features/calculadora-anual/` is intentionally decoupled from `DimensionamentoContext` — see its [README](src/features/calculadora-anual/README.md). It answers "how many hires this year" (growth/turnover/Erlang-style projection over months) as opposed to the main app's "how does the weekly schedule work out" (Prova Real/Simulador). Its own engine lives in `engine/` (`calculator.ts`, `capacity.ts`, `demand.ts`, `ramp.ts`, `turnover.ts`, `timeline.ts`, `scenarios.ts`) and has no import into the top-level context — don't cross-wire them.

### Server functions and `/api/*` routes — two different mechanisms

- **TanStack `createServerFn`** (`src/lib/api/example.functions.ts` pattern): use for new server logic callable from client code. `.server.ts`-suffixed modules (or code marked `@tanstack/react-start/server-only`) are stripped from the client bundle; module-level code in a non-`.server.ts` file still ships to the client even if only used server-side.
- **Hand-rolled `/api/*` routes** in `src/server.ts` (`handleApiRoutes`): pre-TanStack-SSR interception for `sync-capacity`, `sync-from-freshchat`, `ai-suggestion`, `math-suggestion`. This app has **no login/auth** — every `/api/*` route is gated by `src/lib/api-guards.ts` (`isCrossSite` origin check + `hasValidApiKey` shared-secret check for the sensitive `sync-capacity` route). Any new `/api/*` route must go through the same guards or it becomes an open door to the Supabase service-role key and paid AI/Freshchat/HubSpot calls. Don't relax these checks or add `Access-Control-Allow-Origin: *`.
- `src/lib/api/*.server.ts` hold the actual server-only integrations: `freshchat.server.ts`, `hubspot.server.ts`, `ai-agent.server.ts` (multi-provider fallback: NVIDIA → DeepSeek → DashScope → OpenRouter, see `.env.example`), `sync-capacity.server.ts`.
- `src/lib/optimization/solver.ts` is a separate, synchronous, non-AI optimization path (`/api/math-suggestion`) — deterministic shift/day-off enumeration against `VALID_SHIFTS`/`VALID_DAY_OFF_COMBOS`, not an LLM call.

### Database (Supabase)

Schema is **mid-migration**. Legacy JSONB columns (`meses`, `escala_equipe`, `volumes_chamados`, `parametros_operacionais`) are being replaced by canonical relational tables (`agentes`, `capacity_snapshots`, `volumes_faixa`, `escala_blocos`, ...). Concretely:
- The front **reads with a parity guard**: `loadCanonicalMonth` (`src/lib/canonical-persistence.ts`) builds each area from the canonical tables, but only uses it when its signature matches the legacy value for that load — divergence (e.g. an old client still writing legacy-only) falls back to legacy and logs a warning. Every save **dual-writes** legacy + canonical through `syncCanonicalAreas` (best-effort, so a canonical failure never breaks the legacy save).
- Canonical tables hold parity backfilled from legacy (migrations `0015`–`012`). The drop of legacy tables is still pending and must only happen after the parity guard stops warning.
- `agentes.id_front` / `escala_roster.id_front` / `novas_contratacoes.id_front` preserve the front-end ids (`a_…`, `clt-…`, `h1`, …) — needed because `escala_excecoes.agente_id` and the hiring simulator reference them. The roster stores the id **per competência** (legacy ids are not stable across months).
- `capacity_snapshots.ativo` mirrors `CapacityAgent.active`; `agentes.ativo` is the CLT roster flag.
- RLS policies are named `*_all_transicao` (permissive, no-auth transition mode) — don't treat this as the final security model, and don't add features that assume it's permanent.
- All timestamp bucketing must go through `America/Sao_Paulo` conversion (see `fn_volume_medio_faixa`) — a naive UTC bucket miscounts overnight call volume into the wrong day, which matches the operating hours (07:00–03:00) already crossing midnight.

### Design system

[PRODUCT.md](PRODUCT.md) is the source of truth for this product's visual/voice register — a dense, decision-oriented ops dashboard ("cockpit operacional"), explicitly **not** the airy marketing-site register described in [DESIGN.md](DESIGN.md) (that file documents yooga.com.br, the public marketing site, for reference only — don't copy its spacing/CTA patterns into this app). Brand blue `#19A1E6` carries through both, but density-with-hierarchy is the product's own principle, not the marketing site's.

## Conventions

- Path alias `@/*` → `src/*` (see `tsconfig.json` / `components.json`).
- shadcn/ui components live in `src/components/ui`, style `new-york`, icons via `lucide-react`.
- Business types (`Day`, `TeamAgent`, `NewAgentHire`, `DimensionamentoState`, etc.) are centralized in `src/context/types.ts` and re-exported from `DimensionamentoContext.tsx` — import from the context module in app code, not `types.ts` directly, unless already inside `src/context/`.
- Don't import the Next.js `server-only` package — this is TanStack Start; use a `*.server.ts` filename or `@tanstack/react-start/server-only` instead (enforced by an ESLint `no-restricted-imports` rule).
- Vitest config is intentionally separate from `vite.config.ts` (see comment in `vitest.config.ts`) because the app's real Vite config wraps `@lovable.dev/vite-tanstack-config`, which isn't meant to run under Vitest.
