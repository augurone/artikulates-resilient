# Resilient — ECMAScript Algebra and Invariants

## Scope

Resilient is a grammar of **agreement under uncertainty** for ECMAScript programs.

This note defines the ECMAScript-native algebra and invariants. Its contract families and falsifiable forms are grounded in ECMAScript runtime values and operations: strings, numbers, booleans, arrays, objects, `null`, and `undefined`.

The broader language-independent formulation belongs in the generic algebra document.

This algebra describes agreement obligations. For the ECMAScript dialect,
[Grammar](grammar.md), [Policy](policy.md), and [Semantics](semantics.md)
define executable forms, exceptions, and meaning; [the proofs](resilient-proofs.md)
state their preservation obligations. Adapter support is documented separately.

## Legend

| Symbol | Meaning |
| --- | --- |
| \(T\) | Contract shape promised to an ECMAScript consumer |
| \(T^{+}\) | Positive/successful expression of \(T\) |
| \(D(T)\) | Falsifiable default/expression of \(T\) |
| \(C(T)\) | Complete contract for \(T\) |
| \(U\) | Unknown or unresolved value |
| \(R(x,T)\) | Resolver bringing \(x\) into agreement with \(T\) |
| \(O(T)\) | Operations available under contract \(T\) |
| \(P(f)\) | Reachable normal return paths of function \(f\) |
| \(E\) | Capability/extraction required by an ECMAScript consumer |
| \(\varnothing\) | Absence: `null` or `undefined` |
| \(x \models T\) | \(x\) agrees with \(T\) |
| \(x \not\models T\) | \(x\) violates \(T\) |
| \(\rightarrow\) | Produces or resolves to |
| \(\Rightarrow\) | Grammar requires or implies |

## 1. Contract

A contract contains both success and failure:

\[
\boxed{C(T)=\langle T^{+},D(T)\rangle}
\]

Both outcomes remain expressions of the same promised shape:

\[
\boxed{T^{+}\models T}
\]

\[
\boxed{D(T)\models T}
\]

The proper negative response of an ECMAScript function is therefore the falsifiable shape of its positive response.

Failure is **inside the contract**, not an abandonment of it.

## 2. Falsifiable Defaults

A falsifiable default is executable contract syntax:

\[
\boxed{x=D(T)\Rightarrow x\models T}
\]

Canonical forms:

\[
D(String)=""
\]

\[
D(Number)=0
\]

\[
D(Boolean)=false
\]

\[
D(Array)=[]
\]

For a structural model:

\[
M=\{k_1:T_1,\ldots,k_n:T_n\}
\]

\[
\boxed{D(M)=\{k_1:D(T_1),\ldots,k_n:D(T_n)\}}
\]

The falsifiable model preserves the complete promised structure.

