# Agreement algebra and invariants

This reference retains a language-independent vocabulary for agreement and its
ECMAScript interpretation. It states semantic obligations, not a complete type
theory, an inference algorithm, or a claim of implementation coverage.
[Grammar](grammar.md), [Policy](policy.md), and [Semantics](semantics.md) remain
the normative ECMAScript dialect. The equations below explain their obligations;
they neither add source syntax nor authorize stronger assumptions than execution.

## Generic vocabulary

| Symbol | Meaning |
| --- | --- |
| `T` | A promised operational contract: family, shape and capabilities; success/content is interpreted at its boundary. |
| `T+` | A positive realization of that contract. |
| `D(T)` | A declared falsifiable value realization, where that contract admits one. |
| `C(T)` | The complete positive/negative value agreement. |
| `U` | Unresolved evidence, not a special runtime value. |
| `∅` | Absence admitted or excluded by the particular boundary. |
| `R(x,T)` | Resolution of `x` with respect to `T`. |
| `O(T)` | Operations admitted by the contract, with their required premises. |
| `E` | A consumer's required capability or extraction. |
| `P(f)` | Reachable normal return paths, including normal fallthrough. |
| `x ⊨ T` | `x` satisfies the stated contract. |
| `x ← v` | Assignment to a binding carrying a continuing promise. |

The producer owns the promise at its boundary. The consumer owns contextual
interpretation of the received value. A number `0` can mean a count, an initial
state, or an additive identity without changing its numeric agreement. If that
consumer becomes a producer, its new return boundary owns a new promise.

In the equations `D(T) ⊨ T` and `T+ ⊨ T`, `T` denotes the retained operational
shape. A separate scope-owned content condition can distinguish positive and
negative realizations. Satisfying the shape does not establish that stronger
content condition or authorize proceeding past a guard that requires it.

## Generic laws

The following are obligations whose premises must be established. An implication
from a required operation describes what correct execution needs; it does not let
an analyzer infer the requirement's satisfaction merely because the operation occurs.

| Invariant | Law and qualification |
| --- | --- |
| Complete value agreement | `C(T) = ⟨T+, D(T)⟩` when the contract selects a falsifiable value response. |
| Positive agreement | `T+ ⊨ T`. |
| Falsifiable agreement | `D(T) ⊨ T`; failing a content condition does not destroy the promised family. |
| Operational preservation | `O(D(T)) = O(T)` for the operations promised by that contract, not identical results or content. |
| Selected default | If execution actually selects a valid `D(T)`, that selected value satisfies `T`. Merely declaring a default says nothing about arbitrary provided values. |
| Return agreement | `∀p ∈ P(f), return(p) ⊨ T` for a producer promising `T`. |
| Absence resolution | Where `∅` is excluded, consumption of `T | ∅` requires a faithful resolution or a path that does not consume `T`. |
| Unknown resolution | `Consumption(U,T) ⇒ R(U,T)` is a boundary obligation; unknown may be transported without pretending it already satisfies `T`. |
| Resolver agreement | Successful resolution must establish `R(x,T) ⊨ T` through evidence or declared executable behavior. Naming a resolver supplies no proof. |
| Consumer capability | `E(x)` requires `x ⊨ E`; nominal similarity is insufficient. |
| Continuing assignment | `x ⊨ T ∧ x ← v ⇒ v ⊨ T ∨ R(v,T) ⊨ T` where the binding really promises a continuing `T`. |
| Contract-contained value failure | `T+ | D(T)` retains one operational contract. |
| Distinct alternatives | `T1 | T2` requires discrimination/resolution when the consumer cannot operate under their common established agreement. |
| External boundary | `External → U → R(U,T) → C(T)` describes the owner's resolution responsibility, not automatic static validation. |
| Intent is not evidence | `Intent(x)=T ⇏ x ⊨ T`. |

`D(T)` concerns a contract's negative **value response**. It is not an equation
identifying all failures with an empty value. Throws, rejection, cleanup, external
I/O and nontermination have their separate execution/failure contracts. Return
agreement constrains normal results; for async functions it constrains fulfillment.
It does not prove termination or promise that any normal result exists.

## Shape and operational meaning

A falsifiable response must remain usable under the declared operations. A
replacement that loses a required capability is not `D(T)` for that contract.
For a structural model whose fields each admit a falsifiable realization:

