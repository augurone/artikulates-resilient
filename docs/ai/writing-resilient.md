# Writing Resilient in this project

Start with the source's observable contract and the existing owner of its
evidence. The four foundation principles are agreement, identity and ownership,
demand, and change. Use [Grammar](../reference/grammar.md),
[Policy](../reference/policy.md), [Semantics](../reference/semantics.md) and the
[coding standards](CODING_STANDARDS.md) for dialect requirements.
The [AI guide index](README.md) maps historical implementation pointers in the
frozen standards to this package's current owners.

Use the current [architecture and analysis contracts](../engineering/architecture.md) to locate the mechanism before
adding one. Consumers use `eslint-plugin-resilient/agreement`, `eslint-plugin-resilient/analyzer` and
`eslint-plugin-resilient/eslint`. Historical graph, cache and contract
representations do not select the current implementation.

Preserve known, contradictory and unknown evidence. A missing fact must not
erase a known contradiction. Operational failures remain failures. Defaults
must express authored behavior and must not fabricate validation, values or
callbacks. Natural absence belongs at its actual boundary.

Use shared collection and traversal utilities for private mutation or dynamic
worklists. Preserve callback arguments, sparse slots, order and failure behavior
when choosing collection methods. A necessary local exception identifies its
exact rule, operation and semantic reason under Policy P-03. Inline severity
overrides and blanket disabling are rejected; unused exceptions fail lint.

Run `npm run check` for lint, exception enforcement, maintained tests and a normal
isolated installation of this package. Tests and their source-text fixtures
exercise the new implementation. There is no independent legacy checker or
historical corpus campaign in the active gate. Preserve behavior assertions and
fixture identities; changes need an explicit source counterexample and review.
TypeScript acquisition and lowering follow the [TypeScript guide](../engineering/typescript.md).
The [feature review](../engineering/feature-review.md) records known product
gaps; [verification guidance](../engineering/README.md) defines acceptance.
Archived engineering records are removable history, not active instructions.
