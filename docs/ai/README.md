# Writing and maintaining Resilient

The [coding standards](CODING_STANDARDS.md), [Grammar](../reference/grammar.md),
[Policy](../reference/policy.md) and [Semantics](../reference/semantics.md) are
the frozen language requirements. Apply them with this package's [AGENTS.md](../../AGENTS.md).
The [writing guide](writing-resilient.md) connects those requirements to the
current project; the [migration playbook](../guide/migration-playbook.md) gives
practical patterns and the [diagnostic guide](../guide/diagnostic-explanations.md)
explains findings.

## Current implementation pointers

The frozen coding standards retain historical references to `rules/contracts`
and a predecessor provider tree. Those names identify former implementation
locations. Use these current owners when locating a proven mechanism:

| Responsibility | Current owner |
| --- | --- |
| Evidence, requirements, judgments and revisions | [Agreement](../../analysis/agreement/index.js) |
| JavaScript acquisition, execution and demand | [Analyzer](../../analysis/analyzer/index.js) |
| ESLint policy and shared-analysis consumers | [Rules](../../analysis/eslint/index.js), [rule documentation](../rules/) |
| Compiler evidence, policy and emission | [TypeScript transformation](../engineering/typescript.md), [pattern taxonomy](../reference/typescript-lowering-patterns.md) |
| Cross-layer ownership and validity | [Architecture](../engineering/architecture.md), [agreement map](../reference/AGREEMENT_MAP.md) |

This mapping leaves the frozen requirements intact. It does not authorize
restoring retired analysis or importing another checkout. Historical documents
and essays do not establish feature coverage. Check the [feature review](../engineering/feature-review.md)
before assuming an old command, parser route or proof API exists.