`D(T)` names a valid falsifiable response under that contract. In the
[proof notation](resilient-proofs.md#1-vocabulary), `⊥T` emphasizes the same
representation failing a scope-owned content test. That content failure does
not invalidate the promised shape; the consumer owns its interpretation.

## 3. Falsifiable Is Still Usable

Falsifiability is not invalidity.

\[
\boxed{D(T)\in T}
\]

More strongly, the negative clause must preserve the operations promised by the positive clause:

\[
\boxed{O(D(T))=O(T)}
\]

Therefore:

- `0` is falsifiable **and numeric**; it remains usable in arithmetic.
- `""` is falsifiable **and a string**; string operations remain valid.
- `[]` is falsifiable **and a array**; iteration and array operations remain valid.
- `false` is falsifiable **and boolean**; boolean operations remain valid.

The general invariant is:

\[
\boxed{D(T)\models T\ \land\ O(D(T))=O(T)}
\]

This is why an unrelated sentinel such as `undefined` cannot substitute for `0`, `""`, or `[]` when those are the promised shapes: it destroys their operational contract.

## 4. Return Agreement

This is an agreement on normal returns, including implicit absence on
fallthrough, rather than a proof of termination. Throws and async rejections
belong to the failure contract. For async functions, the value agreement
constrains fulfillment.

For:

\[
f:A\rightarrow T
\]

every reachable normal return path must honor \(T\):

\[
\boxed{\forall p\in P(f),\ return(p)\models T}
\]

A function may fail to produce \(T^{+}\).

It may not fail to honor \(T\).

Thus:

\[
\boxed{\text{Every normal return remains semantically truthful to }T}
\]

## 5. Absence

Absence is not automatically a valid failure clause.

When the consumer expects \(T\):

\[
\boxed{T\mid\varnothing\Rightarrow T\mid D(T)}
\]

or operationally:

\[
\boxed{R(T\mid\varnothing,T)\rightarrow T}
\]

`null` and `undefined` agree only when absence itself belongs to the declared contract.

## 6. Unknown Resolution

Unknown represents unresolved agreement:

\[
U
\]

Before an ECMAScript consumer depends on \(T\):

\[
\boxed{Consumption(U,T)\Rightarrow R(U,T)}
\]

and successful resolution establishes:

\[
\boxed{R(U,T)\models T}
\]

At an external boundary:

\[
\boxed{External\rightarrow U\rightarrow R(U,T)\rightarrow C(T)}
\]

Unknown may be transported. It must be resolved before its consumer assumes a contract.

## 7. Consumer Capability

A consumer requirement is represented by \(E\):

\[
\boxed{E(x)\Rightarrow x\models E}
\]

The relevant question in a ECMAScript program is often not the nominal type of \(x\), but whether \(x\) agrees with the operation being performed: member access, mapping access, iteration, arithmetic, composition, or extraction.

## 8. Assignment Preservation

The default ECMAScript discipline uses `const`, which prevents rebinding.
Explicit `let` is the policy exception for a changing binding; inference
tracks its value at each point rather than imposing the initializer’s family
on every later assignment. The obligation below applies where a continuing
contract is promised. `const` does not freeze objects; property mutation is
governed separately by the transformation policy.

Once:

\[
x\models T
\]

later assignment must preserve or resolve into \(T\):

\[
\boxed{x\leftarrow v\Rightarrow v\models T\ \lor\ R(v,T)\models T}
\]

A falsifiable declaration:

\[
x=D(T)
\]

therefore establishes the same continuing obligation.

## 9. Failure vs. Semantic Ambiguity

Ordinary success and failure belong to one contract:

\[
\boxed{T^{+}\mid D(T)\Rightarrow T}
\]

A genuinely distinct semantic union is different:

\[
T_1\mid T_2
\]

When the alternatives cannot be consumed under one contract:

\[
\boxed{T_1\mid T_2\Rightarrow R(T_1)\mid R(T_2)}
\]

Resolvers make distinct meanings structurally decidable. They are not required merely because a valid \(D(T)\) is falsifiable.

## 10. Producer and Consumer

The producer promises:

\[
Producer\rightarrow C(T)
\]

The consumer operates against:

\[
Consumer(T)
\]

Therefore:

\[
\boxed{Producer(T)\models Consumer(T)}
\]

The producer preserves the contract. The consumer interprets the value according to context.

For example:

\[
D(Number)=0
\]

does not require the producer to distinguish whether `0` means zero results, an initial value, an additive identity, or another domain meaning. `0` remains a valid numeric value. Interpretation belongs to the consumer.

Coercion does not inherently clarify that meaning.

## 11. Type Intent

An annotation can state intended shape:

\[
Annotation(x)=T
\]

but does not establish executable agreement:

\[
\boxed{Annotation(x)=T\not\Rightarrow x\models T}
\]

Type information can instead become lowering input:

\[
\boxed{TypeIntent\rightarrow ContractAlgebra\rightarrow ExecutableAgreement}
\]

## 12. ECMAScript Expression

The algebra is expressed through ECMAScript runtime families and executable forms.

Canonical falsifiable forms are:

\[
D(String)=""
\]

\[
D(Number)=0
\]

\[
D(Boolean)=false
\]

\[
D(Array)=[]
\]

For an object contract:

\[
M=\{k_1:T_1,\ldots,k_n:T_n\}
\]

the falsifiable object preserves its required properties:

\[
D(M)=\{k_1:D(T_1),\ldots,k_n:D(T_n)\}
\]

ECMAScript absence is represented by:

\[
\varnothing=\{null,undefined\}
\]

Neither absence value substitutes for \(D(T)\) when the promised contract is another runtime family.

Executable ECMAScript forms realize the algebra through declarations, defaults, guards, member access, destructuring, transformations, branches, and returns. The algebra describes the agreement those forms must preserve; ECMAScript provides the executable syntax.

## Invariant Set

### I-01 — Contract
\[
\boxed{C(T)=\langle T^{+},D(T)\rangle}
\]

### I-02 — Positive agreement
\[
\boxed{T^{+}\models T}
\]

### I-03 — Falsifiable agreement
\[
\boxed{D(T)\models T}
\]

### I-04 — Operational preservation
\[
\boxed{O(D(T))=O(T)}
\]

### I-05 — Default declaration
\[
\boxed{x=D(T)\Rightarrow x\models T}
\]

### I-06 — Return agreement
\[
\boxed{\forall p\in P(f),\ return(p)\models T}
\]

### I-07 — Absence resolution
\[
\boxed{T\mid\varnothing\Rightarrow T\mid D(T)}
\]

### I-08 — Unknown resolution
\[
\boxed{Consumption(U,T)\Rightarrow R(U,T)}
\]

### I-09 — Resolver agreement
\[
\boxed{R(U,T)\models T}
\]

### I-10 — Consumer capability
\[
\boxed{E(x)\Rightarrow x\models E}
\]

### I-11 — Assignment preservation
\[
\boxed{x\models T\land x\leftarrow v\Rightarrow v\models T\lor R(v,T)\models T}
\]

### I-12 — Contract-contained failure
\[
\boxed{T^{+}\mid D(T)\Rightarrow T}
\]

### I-13 — Distinct ambiguity
\[
\boxed{T_1\mid T_2\Rightarrow R(T_1)\mid R(T_2)}
\]

### I-14 — Boundary normalization
\[
\boxed{External\rightarrow U\rightarrow R(U,T)\rightarrow C(T)}
\]

### I-15 — Type intent is not agreement
\[
\boxed{Annotation(x)=T\not\Rightarrow x\models T}
\]

## Compact Algebra

\[
\boxed{C(T)=\langle T^{+},D(T)\rangle}
\]

\[
\boxed{T^{+}\models T\land D(T)\models T}
\]

\[
\boxed{O(D(T))=O(T)}
\]

\[
\boxed{\forall p\in P(f),\ return(p)\models T}
\]

\[
\boxed{U\rightarrow R(U,T)\models T}
\]

Together:

> **A contract preserves one usable operational shape across success, failure, uncertainty, and control flow.**

The invariant is **agreement**.