```text
M = { k1:T1, …, kn:Tn }
D(M) = { k1:D(T1), …, kn:D(Tn) }
```

This is a structural requirement, not permission to synthesize arbitrary
implementations. An empty record does not supply its required fields; an empty
sequence does not supply required positions. A callable or opaque payload may
have no faithful invented default. Native failure or a required boundary can be
the correct outcome when no value replacement is justified.

Falsifiable variation and semantic variation differ. An empty sequence and a
populated sequence can satisfy one collection agreement. Distinct alternatives
may instead require branch-local evidence and representations. Resolution can
increase knowledge, select a representation, or expose disagreement; it cannot
silently redefine a branch's meaning. Shared family alone does not establish
required shape, payload validity, discriminant, receiver identity, or effects.

## ECMAScript realization

These are language-specific forms governed by the frozen dialect references,
not additional universal axioms:

| Value-family agreement | Canonical value default | Remaining obligation |
| --- | --- | --- |
| Text | `''` | Preserve string operations; content, format and domain meaning are separate. |
| Number | `0` | Preserve numeric operations; zero can be a valid result. |
| Boolean | `false` | Preserve boolean meaning; false can be the intended result. |
| Collection | `[]` | Preserve the array family; required slots and iterator behavior need separate evidence. |
| Open record | `{}` | Establish no named properties by itself. |
| Named structural model | Recursive field realizations where valid | Preserve every promised field, nested requirement and payload boundary. |
| Callable or opaque value | No fabricated implementation | Retain the required/guarded/forwarding boundary that actually owns it. |

ECMAScript distinguishes `null` and `undefined` even when a contract groups them
as absence. A parameter/destructuring default executes for `undefined`, including
an omitted argument or missing property. It does not replace `null`, `NaN`, false,
zero, or an arbitrary incompatible provided value. The selected fallback gives
evidence for that alternative; it does not validate the incoming alternative.

An absent own field, an inherited field, and unknown field presence are different
observations. Moving a property read into a signature can change Get timing,
getter count, receiver binding or failure order. A structurally similar target
must still preserve those observations. Default expressions also have their own
evaluation timing and effects.

The dialect normally uses `const` for bindings. Explicit `let` permits changing
bindings; point-specific value evidence must follow those changes rather than
imposing every initializer's family forever. `const` does not freeze objects.
Property mutation and aliases have their own ownership and transformation policy.

## Content is interpreted in scope

For a content-bearing agreement, `D(T)` can preserve its family while falsifying
the current scope's content condition. The notation `⊥T` emphasizes that use.

| Content condition | Empty realization | Appropriate test |
| --- | --- | --- |
| Own enumerable string-key content | `{}` | The object helper's `hasContent(value)`. |
| Array cardinality | `[]` | `value.length` in a boolean context. |
| Text length | `''` | Text truthiness. |

Both `{}` and `[]` are truthy. A generic `!value` does not test their emptiness.
None of these tests validates nested payloads, meaningful text, native iterator
identity or all downstream operations. An empty value can satisfy an agreement
that permits empty content. The guard owns what follows a failed content test;
the empty representation does not exit a scope by itself.

## Evidence, composition and change

Known, unknown and contradictory describe evidence, not runtime success codes.
Insufficient evidence remains unknown; an established conflicting contribution
remains a contradiction even beside unknown contributions. A consumer's expected
shape or a compiler annotation cannot manufacture producer evidence.

Proof belongs to its source, binding, callable, field, invocation and premises.
Same spelling, equal shape or equal source spans cannot transfer ownership.
Composition must preserve reachable known contributions, incomplete branches,
failure/completion alternatives and the identities required by an operation.
Cycles cannot establish their own missing premise.

Revised premises require invalidation before dependent results are reused.
Previously returned immutable data can remain historical without remaining
current. Parser, compiler, observer, filesystem and resource-limit errors are
operational failures; none may be returned as a successful unknown judgment.

The conceptual translation relationship is:

```text
source intent + executable evidence → owned agreement → target-language policy
```

This is a preservation obligation for a supported translation, not a claim that
an arbitrary language adapter or separate universal intermediate representation
exists. Current implementation/query validity and cost limits belong to the
[architecture guide](../engineering/architecture.md); TypeScript boundaries belong
to the [lowering guide](../engineering/typescript.md). The
[proof obligations](resilient-proofs.md) make the conservation test concrete.
