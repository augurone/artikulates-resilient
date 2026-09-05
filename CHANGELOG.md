# Changelog

## Unreleased

## 0.7.1 — 2026-09-04

- Added the first static contract-evidence slice to the document API. Evidence
  records expose stable source ranges, scopes, contract shapes, derivation IDs,
  and external-data boundary ownership without serializing raw AST nodes.
- Added provenance regression coverage for parameter defaults, operations,
  return paths, native guards, and unknown SDK-style calls.
- Added the published `resilient-inspect` CLI and automatic compact evidence
  hints to contract diagnostics by default, with
  `settings.resilient.evidenceMessages: false` available for minimal lint output.
- Extended `no-length-comparison` to reject zero/non-zero presence comparisons
  such as `length > 0` and prefer direct length truthiness while preserving
  exact cardinality checks.
- Kept the release entirely static: Resilient does not evaluate runtime data,
  integrate runtime validators, or add a runtime client dependency; external
  data failures remain owned by the application boundary.

## 0.7.0 — 2026-09-04

- Restored ESLint 10 contract analysis by reading `context.filename`, while
  retaining a narrow fallback for hosts that still expose `getFilename()`.
- Corrected project-tree invalidation so changed program identities invalidate
  the affected file and its dependents instead of comparing the previous
  snapshot to itself.
- Hardened recursive AST parent walks with `hasObjectValue` termination checks,
  including regression coverage for incomplete synthetic nodes.
- Aligned the package engine, lockfile, documentation, and CI matrix with the
  Node runtimes supported by ESLint 10.
- Added an informational post-lint `npm outdated --long` report with bounded
  registry retries, so dependency drift is visible without masking lint or
  release-check failures.

## 0.6.2 — 2026-09-03

- Removed the accidental self-analysis exemption for the contract rules;
  Resilient now lint-checks its own source, scripts, and tests under the same
  contract preset used by consumers.
- Removed the redundant standalone return-consistency configuration because
  that rule is already included in `resilient.configs.contracts`.
- Corrected empty-object default inference so an undeclared defaulted object
  binding remains an open, unknown-preserving boundary instead of becoming a
  falsely closed empty object.
- Preserved explicit named-property and object-rest semantics while carrying
  open object contracts through conditional expressions, logical fallbacks,
  aliases, calls, and returned values.
- Replaced internal no-op callback defaults with explicit guards where the
  callback is optional, keeping analyzer and rule implementation behavior
  aligned with the dialect's callback policy.
- Centralized object-record validation in the shared `isObject` and
  `hasObjectValue` utilities instead of repeating weak `typeof` checks.
- Extended `no-null-assignment` to report explicit nulls inside assigned
  conditional, logical, object, array, and nested-assignment expressions.
- Added regression coverage for open defaults and passthrough call sites.
- Added the repository formatting contract to both the exported recommended
  config and the local ESLint config: autofixable whitespace and final-newline
  cleanup, tight function and control-flow braces, padding after `if`
  statements, padding before returns, and redundant-return rejection.
- Expanded `tests/fixtures/bad.js` and the existing rule tests across aliases,
  higher-order calls, arity, excess properties, operation mismatches, property
  access, and asynchronous return contradictions; fixture coverage now verifies
  all 22 public rule highlights and 5 integration fixtures.
- Clarified that statically named missing properties are contract violations,
  while computed property keys remain data-driven; computed destructuring with
  an explicit default is valid boundary code.
- Strengthened `prefer-destructured-member-access` to inspect nested
  destructured bindings, local bindings, and computed member lookups; prototype
  operations remain explicit exceptions.

## 0.6.1 — 2026-09-02

- Added a rule-by-rule migration playbook in `docs/guide/migration-playbook.md` to
  give the rule set a concrete adoption path and future fix backbone.
- Added known closed-object missing-property diagnostics for object
  destructuring, while preserving defaults as intentional absence handling and
  object-rest passthrough as an open boundary.

## 0.6.0 — 2026-09-02

- Expanded the opt-in contract diagnostics with known closed-object property
  access checks, known-local function arity checks, and direct-literal excess
  property checks.
- Extended known-local arity checks through higher-order callback invocations,
  including inline and member-function callbacks while preserving callback rest
  parameters as passthrough arguments.
- Preserved object-rest passthrough semantics at call sites: a signature with
  `{ known, ...rest }` remains open, accepts extra direct-literal properties,
  and keeps the residual object contract available for later analysis.
- Strengthened `no-unhandled-promise-chain` to report dropped calls to known
  local promise-producing functions while preserving explicit ownership via
  `await`, `return`, assignment, `.catch()`, or `void`.
- Clarified that omitted object properties are compatible with Resilient's
  default-based absence semantics; required function parameters are enforced
  through arity rather than required object-field diagnostics.
- Clarified the dialect boundary with TypeScript: generic parameters, literal
  unions, and discriminated-union annotations are outside Resilient's
  ECMAScript grammar, while incompatible known families remain contradictions
  rather than being widened into unions.
- Documented that inferred return families and downstream contract boundaries
  provide the practical coverage of return-assignability checks without adding
  a separate return-annotation language.
- Added `no-unguarded-callback-invocation`, requiring `isFunction` or an
  equivalent `typeof ... === 'function'` guard before invoking an optional
  destructured callback; omitted callbacks remain real `undefined` values.
- Kept directly invoked callback bindings out of the generic destructuring
  default requirement so callback absence is handled by the explicit guard
  rule rather than by synthetic no-op defaults.
- Promoted functions to a first-class contract family: known signatures now
  travel through aliases, object properties, and returned functions, with
  downstream call-site and return-family checks preserving the evidence.
