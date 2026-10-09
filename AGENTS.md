# Resilient project guidance

Resilient is an ESLint dialect and a TypeScript-to-JavaScript lowering adapter.
Changes must preserve the executable ECMAScript behavior of the source program.

## Reference order

Read the references relevant to the task:

1. [Architecture and accepted work](docs/engineering/REARCHITECTURE.md) for the
   current baseline and verification history.
2. [Agreement map](docs/reference/AGREEMENT_MAP.md) to find the owning grammar,
   policy, semantics, rule, and proof references.
3. [TypeScript lowering algebra](docs/reference/typescript-lowering-algebra.md)
   and [lowering patterns](docs/reference/typescript-lowering-patterns.md) for
   adapter changes.

Historical plans, handoffs, and lint inventories provide context. They do not
authorize new work or override the applicable references or the user's request.

## Implementation principles

For a transformer change, follow the path from source grammar and policy
through ECMAScript semantics and checker facts to lowering grammar, placement,
and proof. Record checker-backed facts before choosing a policy outcome; later
passes must preserve that outcome.

Before choosing a lowering, identify the input owner, expected result, failure
owner, and source observables. Preserve evaluation count and order, getter and
call timing, receiver binding, iterator behavior, native failure phase,
key/value identity, callback and argument order, mutable-builder identity, and
direct-return ownership. Do not fabricate defaults, aliases, callbacks,
containers, result values, exceptions, or a second origin system. Any local
exception needs its exact rule and semantic reason beside the retained code.

Transformer implementation normally belongs in `transforms/typescript/**` with
the corresponding tests. Do not hand-edit generated artifacts or proof corpora.
Treat `rules/contracts/**` as the independent agreement-model reference, not a
convenience layer for the adapter. For dialect or rule changes, read the owning
rule page and closest reference implementation; cover valid, invalid, and
boundary behavior in tests and fixtures.

Use focused proofs while developing. A completed behavioral change needs the
relevant runtime, lint, fixture, and corpus evidence before claiming acceptance.
Measure a claimed lint improvement against the same baseline and report any
other-family regression. Preserve old lawful lowering until its replacement
has equivalent behavior and evidence.

## Verification

When a material implementation, rule, policy, configuration, fixture, or test
change is ready for acceptance, run the repository gate:

```text
npm test
npm run fixtures:check
npx eslint . --ignore-pattern tests/fixtures
git diff --check
```

Run each command so its failure cannot be hidden by a later success. Repair a
failure and repeat the gate before relying on a corpus measurement. Focused
tests, generated lint, or fixed output do not replace this gate.

For an instruction or editorial-only change, inspect the diff, check links and
claims against their sources, and run `git diff --check`. Run a relevant
documentation check if one exists. This lighter path does not apply to changes
in executable behavior, dialect policy, configuration, fixtures, or tests.

Before corpus work, consult the [runtime compatibility notes](docs/engineering/REARCHITECTURE.md#runtime-and-future-work-notes).
Use a supported Node version and verify native dependency architecture before
expensive proof runs.

## Repository discipline

Preserve unrelated and user-owned changes. Never use a broad reset or cleanup.
Do not infer dialect rules from lint counts, TypeScript defaults, or generated
artifacts. Keep task-specific execution plans, file allowlists, evidence paths,
and phase decisions in their owning plan or handoff rather than this file.
