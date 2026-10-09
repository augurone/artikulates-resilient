# Documentation

Start with the [package README](../README.md) for installation and configuration.
Use this index for rules, analyzer behavior, measurement, and migration.

## Use Resilient

| Task | Start here |
| --- | --- |
| Install and configure presets | [Package README](../README.md#configure) |
| Learn preferred patterns and migrate existing code | [Migration playbook](guide/migration-playbook.md) |
| Explain a finding and trace its evidence | [Diagnostic explanations](guide/diagnostic-explanations.md) |
| Check rule triggers, options, and exceptions | [Rule pages](rules/) |
| Measure a project or selected targets | [Measurement commands and report fields](../README.md#measure-a-project) |
| Adopt the 0.7.4 rule changes | [Migration summary](../README.md#migrating-to-074), [changelog](../CHANGELOG.md) |
| Write new code in the dialect | [Writing Resilient](ai/writing-resilient.md), [coding standards](ai/CODING_STANDARDS.md) |
| Understand the design choices | [Overcoming objections](guide/overcoming-objections.md) |

The intentionally invalid
[bad.js fixture](https://github.com/augurone/artikulates-resilient/blob/main/tests/fixtures/bad.js)
has labeled examples for every rule. The [package README](../README.md#see-it-work)
shows how to lint it and inspect source evidence from a repository checkout.

## Analyzer and integrations

| Task | Reference |
| --- | --- |
| Query contracts, signatures, source stacks, and evidence | [Contracts API](reference/contracts.md#public-api) |
| Read call-site, destructuring, operation, property, and return diagnostics | [Contracts API](reference/contracts.md#public-api), [diagnostic map](guide/diagnostic-explanations.md#contract-diagnostic-map) |
| Configure aliases, local imports, and project conventions | [Module graph](reference/contracts.md#module-graph) |
| Understand active analysis scope and invalidation | [Tree resolution](reference/tree-resolution.md) |
| Import runtime family and content helpers | [Optional runtime helpers](../README.md#optional-runtime-helpers) |

## Specification

| Question | Reference |
| --- | --- |
| Which source forms express an agreement? | [Grammar](reference/grammar.md) |
| Which rules, presets, and exceptions apply? | [Policy](reference/policy.md) |
| What do source evidence and boundaries mean? | [Semantics](reference/semantics.md) |
| What are the underlying agreement obligations? | [Generic algebra](reference/resilient-algebra-invariants-generic.md), [ECMAScript algebra](reference/resilient-algebra-invariants.md) |
| What must a preservation proof establish? | [Proof obligations](reference/resilient-proofs.md) |
| How do the references relate? | [Agreement map](reference/AGREEMENT_MAP.md) |

Rule pages and guides apply the specification. The contracts reference describes
implemented analyzer support; the proof obligations are a working formalism.

## Maintainers

- [AGENTS.md](https://github.com/augurone/artikulates-resilient/blob/main/AGENTS.md): repository requirements and verification gate.
- [Analyzer and rule ownership](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/REARCHITECTURE.md#analyzer-and-rule-ownership): implementation responsibilities and lifecycle boundaries.
- [Focused tests](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/PROOF_EXECUTION.md#focused-proofs) and [proof coverage](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/PROOF_EXECUTION.md#proof-coverage-and-maintenance): test families, fixtures, and verification surfaces.

Engineering plans, recovery logs, and audit catalogs are maintainer working
material. Consumer behavior is documented in the README, guides, rule pages,
and contracts reference.

## Background and package contents

Read the essays on [DEV — @augurone](https://dev.to/augurone).
[Architecture research](reference/research.md),
[boundary agreement](reference/resilient-boundary-agreement-contractual-totality.md),
and [async resolution ownership](reference/resilient-async-resolution-ownership.md)
provide design context.

The npm package includes this index and the `guide/`, `rules/`, `ai/`, and
`reference/` directories. Engineering records, blog sources, and drafts stay
in the repository.
