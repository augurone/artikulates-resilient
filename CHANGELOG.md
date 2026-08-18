# Changelog

## 0.3.0 — 2026-08-18

- Added a portable contract core available from `eslint-plugin-resilient/contracts`.
- Added flow-aware inference for guards, aliases, reassignment, property updates,
  bounded loops, and `try`/`catch`/`finally` paths.
- Added offset-based document queries for contract and signature introspection.
- Added opt-in contract diagnostics for call-site values and native operations.
- Hardened existing rules for `useState` tuples, reducer accumulators, and
  awaited sequential loops.
- Dogfooded the rules in Artikulates and removed resilient-specific suppressions
  from the application code.

## 0.2.0 — 2026-08-01

- Added explicit suggestions for zero and non-zero collection length checks.
- Added guarded signature-destructuring suggestions after whole-function
  reference analysis.
- Added null-safe handling for `no-undefined-assignment` and the parallel
  `no-null-assignment` rule.
- Added `no-undefined-comparison`, enforcing falsey checks instead of explicit
  `undefined` comparisons.
- Added `prefer-destructured-member-access` for static member reads from
  function parameters.
- Added recommended-config integration coverage and documented the distinction
  between suggestions and automatic fixes.
