# Design and refactor method

Use this method to improve correctness, fluency, or cost while preserving the
source contract. It introduces no additional language rules or verification gate.
[Grammar](grammar.md), [Policy](policy.md), [Semantics](semantics.md), and the
[coding standards](../ai/CODING_STANDARDS.md) remain normative. The current
[architecture](../engineering/architecture.md) identifies implementation owners.

The [essays](../blogs/README.md) explain the design intent: executable source
provides evidence, agreement relates producers to consumers, unknown remains
unknown, and native forms make those relationships visible. An essay or diagram
does not establish that an implementation supports a particular source shape.

## Keep decision rights explicit

| Responsibility | Question and limit |
| --- | --- |
| Evidence | What does this source establish, under which identity, scope, phase, and revision? Observation grants no policy permission. |
| Requirements | What does this consumer need? An expectation supplies no actual value or runtime validation. |
| Agreement | Which known contributions satisfy or contradict the requirement, and what remains incomplete? |
| Policy | Which form or retained boundary is permitted here, in service of which invariant? |
| Grammar and placement | How is the completed decision expressed at its owned source boundary while preserving its observations? |
| Enforcement | Which established agreement or policy result should be reported, at which source location? |
| Exceptions | Which exact rule is relaxed, over what scope, for what concrete semantic reason? The explanation remains a claim requiring review. |

A later pass consumes a completed decision rather than reclassifying printed
syntax. A field named `action` needs inspection of its meaning: it may describe an
operation, carry a completed decision, or improperly choose policy early. Renaming
the field or copying it into another record does not resolve decision ownership.

## Treat diagrams as logical views

Evidence provenance asks where a fact came from. Agreement asks who offers and
requires what. Derivation asks why a conclusion follows. These are distinct
questions over owned relationships; they do not require three stored graphs.

Start with existing identities, immutable facts, and completed decisions. Add a
representation only when a real consumer needs a relation that cannot be expressed
faithfully there. Logical sharing does not mandate another package, a universal
AST, a persistent cache, or a new public API. Source identity cannot be recovered
from equal names, matching spans in another tree, or generated text.

## Inventory one semantic route

Before changing a mechanism, record the smallest useful account of its route:

- The source shape, source and consumer owners, admitted inputs, lexical identity,
  and normal/failure boundary.
- The facts actually established, their premises, the requirement, and remaining
  unknowns. Keep caller-specific evidence separate from producer promises.
- The owner of the agreement interpretation and finite policy outcome, plus the
  grammar/placement and enforcement consumers that use that outcome.
- The observations a change could affect: Get and call count/order, receiver and
  payload identity, callback arguments, sparse slots, iterator liveness/closing,
  initialization, cleanup, return ownership, and failure phase/identity.
- Existing functional coverage and the exact overlap with the proposed
  replacement. Similar helper names or strings do not establish equivalence.
- Work and storage drivers: acquired nodes, demanded facets, contexts, decisions,
  joins, retained premises, and outputs, including their lifetime and revisions.

Distinguish missing capability from duplicated authority and from policy mismatch.
They need different repairs. A passing lint report cannot decide which problem
exists, and a smaller directory tree cannot establish that a decision was removed.

## Share a semantic contract before an abstraction

Identify the same operation in actual consumers, including its inputs, outputs,
unknown states, identity rules, failure behavior, and composition laws. Extend the
existing owner when it already answers that question. A shared mechanism should
reduce repeated decisions or work while preserving each caller's responsibility.

State the expected work and storage bounds before implementation. Include wide
and successive joins, independent consumers, revisions, and retained results where
they affect the claim. A memo needs explicit ownership, validity, invalidation,
and release behavior. No warm-cache example establishes a general cost bound.
Measure only the question the proposal needs answered; distinguish measured
results from hypotheses about other workloads.

## Replace and remove with observable evidence

Establish the native behavior first for a transformation, naming any deliberate
normalization or source-to-target observation mapping. Exercise the smallest real
positive, guarded, or rejected jobs that establish the requirement, including a
counterexample to the shortcut being removed. Known conflicts must survive beside
unknown evidence. Actual absence, no normal completion, and operational failure
must retain their separate meanings.

Route consumers through the completed owner before removing overlapping code.
Delete an old classifier, helper, cache, test harness, or layer when its useful
contract is covered by the replacement or is explicitly unnecessary. Preserve
non-overlapping behavior. Tests should establish requirements and affected failure
or ownership boundaries rather than mirror private recipes or incidental counts.

Use the existing [verification process](../engineering/README.md). Report the
changed decision, preserved observations, remaining unknowns, deleted machinery,
and relevant cost evidence. Lint cleanliness, behavioral preservation, and a
measured performance change establish different properties.
