# Resilient roadmap

This document describes proposed, unimplemented, and scoped product work. The
README, semantics, coding standards, contract documentation, and rule pages
describe the current implementation boundary.

Roadmap items are proposals, not shipped capabilities or release promises.
The order below is intentional: Resilient should first prove that its signal
is useful, then make evidence and boundaries operational, and only afterward
grow its integration surface.

## North star: executable contracts with honest uncertainty

Resilient's initial intent is not to recreate TypeScript or prove every
possible JavaScript behavior. It is to make contracts already expressed by
executable ECMAScript visible, report contradictions when source evidence
supports them, and preserve unknown external data as unknown.

The roadmap therefore protects five invariants:

1. Native JavaScript remains the source of contract intent.
2. Findings identify contradictions, not merely missing static knowledge.
3. Unknown external, dynamic, or unsupported behavior is not silently promoted
   to a fact.
4. Boundaries, transformations, effects, and failure ownership remain visible.
5. The contract core stays independent of ESLint, editors, and frameworks.

## Roadmap operating rules

- **Evidence before expansion.** New semantics should start with a real bug,
  an intentional non-finding, or a consumer workflow that the current model
  cannot express.
- **Adjacent concepts over parity.** Prefer concepts that improve source
  honesty and developer decisions—preconditions, postconditions, evidence,
  effect ownership, and failure paths—over a larger type-language surface.
- **Unknown is a product state.** Every new inference must define what is
  known, what remains unknown, and which external-data or test boundary owns the
  remainder. Resilient does not evaluate runtime data.
- **Claims need a measurement.** Performance, coverage, and correctness
  claims must name their fixture, sample method, and acceptance threshold.
- **Adapters stay thin.** Integrations may supply evidence or presentation;
  they must not fork contract semantics in the core.

## Shipped foundation: 0.5.0

The 0.5.0 project-aware analysis slice is complete. `createProjectTree`
indexes caller-supplied parsed programs, `activate()` constructs an explicit
Active Tree, `analyze()` returns the shared graph snapshot, and
`getInvalidatedFiles()` reports dependent and identity-driven invalidation.
Unchanged analysis documents can be reused outside the invalidation closure.

The release also established project-tree, provider, runtime-boundary, and
ESLint-agreement benchmark fixtures. Residual object contracts, lexical
computed-property reification, runtime-boundary degradation, and clean-run
equivalence are regression-test coverage rather than claims about the shared
benchmark workload. Filesystem discovery, parser-backed loading,
package/workspace aliases, and editor adapters are intentionally not part of
the foundation.

## Shipped contract expansion: 0.6.0

The 0.6.0 release extended the executable contract layer with known closed
object-property checks, direct-literal excess-property checks, local function
arity, higher-order callback arity, first-class function contracts, regular-
expression inference, and explicit optional-callback guards. Object-rest
passthrough and default-based absence semantics remain native JavaScript
contracts rather than annotation features.

## 0.6.2 — self-analysis and open-boundary correctness

The 0.6.2 patch release restores the contract rules for the Resilient source,
scripts, and tests. It also corrects empty-object default inference so an
undeclared defaulted object binding remains safely open, while explicit named
properties and object-rest exclusions retain their intended contract meaning.
The release adds regression coverage for both open defaults and passthrough
calls. No roadmap capability is being claimed here; this is release-hardening
of the existing contract model.

## 0.6.x — prove the signal and stabilize the contract

This remains the immediate priority after the 0.6.2 release. The goal is to
establish whether the analyzer helps on real code before adding more
inference.

The 0.6.x line also extends known closed-object property checks into
destructuring. Defaults continue to express intentional absence, and object
rest continues to preserve open passthrough rather than inventing a finding.

- [ ] Build a small corpus of real bugs, near-misses, and intentional
  non-findings. Record the source pattern, expected result, diagnostic quality,
  and whether the external-data boundary or a test is the correct owner.
