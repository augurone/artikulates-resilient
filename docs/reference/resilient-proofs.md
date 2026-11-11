# Agreement preservation and proof obligations

This is a working formalism for defaults, resolution and lowering, not a complete
mathematical type theory or a declaration that every obligation has been proved.
[Grammar](grammar.md), [Policy](policy.md) and [Semantics](semantics.md) govern the
dialect. The [agreement algebra](resilient-algebra-invariants-generic.md) supplies
its vocabulary. Current implementation support is recorded in the
[architecture](../engineering/architecture.md) and
[TypeScript](../engineering/typescript.md) guides, separately from these laws.

## 1. Vocabulary

| Notation | Meaning |
| --- | --- |
| `<T>` | An agreement carrying intent `T`. |
| `!<T>` | Falsification through the current scope's content condition, not necessarily a wrong runtime family. |
| `⊥T` | A canonical empty/falsifiable representation where the boundary admits one. |
| `⊕` | Alternatives requiring resolution, not permission to erase their distinct meanings. |
| `ρ` | A resolver that adds evidence, selects a faithful representation or exposes disagreement. |
| `K(T)` | A known executable model preserving the meaning of `T`. |
| `≃` | Agreement-preserving equivalence under declared assumptions and input domain. |
| `Producer_f(T)` | Function `f` owning a promise at its return boundary. |
| `Consumer_g(T)` | Scope `g` consuming that promise and interpreting the value locally. |
| `P(f)` | Reachable normal return paths, including fallthrough. |
| `⊨` | Satisfaction of the stated agreement. |

For a content-bearing agreement, `⊥T` preserves the runtime family while failing
that agreement's content condition where content is required:

| Agreement requiring content | `⊥T` | Falsification |
| --- | --- | --- |
| Object key content | `{}` | `!hasContent({})` |
| Array cardinality | `[]` | `!([].length)` |
| Text length | `''` | `!''` |

Objects and arrays are truthy; `!value` is not their content test. Zero and false
can be legitimate results. There is no universal failure interpretation attached
to an empty value. A consumer owns its interpretation and the guard's control
consequence. Where absence must remain distinguishable from legitimate emptiness,
the boundary must preserve that distinction rather than encode both silently as
one falsey value.

## 2. Conservation and scoped returns

```text
ρ(T) ≃ T
f : A → T  ⇒  ∀p ∈ P(f), return(p) ⊨ T
Producer_f(T) → Consumer_g(T) → Producer_g(T′)
```

The first law constrains transformations; the second constrains a producer's
normal results. Throws and rejections retain their failure ownership. Async value
agreement concerns fulfillment, and neither law proves termination.

The consumer may interpret a valid returned value differently without changing
the producer's promise. If the consumer returns another value, its own boundary
establishes a new obligation. The proof preserves the agreement across a boundary,
not one globally fixed domain interpretation.

Equivalence must preserve observable results, property-read/call order, receivers,
payload/callable identity, effects, thrown completion, rejection and cleanup under
the stated assumptions. Equal family and equal serialized output are insufficient.
A new representation requires an explicit mapping to the promised agreement.

Intentional normalization must state its input domain and selected default/guard
behavior. It may deliberately differ from the authored function on those inputs;
that must be tested as target policy, rather than presented as native equivalence.
A policy exception cannot waive either conservation or a known contradiction.

## 3. Required unknown and opaque values

```text
<T:any> → proceeding under an owned requirement ∨ an explicit non-proceeding path
```

This describes control flow, not a synthetic value alternative. `any`, an opaque
annotation or an unresolved external value supplies no executable validation.
A bare required JavaScript parameter does not enforce arity or reject undefined.

A faithful transformation must establish the following:

1. The source intent and required consumer boundary are identified independently
   of actual input evidence.
2. No invented default or optionality replaces an opaque required payload.
3. A guard establishes the relevant condition on every path to the protected use.
   Rejected paths terminate that use or are handled explicitly.
4. The proceeding path remains responsible for its producer's return promise.

A guard-like expression somewhere in the function is insufficient. A guard does
not automatically declare a default or make a parameter optional. If proof is
missing, retain unknown/required evidence; report a static contradiction only
where established facts conflict. Unsupported lowering can instead require a
transformer diagnostic.

## 4. Falsifiable defaults

```text
validDefault(⊥T, T, boundary) ⇒ family(⊥T) = family(T)
```

Family agreement is necessary, not sufficient. A default must also preserve the
boundary's required shape, absence behavior, evaluation phase and effects.
Canonical value defaults include `''`, `0`, `false`, `[]` and `{}` under their
respective agreements. A function or opaque payload does not acquire a fabricated
implementation merely to supply one of these values.

JavaScript defaults handle undefined, including omission and missing properties.
They do not normalize null, NaN or arbitrary provided values. The proof must keep
the selected-default alternative separate from the actual provided alternative;
an unknown input does not become validated, and a known conflict is not erased.

