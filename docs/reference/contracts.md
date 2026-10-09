# Contract ownership and public APIs

An agreement compares owned producer evidence with an independently supplied
consumer requirement. Requirements do not supply values. Unknown contributions
remain visible beside established evidence, including contradictions. The
[algebra](resilient-algebra-invariants-generic.md) explains the laws;
[architecture](../engineering/architecture.md) defines current ownership and
validity. This page maps the current API rather than the retired contract graph.

## Agreement owners

Import these operations from `eslint-plugin-resilient/agreement`. The
[public export file](../../analysis/agreement/index.js) is the API boundary;
internal storage and traversal representations are not public contracts.

| Operation | Responsibility |
| --- | --- |
| `fromESTree`, `familyEvidence`, `unresolved`, `absent` | Construct supported source evidence, explicit incomplete evidence or established absence. `fromESTree` snapshots the supported structure rather than retaining a mutable caller AST. |
| `createOwner`, `reference`, `producer`, `record`, `createContext` | Own evidence and represent supported producer relationships and context. A handle's identity cannot be replaced by matching names or shapes. |
| `family`, `content`, `field`, `all`, `receiver` | Describe the consumer's required facet or composition. They do not establish successful execution or validate an input. |
| `readFamily`, `readField` | Read owned producer facts independently of a particular consumer judgment. |
| `request` | Judge a requirement against its source owner and premises. |
| `replaceEvidence`, `replaceAll` | Revise owned evidence explicitly; batch replacement validates before committing. |
| `isCurrent`, `inspect` | Check judgment validity and inspect its historical outcome. Reading a stale judgment's status throws. |

Previously returned immutable facts remain historical data after a revision;
read the owner again for current facts. Dependent judgments become stale before
observers run. Cycles need grounded contributions and cannot prove their own
missing premise. A request establishes only the selected facet under its owned
premises, not termination, arbitrary external data or every dialect rule.

## JavaScript analysis sessions

Import `createAnalysis` or `createProgramAnalysis` from
`eslint-plugin-resilient/analyzer`. `createAnalysis` parses source with Espree;
`createProgramAnalysis` accepts a valid host-supplied ESTree Program. Both return
a session with immutable descriptor collections and indexed queries. Descriptor
indices belong to that session, not a global graph or edited source file.

The [diagnostic guide](../guide/diagnostic-explanations.md#query-the-current-analysis-model)
demonstrates the API and maps descriptors to queries. Supported questions include
receiver families, destructuring and field presence, calls and their results,
producer returns, declarations, signature extraction, invocation and promise
ownership. These are bounded questions, not an exhaustive runtime interpreter.

Keep producer summaries and actual call observations separate. A function's
normal-return consistency is not a promise derived from one chosen invocation.
Normal undefined, an unknown normal value and no normal completion have distinct
meanings. Parser, resolver, observer and exhausted-limit failures do not become
successful unknown results. Use a new session after changing source, dependency
text or parser output. See [source selection](tree-resolution.md) for the module
closure and the distinction between configured inventory and active evidence.
The optional `roots` input supplies additional source snapshots; the session's
frozen `files` list records acquired filenames. ESLint activates explicit or
adapter-selected roots through the same module owner.

## Hosts and compiler inputs

ESLint rules consume the shared analyzer through `eslint-plugin-resilient/eslint`.
Configured severities and messages belong to ESLint; direct analyzer queries do
not load the consumer's ESLint configuration. The root parser owns its supplied
tree, while loaded JavaScript dependencies are parsed with Espree. This does not
establish direct TypeScript/TSX project support.

[TypeScript acquisition and lowering](../engineering/typescript.md) use compiler
requirements without treating annotations as runtime facts. Compiler acquisition
is exported at `eslint-plugin-resilient/analyzer/typescript`; rewriting at
`eslint-plugin-resilient/typescript`. Its [lowering contracts](typescript-lowering-algebra.md)
keep evidence, policy and grammar ownership distinct.

The predecessor's `./contracts` documents, persistent Project Tree API, graph IDs
are not current exports. The installed `resilient-inspect` command explains a
selected source location through the current session; see the
[diagnostic guide](../guide/diagnostic-explanations.md#current-inspection-boundaries).
Use [rule pages](../rules/) for
policy and functional coverage and the [feature review](../engineering/feature-review.md)
for migration gaps. No current API needs the predecessor or archived records.