- [ ] Publish a support matrix for value, control-flow, effect, and failure
  contracts, including known, unknown, and contradictory outcomes.
- [ ] Measure diagnostic quality: false positives, useful locations, stable
  ordering, determinism, and explainability of the evidence chain.
- [ ] Turn representative regressions into a maintained fixture gate. Keep
  residual-property and computed-property cases in that gate even when they
  are not part of the shared performance benchmark.
- [ ] Add a repeatable real-project benchmark with clearly named fresh and
  reused samples. Keep synthetic fixture measurements separate from the real
  project comparison and do not publish unsupported percentage claims.
- [x] Harden release and compatibility behavior: stable public contracts,
  semver notes, package contents, clean-run equivalence, and CI verification.
- [ ] Use consumer feedback to revisit mutation false positives and the
  ergonomics of explicit boundary exceptions.

Exit evidence: at least two representative projects or repositories, a
reviewable bug/non-finding corpus, a documented support matrix, and a measured
diagnostic/performance baseline with no ambiguity between fixture and real-code
results.

## 0.7.0 — green-edge compatibility baseline

The 0.7.0 release establishes the green-edge development baseline: ESLint 10
contract analysis, the Node runtimes supported by that host, CI verification,
dependency-freshness reporting, and the regression hardening required to keep
the analyzer alive across incomplete AST boundaries. This is release
infrastructure and compatibility work; it does not claim the contract-evidence
capability below.

## 0.7.1 — contract-evidence slice

The next release should bundle the current release-hardening and documentation
changes with the first contract-evidence implementation. The current
changes do not independently warrant a version release. The implementation
plan is [`docs/engineering/evidence-model-plan.md`](evidence-model-plan.md).

The external-data boundary is already an existing product boundary, not a new
runtime feature. This release should make the source evidence, expected
contract, and external-data ownership inspectable. It should not evaluate
runtime data, add a runtime dependency, import validator results, or create a
second schema language.

Release evidence is stable serialized provenance, direct API inspection,
source/data-boundary fixtures, and proof that evidence does not leak across
path, identity, mutation, or unknown boundaries.

The first implementation is now present in the unreleased working tree:
contract documents expose evidence lookup, diagnostics carry evidence IDs,
graphs aggregate file-qualified evidence, and analysis snapshots retain the
aggregate list. The remaining release work is to broaden path and identity
coverage without changing the static-only runtime boundary.

## 0.7.1+ — contract evidence expansion

The next adjacent area is extending the inspectability of source contracts and
external-data ownership. Resilient remains a static analyzer; it does not
evaluate runtime values or enter client runtime dependencies.

- [ ] Extend the 0.7.1 evidence model through source-declared external
  boundaries and possible failure ownership. Preserve visible source and scope
  for each fact without evaluating the data.
- [ ] Model boundary notation for external, dynamic, unresolved, and
  unsupported data origins. A boundary marker remains unknown evidence and
  carries no Resilient runtime dependency.
- [ ] Add source/data-boundary fixtures: the same declaration should show what
  static analysis can prove, what remains unknown, and which data boundary owns
  a possible runtime failure.
- [ ] Explore documentation output that explains a contract's evidence path
  and its unresolved boundaries for code review and maintenance.

Exit evidence: source declarations and external-data ownership are inspectable,
unknown data remains unknown, and no runtime validator or client dependency is
required.

## 0.8 — adjacent contract concepts and developer leverage

Once the evidence model is stable, explore concepts that make the original
contract intent more useful in design and review.

- [ ] Add an IDE contract-visibility track for VS Code and other JavaScript
  editors. Make Resilient's known function, value, return-path, and boundary
  contracts available where native editor inference widens them to `any`, and
  keep editor hovers, navigation, and diagnostics consistent with the ESLint
  and contract-document results. Evaluate a thin editor or language-server
  adapter rather than adding TypeScript syntax, a runtime validator, or an
  editor dependency to the contract core.
