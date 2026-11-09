# Running tests locally

This is pointer documentation for contributors. The full hygiene
inventory lives in `docs/test-hygiene-2026-05.md` and individual
ROOT CAUSE / FIX rationales are in commit messages.

## Pre-condition: build `@bimoto/shared` first (now automated)

The server suite type-checks against `@bimoto/shared`'s compiled
output (`packages/shared/dist/index.d.ts`). On a fresh clone the
`dist` directory does not exist, so without a prior build
`pnpm --filter @bimoto/server test` would fail every test suite
with `Cannot find module '@bimoto/shared'` — ts-jest's type-check
phase resolves the package via TypeScript, which honours the
shared package's `main`/`types` fields.

R3-CI-HYGIENE (2026-05-09) added a `pretest` lifecycle hook in
`packages/server/package.json` that runs
`pnpm --filter @bimoto/shared build` automatically before `jest`,
so on a fresh clone:

```bash
pnpm install
pnpm test:server   # pretest hook builds shared, then jest runs
```

The previous two-step recipe (`pnpm --filter @bimoto/shared build`
then test) still works and is equivalent — the pretest hook only
removes the manual step.

If your pnpm has `enable-pre-post-scripts=false` in `.npmrc` (rare;
the pnpm 9 default is `true`), the hook is skipped silently. Fall
back to the explicit two-step form, or rely on the explicit
`pnpm --filter @bimoto/shared build` step in
`.github/workflows/server-tests.yml` for CI.

## How CI runs the suite

`.github/workflows/server-tests.yml` (added by R3-CI-HYGIENE) runs
`pnpm test:server` on every PR and every push to `main`. The
workflow also runs `pnpm --filter @bimoto/shared build` explicitly
before tests as belt-and-suspenders defense — the pretest hook and
the explicit step both have to fail for a bare-shared regression
to land. Before R3-CI-HYGIENE the only CI gates were `e2e.yml` and
`android-build.yml`, so server-test regressions could reach `main`
(R3-TEST-HYGIENE swept up the resulting drift; R3-CI-HYGIENE closes
the loop).

## What is `it.skip(...)` allowed to mean here

The R3-TEST-HYGIENE sweep introduced no skips — every failure was
a mechanical fixture/mock update. The one pre-existing skipped
test (`graph-pattern-detection` related) is unrelated and lives
in `packages/server/src/services/aml/graph-patterns/__tests__/`.

If a future test must be skipped because it requires real env
(DB connection, Flutterwave credentials, FCM keys, etc.), the
convention is:

```ts
it.skip('TODO(test-hygiene-env-2026-05): requires postgres TEST_DATABASE_URL', () => {
  // ... test body unchanged ...
});
```

The `TODO(test-hygiene-env-…)` marker makes it possible to grep
for outstanding env-skips and revisit them in a future hygiene
sweep.

## Type-check the server package

```bash
pnpm --filter @bimoto/server exec tsc --noEmit
```

Same shared-build pre-condition applies.

## Prisma engine downloads behind a resetting proxy

Symptom: `prisma generate` (or `pnpm install`'s postinstall) fails with
`ECONNRESET` while fetching engine binaries from `binaries.prisma.sh` —
some sandbox/CI proxies reset that host mid-download. Three executor
sessions independently rebuilt the same workaround before it was
written down; the hardened recipe is below. If the engines are already
in the pnpm store (a warm container), `prisma generate` needs no
download and none of this applies — try it plainly first.

The recipe: download the engine files on whatever path *does* work
(retries, another machine, a host the proxy allows), verify them
against Prisma's published sha256 checksums, then serve them to Prisma
from a loopback-only mirror. Keep everything in a scratch directory —
nothing here gets committed.

```bash
# 1. Stage the engine files in a scratch dir, laid out the way
#    binaries.prisma.sh does: <mirror>/all_commits/<engine-commit>/<platform>/<file>
MIRROR_DIR="$SCRATCH/prisma-mirror"
mkdir -p -- "$MIRROR_DIR"
# ... place the .gz engine files + their .sha256 files there ...

# 2. Verify checksums BEFORE serving — refuse to mirror anything that
#    does not match Prisma's published .sha256 files.
( cd -- "$MIRROR_DIR" && sha256sum -c -- *.sha256 )

# 3. Serve loopback-only (never bind a public interface).
python3 -m http.server 8899 --bind 127.0.0.1 --directory "$MIRROR_DIR" &
MIRROR_PID=$!

# 4. Point Prisma at the mirror and generate.
PRISMA_ENGINES_MIRROR=http://127.0.0.1:8899 pnpm --filter @bimoto/server exec prisma generate

# 5. Kill the server as soon as generate succeeds.
kill -- "$MIRROR_PID"
```

`PRISMA_ENGINES_MIRROR` is the variable the CLI actually reads —
verified against `@prisma/fetch-engine` 5.22.0 (the version pinned
here), which checks it after the legacy `PRISMA_BINARIES_MIRROR` and
falls back to `https://binaries.prisma.sh`. If you bump Prisma,
re-check the variable name in `@prisma/fetch-engine`'s `dist/` before
trusting this recipe.
