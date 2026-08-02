# Changelog

## 0.2.0 — 2026-08-01

- Added explicit suggestions for zero and non-zero collection length checks.
- Added guarded signature-destructuring suggestions after whole-function
  reference analysis.
- Added null-safe handling for `no-undefined-assignment` and added the parallel
  `no-null-assignment` contract rule. Neither rule invents a replacement value.
- Added `no-undefined-comparison`, enforcing `!value` and `!!value` instead of
  explicit `undefined` comparisons.
- Added `prefer-destructured-member-access` for static member reads from
  function parameters. Body destructuring satisfies this rule; signature
  placement remains the responsibility of `prefer-signature-destructuring`.
- Added recommended-config integration coverage.
- Documented the distinction between suggestions and automatic fixes.