- [ ] Explore design-by-contract views: preconditions, postconditions, and
  invariants derived from existing guards, defaults, returns, and failure
  paths. Keep these as explanations and checks over native code, not a new
  annotation language by default.
- [ ] Explore refinement-like facts for values and collections, with an
  explicit rule that refinements weaken across unknown calls, mutation, and
  escaping references.
- [ ] Explore typestate/state-machine views for resources and lifecycle
  boundaries where the code already expresses states—such as opened/closed,
  authenticated/unauthenticated, or pending/settled.
- [ ] Make effect ownership more explicit: identify who owns mutation,
  transformation, cleanup, cancellation, and side-effect sequencing.
- [ ] Make failure semantics reviewable across async calls, aggregation,
  retries, `try`/`catch`/`finally`, and rethrows, including the distinction
  between handled, propagated, and intentionally ignored failures.
- [ ] Add machine-readable inspector output and review-oriented diagnostics so
  CI, pull requests, and future editor integrations consume the same contract
  document.
- [ ] Explore change-impact explanations using the existing dependency and
  invalidation graph: what changed, which providers were affected, and why a
  finding appeared or disappeared.

Exit evidence: these views explain existing executable contracts and improve
review decisions without requiring TypeScript-style declarations or changing
the core's known/unknown/contradictory semantics.

## 0.9+ — integration and ecosystem adapters

These items are valuable only after the core signal, evidence model, and
diagnostic format are stable.

- [ ] Add a thin CLI/inspector workflow, including a first-run configuration
  command such as `npx resilient init`.
- [ ] Add project resolution through a resolver boundary for common package,
  workspace, and alias layouts. Unsupported dynamic and external edges remain
  unknown until evidence exists.
- [ ] Add parser-backed project loading and filesystem discovery as adapters,
  with explicit parser/config identity in snapshots.
- [ ] Add GitHub Action and pull-request output based on stable machine-readable
  diagnostics.
- [ ] Add an editor or language-server adapter for the contract document API
  only when a concrete consumer workflow justifies the protocol surface.
- [ ] Document migration paths and maintain a small example repository that
  demonstrates source contracts, data-boundary ownership, and intentional
  non-findings.
- [ ] Add an AI adopter evaluation harness using isolated tasks derived from
  `tests/fixtures/bad.js`, rule tests, integration fixtures, the standards, and
  the migration playbook. Compare cold, standards, and playbook-assisted runs
  for diagnosis, behavior-preserving repair, suppression avoidance, and
  correct handling of unknown and runtime-owned boundaries.
- [ ] Publish an AI coding guide, evaluation corpus, and reusable constitution
  examples only after the support matrix, evidence vocabulary, and adopter
  evaluation results are stable.

Exit evidence: integrations consume the same snapshot and diagnostics as the
ESLint path, project loading preserves identity and invalidation semantics, and
at least one end-to-end consumer workflow is maintained in CI.

## Continuous exploration

Inference improvements remain welcome when they are driven by evidence. Good
candidates include common computed-property forms, residual object behavior,
collection and async control flow, and runtime-boundary patterns found in the
bug corpus. Each candidate should ship with a minimal reproducer, an explicit
unknown/contradiction decision, and a regression test before it becomes a
roadmap commitment.

## Explicit non-goals

The following are outside the project's initial intent unless new evidence
materially changes the product boundary:

- TypeScript parity, declaration-file compatibility, or a general-purpose type
  language covering generics, inheritance, decorators, and every library type.
- A Resilient-owned runtime schema or annotation language.
- Whole-program proof, arbitrary dynamic-value prediction, or runtime data
  evaluation and validation.
- A Resilient runtime package dependency in a client application.
- Ownership of React, JSX, framework routing, accessibility, product naming,
  or application architecture.
- Guessing unresolved dynamic imports, external APIs, or filesystem behavior
  without explicit evidence.
- Editor protocol complexity before a concrete editor workflow demonstrates
  that it is worth maintaining.