- Added implicit `regexp` value inference for regular-expression literals and
  boolean results from native `.test()` calls.
- Kept excess-property inference strict for empty object defaults; open value
  bags must now declare nested object rest explicitly, such as
  `variables: { ...variables } = {}`.
- Added an inference-depth boundary so recursive or higher-order function
  values become unknown at the recursion edge instead of causing analysis
  overflow.

## 0.5.0 — 2026-08-31

- Added a caller-supplied Project Tree with source identity, forward and
  reverse dependency edges, resolver outcomes, unknown-edge preservation, and
  explicit Active Tree activation.
- Added shared analysis snapshots consumed by both the contracts API and the
  ESLint contract rules, including deterministic agreements and diagnostics.
- Made ESLint project analysis activate lazily and transparently on the first
  contract-rule invocation, with subsequent contract rules reusing the same
  graph state and no consumer lifecycle API.
- Added dependent and parser/config/resolver-identity invalidation with
  conservative reuse of unchanged analysis documents across snapshots and
  clean-run equivalence coverage.
- Added residual object contracts for object rest, spread ordering, excluded
  keys, and known lexical computed properties without inventing unknown values.
- Optimized the measured AST traversal hotspot with narrowly scoped private
  accumulators, preserving the default mutation discipline and exact analysis
  results.
- Consolidated and clarified internal mutation exceptions for traversal indexes,
  identity registries, return evidence, and bounded caches; LRU behavior remains
  explicit and unchanged.
- Added shared-provider, runtime-boundary, active-set, invalidation, and reuse
  benchmark fixture coverage. A real-project performance comparison remains a
  separate release-gate measurement.

## 0.4.3 — 2026-08-28

- Corrected flow narrowing for strict and loose inequality predicates,
  reversed literal comparisons, reversed `typeof` comparisons, and negated
  nullish checks so known defaults do not leak into the wrong branch.
- Added regression coverage for the negative-predicate matrix.
- Checked known conditional and logical value branches at native operation
  boundaries instead of analyzing only the collapsed expression result.
- Preserved contracts through local destructuring before a function return.
- Preserved contradiction state and conflicting families through downstream
  calls instead of silently collapsing incompatible returns to unknown.
- Distinguished tuple positions from homogeneous collection elements so
  internal entry-pair transforms remain valid while mixed collection values
  remain falsifiable.
- Passed actual collection-element contracts into callback-body operation
  checks, exposing invalid transforms such as a number reaching a string
  operation.
- Corrected logical-expression inference so short-circuit results retain both
  possible operand contracts.
- Recognized native `String`, `Number`, and `Boolean` coercions as explicit
  normalization contracts, and recursively resolved nested promise wrappers
  at `await` boundaries.
- Hardened async return-path analysis against bare `return;` AST arguments so
  linting cannot crash on a valid JavaScript completion path.
- Clarified the documented boundary between propagated unknown contracts and
  contradiction diagnostics, and listed return consistency in the enforcement
  map.
- Removed a stale README link to a roadmap document that is not part of the
  package.

## 0.4.2 — 2026-08-28

- Reconciled contract documentation with the single-family return rule and
  clarified that absence is an explicit boundary concern, not an internal
  union escape hatch.
- Corrected return-family analysis for async functions by comparing resolved
  return values and using path-sensitive flow contexts for guarded returns.
- Added graph coverage proving contradictory provider returns remain unknown
  rather than being guessed into a union while argument contracts propagate.

## 0.4.1 — 2026-08-28

- Strengthened the contracts preset to reject known incompatible
  return families, including expression-bodied conditional returns,
  rather than widening them into unions.

## 0.4.0 — 2026-08-27

- Extended contract signatures and call-site diagnostics to cover all known
  formal parameters and corresponding arguments.
- Added a program-scope flow context so top-level declarations, aliases,
  returned object properties, and destructured bindings remain contract-visible.
- Stabilized direct local return propagation across function-definition order.
- Stabilized transitive local export propagation across named re-export barrels,
  `export *` barrels, and finite re-export cycles.
- Propagated imported definitions into local wrapper return contracts, including
  anonymous default exports.
- Added import-tree agreement records for resolved, missing, ambiguous, and
  unknown local imports, with namespace import and namespace re-export support.
- Added recursive nested object and array destructuring diagnostics.
- Aligned source-stack queries with known call-expression contracts.
- Made the agent fixture check behavioral by requiring each labeled rule section
  to produce its matching diagnostic.
- Added an opt-in `imports` preset backed by `eslint-plugin-import` for generic
  unresolved-path, named-export, namespace, and duplicate-export checks.
- Propagated callable aliases and promise-shaped async returns through local
  and imported contract analysis, with `await` unwrapping.
- Propagated known elements through `Promise.resolve` and `Promise.all`, and
  checked known callback arguments at higher-order call sites.
- Added inline callback agreement at known array-operation boundaries, with
  derived `map`, preserved `filter`, boolean `some`, accumulator-safe `reduce`,
  and explicit `forEach` result contracts. `find` remains conservative when
  its absence path is not proven.
- Added a project-graph manager shared by contract ESLint rules, with resolver
  and parser-aware reuse plus dependency-file-state invalidation and exposed
  cache statistics.
- Bounded parsed-program and project-graph retention with LRU eviction, exposed
  combined cache reset, and cache lifecycle coverage for long-lived ESLint
  hosts.
- Reduced allocation churn in signature and stack inspection traversal
  accumulators while preserving immutable contract outputs and explicit,
  line-local safety-rule explanations for the mutable boundaries.
- Expanded negative-first fixtures with end-to-end barrel, top-level retained
  and destructured values, async returns, callback arguments, and explicit
  resolved/missing/ambiguous/unknown graph agreements.

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
