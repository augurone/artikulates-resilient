# Language and agreement references

[Grammar](grammar.md), [Policy](policy.md), [Semantics](semantics.md) and the
[coding standards](../ai/CODING_STANDARDS.md) retain their frozen bytes and
remain the normative dialect. The [agreement map](AGREEMENT_MAP.md) connects
their questions to the supporting references and current implementation.
Requirements and proof obligations do not imply complete analyzer coverage.

| Question | Reference |
| --- | --- |
| What are agreement, defaults, operational families and normal-return laws? | [Generic algebra and ECMAScript realization](resilient-algebra-invariants-generic.md) |
| What must a claim or transformation demonstrate? | [Agreement proofs](resilient-proofs.md) |
| Where do validation, identity and conditional totality belong? | [Boundary agreement](resilient-boundary-agreement-contractual-totality.md) |
| Who owns asynchronous resolution and rejection? | [Async resolution ownership](resilient-async-resolution-ownership.md) |
| Which agreement and analyzer APIs exist now? | [Contract ownership and APIs](contracts.md) |
| Which files contribute evidence to an analysis? | [Source selection and resolution](tree-resolution.md) |
| How does TypeScript intent enter lowering? | [TypeScript boundary](typescript.md), [lowering contracts](typescript-lowering-algebra.md) |
| Which lowering families have current owners and functional evidence? | [Lowering pattern taxonomy](typescript-lowering-patterns.md) |
| How should shared mechanisms and refactors be evaluated? | [Architecture ownership and refactor method](research.md) |

The predecessor's separate ECMAScript invariant catalog is consolidated into
the algebra's [ECMAScript realization](resilient-algebra-invariants-generic.md#ecmascript-realization).
Original references are preserved as historical records; current references
remove retired APIs and distinguish language obligations from supported paths.

Use the [engineering guides](../engineering/README.md) for actual ownership and
verification, [rule pages](../rules/) for policy and functional test owners, and
the [feature review](../engineering/feature-review.md) for known gaps. The
[migration playbook](../guide/migration-playbook.md) and
[diagnostic guide](../guide/diagnostic-explanations.md) apply these requirements
to consumer code. No active reference requires another checkout or the archive.
