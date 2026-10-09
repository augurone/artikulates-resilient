# Agreement reference map

This map prevents the Resilient algebra from becoming a set of competing
documents. It names one question per reference and the order in which an
implementation task resolves it.

## Authority chain

```text
generic agreement algebra
  → ECMAScript algebra and invariants
    → executable Grammar / Policy / Semantics
      → proof obligations
        → TypeScript lowering algebra
          → lowering pattern catalog
            → checker facts, policy agreements, grammar placement, proof
```

Each layer constrains the layer below it. A lower layer may make a law
executable or document adapter evidence; it may not revise the higher law.

| Question | Authority | Not the authority |
| --- | --- | --- |
| What is an agreement, falsification, unknown, resolver, or return obligation in any language? | [Generic algebra](resilient-algebra-invariants-generic.md) | A rule page, adapter, or corpus result |
| What do those obligations mean for ECMAScript runtime families and operations? | [ECMAScript algebra and invariants](resilient-algebra-invariants.md) | TypeScript checker output |
| Which executable source forms express the agreement? | [Grammar](grammar.md) | A lint autofix |
| Which outcomes, boundaries, and exceptions are legal? | [Policy](policy.md) | A lower lint count |
| What observable behavior must survive a rewrite? | [Semantics](semantics.md) | A generated artifact alone |
| What must a proof demonstrate? | [Agreement proofs](resilient-proofs.md) | A passing happy-path test |
| How does TypeScript evidence enter the adapter without becoming a second inference system? | [TypeScript lowering algebra](typescript-lowering-algebra.md) | A corpus-specific heuristic |
| Which repeated adapter shapes already have a proved implementation recipe? | [TypeScript lowering patterns](typescript-lowering-patterns.md) | A new syntax guess |
| How does analyzer evidence differ from adapter evidence? | [Contracts reference](contracts.md) | Transformer convenience |

## Decision procedure

For every lowering, answer these questions in order:

1. What agreement and failure ownership apply? Read generic and ECMAScript algebra.
2. What source behavior is observable? Read Semantics and the relevant proof.
3. What grammar and policy result are legal? Read Grammar and Policy.
4. What checker-backed fact enters Understand? Read the lowering algebra.
5. Is there an existing proved adapter pattern? Use it; otherwise add one only
   after a focused proof establishes the law.
6. Does placement preserve the observables? If not, retain one exact boundary
   or reject the candidate; never fabricate a value to make it fit.

## Accepted execution record

- [REARCHITECTURE.md](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/REARCHITECTURE.md) records the accepted
  authored-project baseline, replacement and purge evidence, and remaining
  boundaries.
- [Resilient architecture ownership and refactor method](research.md#resilient-architecture-ownership-and-refactor-method)
  is shipped as historical design context. Current ownership and remaining
  boundaries are consolidated in the acceptance record above.
- Historical handoffs, lint triage, and the product roadmap provide context but
  never override the accepted record or normative dialect references.
