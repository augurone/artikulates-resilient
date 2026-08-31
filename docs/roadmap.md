# Resilient roadmap

This is the document for proposed, unimplemented, and scoped product work. The
README, semantics, coding standards, contract documentation, and rule pages
describe the current implementation boundary.

Roadmap items are proposals, not shipped capabilities or release promises.

## 0.5.0 — project-aware analysis

- Acceptance benchmark: [`0.5.0-benchmark.md`](0.5.0-benchmark.md). The
  release is complete only when the benchmark proves Active Tree correctness,
  residual contract preservation, invalidation/reuse, ESLint agreement, and
  an observable performance baseline.
- [x] Add a caller-supplied Project Tree/index for project files, parser/config identity,
  resolver outcomes, forward edges, and reverse dependents.
- [x] Expose Active Tree activation as an explicit analysis input while keeping
  unused indexed files inactive by default.
- [x] Add project-aware invalidation for changed providers, barrels, resolver
  behavior, parser options, and relevant configuration.
- [x] Expose a stable analysis snapshot API that the existing ESLint rules can
  consume without duplicating inference or diagnostic semantics.
- [x] Add project fixtures and benchmarks for active-set boundaries, unknown
  edges, dependent invalidation, deterministic diagnostics, and performance.
- [ ] Support common project/workspace resolution through a resolver boundary;
  unsupported dynamic and external edges remain unknown until evidence exists.

The completed 0.5.0 analysis slice is present in the public contracts API:
`createProjectTree` indexes caller-supplied parsed programs, `activate()`
constructs an explicit Active Tree, `analyze()` returns the shared graph
snapshot, and `getInvalidatedFiles()` reports dependent and identity-driven
invalidation. A later tree can reuse unchanged analysis documents outside the
invalidation closure. Object-rest residual contracts, lexical computed-property
reification, runtime-boundary degradation, and clean-run equivalence are covered
by regression tests. The benchmark fixture suite separately covers the
project-tree, provider, runtime-boundary, and ESLint-agreement workloads; it
does not currently claim residual semantics as a benchmark result. The ESLint
path activates this analysis lazily on the first contract-rule invocation, so
consumers do not manage a separate project lifecycle.

Filesystem discovery, parser-backed loading, package/workspace aliases, and
editor adapters remain separate adapter work. See the benchmark for the
acceptance boundary and explicit non-goals.

## Adapter and tooling work

- [ ] Add an editor or language-server adapter for the contract document API.
- [ ] Add project resolution for package aliases, dynamic imports, and
  filesystem-wide discovery.
- [ ] Add parser-backed project loading and machine-readable inspector output.
- [ ] Add a first-run configuration command such as `npx resilient init`.

## Evaluation and adoption work

- [ ] Add a benchmark of real bugs and intentional non-findings.
- [ ] Add a GitHub Action and review-oriented diagnostic output.
- [ ] Publish an AI coding guide, evaluation corpus, and reusable constitution
  examples.
- [ ] Document migration paths and maintain a small example repository.

## Evidence adapters

- [ ] Evaluate integrations that add evidence from existing runtime schema
  validators without introducing a schema language into Resilient.
- [ ] Revisit mutation false positives and boundary-exception ergonomics using
  real consumer feedback.
