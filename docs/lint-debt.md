# Lint Debt Tracker

`npm run lint` runs `eslint . --max-warnings 0` and is enforced by
`run-tests.sh` (and any CI that calls it). To get there from a baseline
of 820 pre-existing errors we relaxed several rules for first-party
application code in `client/**` and `server/**`. Each one suppresses
real tech debt — when those areas of the code are touched, prefer to
fix the violation and re-enable the rule on a per-file basis instead of
leaving the global override in place.

## Globally relaxed rules (set to `off` in `eslint.config.js`)

| Rule                                       | Why it's off (today)                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `@typescript-eslint/no-unused-vars`        | ~430 hits — leftover imports, destructured-but-ignored fields, work-in-progress args |
| `no-empty`                                 | ~80 hits — deliberate "swallow" `catch {}` around best-effort background work        |
| `no-useless-escape`                        | ~20 hits — legacy regex literals with redundant escapes                              |
| `@typescript-eslint/no-require-imports`    | ~13 hits — a few legacy CommonJS interop sites                                       |
| `prefer-const`                             | small backlog of `let` placeholders                                                  |
| `no-useless-assignment`                    | small backlog                                                                        |
| `preserve-caught-error`                    | ESLint 10 rule with several catch-and-rethrow sites that don't pass `cause`          |
| `@typescript-eslint/ban-ts-comment`        | a handful of `// @ts-ignore` lines                                                   |
| `@typescript-eslint/no-unused-expressions` | three short-circuit `cond && fn()` patterns                                          |
| `@typescript-eslint/no-namespace`          | one declaration-merging namespace                                                    |

`linterOptions.reportUnusedDisableDirectives` is also off so
`// eslint-disable-next-line react-hooks/exhaustive-deps` comments
left over from when that plugin was loaded don't error out.

## Re-enable strategy

1. When editing a file in `client/**` or `server/**`, also fix any
   violations of the rules above that the file contains.
2. Once a directory (e.g. `server/routes/`) is clean, add a narrower
   override in `eslint.config.js` that re-enables the rule for that
   glob.
3. When a global rule has no remaining violations anywhere in app
   code, delete it from the override block so it's enforced everywhere.

## Out-of-scope code

Vendored skill bundles (`.local/**`), one-off legacy scripts at the
repo root (`crawl-*`, `regression-*`, `nuclear-*.cjs`,
`upgrade-and-clean.cjs`, `test-invoice-email.js`, etc.), the browser
service worker (`client/public/sw.js`), and Playwright `e2e/**` specs
are ignored entirely. They're not part of the running app and aren't
worth retrofitting to current lint rules.