An empty record does not supply a required `{ name: string }` model. An empty
array does not supply required tuple positions. Recursive defaults or executable
models provide additional structure only where the actual contract supports it.
Required tuple binding can instead retain native missing-value failure.

An already provided valid object, array or callable must retain identity wherever
observable. A replacement that yields the same family while cloning a payload,
changing a getter count, suppressing an iterator error or eagerly reading a field
has not proved preservation.

## 5. Alternatives and branch-local resolution

```text
<T1> ⊕ <T2> --ρ--> K(T1) ⊕ K(T2)
K(Ti) ≃ Ti
```

A type union supplies possibilities; it does not establish the active branch.
The resolver must use actual discriminating evidence, and each branch may consume
only the payloads established there. If alternatives share a known family while
branch evidence remains missing, retain that family and the unresolved branch.
Unsupported forms may require a diagnostic rather than a guessed model.

For example, given an expression shaped as:

```text
isLeft(value) ? left(map(value.left))
              : isBoth(value) ? both(map(value.left), value.right) : value
```

the Left branch owns its left read; the Both branch owns both payloads; the last
branch returns the original value. In the Both branch, `value.right` is read only
after `map(value.left)` completes. Moving both reads before the branch or before
that call changes effects/failure order. Resolving helper bindings early also
requires proof that their identity and lookup timing are stable. A readable
branch rewrite is justified only when these observations are preserved.

Discrimination must preserve falsey valid property values and distinguish missing
from present properties where required. Same-spelled models in different scopes
or namespaces cannot borrow declaration identity. Resolution may identify the
branch; it cannot redefine its payload or change the consumer's opaque agreement.

## 6. Callable and collection boundaries

A producer's consistency query and an actual invocation answer different
questions. Caller arguments can establish a particular result without becoming a
source-wide promise. Returned callable creation, later invocation and aliases must
retain their own source/binding/invocation identities.

An overload can have an arity-indexed promise when exact source evidence selects
callable versus value behavior. Every owner return must be covered by that source
partition; nested and sibling functions cannot borrow it. Unknown callbacks,
imported values or mutable binding targets do not become known local callables.

Collection rewrites must preserve sparse-slot behavior, callback arguments,
short circuiting, seed identity, reduction order, iterator acquisition/closing,
receiver identity and abrupt completion where relevant. Similar method names do
not establish native operation identity. Array family evidence alone does not
prove inert indexed access or native iteration.

The compiler bridge's `checkTuple` compares returned positions with descriptor
requirements. It is not an input validator. Whole actual results and producer
consistency use their own queries. This distinction prevents expected tuple
annotations from silently supplying actual callback/argument facts.

## 7. Transformation proof procedure

For a proposed source-to-target change, establish:

1. The producer promise, consumer requirement and failure owner.
2. The original executable evidence, exact source/binding identity and any unknown
   or conflicting contributions.
3. The supported input domain and whether the claim is native equivalence or
   intentional target normalization.
4. Every introduced default, guard, model or resolver and why it preserves the
   boundary's family, shape, required status and branch meaning.
5. Evaluation/lookup order, receiver and payload identity, effects, failure and
   cleanup at the changed boundary.
6. Every reachable producer return, including normal fallthrough, under the owned
   premises; unrelated functions keep their own obligations.
7. The faithful result when evidence is insufficient: retain the original
   boundary, preserve unknown, or report unsupported lowering.
8. Exact local policy exceptions and their semantic reasons, separately from
   evidence and lowering diagnostics.

TypeScript may supply declaration and contextual requirements. It cannot supply
actual runtime values merely because the checker accepts an annotation. A
conceptual evidence model should retain requirements, identities, alternatives,
provenance, completion/effect obligations and unresolved facts. This is an
information-preservation requirement, not a proposal for a second evaluator or
new universal intermediate framework.

## 8. What verification establishes

Useful behavioral proof exercises the actual public transform or installed
project path and compares native, raw and fixed execution at the changed boundary.
Observe identities, effects and failures before comparing successful values.
Expected source diagnostics and intentional normalization require explicit
expectations; blanket suppression or output-spelling checks cannot establish them.

`npm run check` verifies maintained lint/exception policy, functional suites and a
normal isolated package installation. A complete fluency report establishes
analysis coverage; a clean report establishes zero findings under that profile.
Neither alone proves behavior, every source form, termination or runtime safety.
The [existing-test connection](../engineering/typescript.md#run-an-existing-test-suite-against-emitted-output)
runs supported Node-test/Vitest jobs against reference/raw/fixed artifacts and
compares actual cases and load identities. Its claim is limited to the exercised
behavior; it does not prove unexercised emitted modules.

Foundation claims additionally need composition and revision evidence: shared and
successive joins, unknown beside known conflict, cycle grounding, stale results,
and work/storage bounds under the claimed operations. A fast isolated query,
stack-safe walk, cached-fact count or passing corpus does not establish a general
complexity theorem. Current demand costs depend on owned structure, facets,
invocation contexts and decisions; no global linearity promise follows here.
