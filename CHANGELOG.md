# Changelog

## Unreleased

## 0.3.6 — 2026-08-25

- Added integration fixtures based on real engine structures, including caches,


  API response boundaries, refs, reducers, graph accumulators, and loop control.
- Formalized the agent-facing fixture contract in
  `tests/fixtures/manifest.json`, with one checked highlight for every public
  rule and declared integration diagnostics.
- Added `npm run fixtures:check` and integrated fixture-contract verification
  into tests, linting, and the npm-only release consistency check.
- Documented the fixture workflow and the requirement to update fixtures,
  manifests, tests, and rule documentation together.

## 0.3.5

- Clarified Resilient as a native-JavaScript discipline enforced by ESLint
  rules and extended by contract analysis.
- Formalized the dialect semantics for value, control-flow, transformation, and
  failure contracts, including the distinction between known, unknown, and
  contradictory evidence.
- Added the opt-in `safety` preset with `prefer-safe-transformations`,
  `no-silent-catch`, `no-unhandled-promise-chain`, and warning-level
  `prefer-async-await`.
- Made collection loops explicit exceptions when they contain sequential
  `await`, direct control flow, or a reasoned `resilient-allow-loop` comment;
  documented `Promise.all` as the default for independent async work.
- Added ownership-aware transformation checks so input, shared, and externally
  owned values are protected while intentional boundaries can be configured.
- Moved the intentionally invalid, per-rule agent contracts to
  `tests/fixtures/bad.js` and `tests/fixtures/bad-import-provider.js`.

## 0.3.1 — 2026-08-19

- Added static source-stack introspection through `getStackAtOffset`, exposing
  file, enclosing-function, and expression frames with inferred contracts.
- Added document-level contract diagnostics through `getDiagnostics` and
  `getDiagnosticsAtOffset`; ESLint now consumes the same diagnostic core.
- Added a parser-agnostic module graph for local relative imports and exported
  function contracts, including returned values and returned object properties
  used by importing modules.
- Connected local import propagation to the live ESLint contract rules, so
  imported signatures and returned-value operations report in the consumer
  file.
- Prevented missing named or default exports from becoming empty contract
  definitions during import propagation.
- Added destructuring-shape diagnostics for known array/object contradictions;
  valid nested patterns such as `[ { attr = '' } = {} ] = []` remain allowed.
- Hardened destructuring-shape analysis to allow computed object properties
  on array-like values.
- Added `inspect:stack` as a one-shot contract inspector for source offsets and
  local-import diagnostics. It is not a full ESLint runner or an LSP server.
- Added live import examples to `bad.js` and a file-based ESLint regression for
  imported signatures, returned values, and returned properties.
- No default-preset behavior changed; contract analysis remains opt-in through
  `resilient.configs.contracts`.

## 0.3.0 — 2026-08-18

- Added a portable contract core available from `eslint-plugin-resilient/contracts`.
- Added flow-aware inference for guards, aliases, reassignment, property updates,
  bounded loops, and `try`/`catch`/`finally` paths.
- Added offset-based document queries for contract and signature introspection.
- Added opt-in contract diagnostics for call-site values and native operations.
- Hardened existing rules for `useState` tuples, reducer callback signatures,
  and awaited sequential loops.
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
