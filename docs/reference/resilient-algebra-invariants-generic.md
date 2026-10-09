# Resilient — Algebra and Invariants

## Scope

Resilient is a grammar of **agreement under uncertainty**.

This note defines the language-independent algebra and invariants. It does not prescribe source syntax for any implementation language.

Concrete languages express these relations through their own grammar, semantics, and policy.

This algebra describes agreement obligations. For the ECMAScript dialect,
[Grammar](grammar.md), [Policy](policy.md), and [Semantics](semantics.md)
define executable forms, exceptions, and meaning; [the proofs](resilient-proofs.md)
state their preservation obligations. Adapter support is documented separately.

---

## 1. Legend

The following symbols are normative within this note.

| Symbol | Meaning |
| --- | --- |
| \(T\) | Contract shape promised to a consumer |
| \(T^{+}\) | Positive/successful expression of \(T\) |
| \(D(T)\) | Falsifiable expression of \(T\) |
| \(C(T)\) | Complete contract for \(T\) |
| \(U\) | Unknown or unresolved value |
| \(R(x,T)\) | Resolver bringing \(x\) into agreement with \(T\) |
| \(O(T)\) | Operations available under contract \(T\) |
| \(P(f)\) | Reachable normal return paths of function \(f\) |
| \(E\) | Capability or extraction required by a consumer |
| \(\varnothing\) | Absence |
| \(x \models T\) | \(x\) agrees with \(T\) |
| \(x \not\models T\) | \(x\) violates \(T\) |
| \(\rightarrow\) | Produces or resolves to |
| \(\Rightarrow\) | Grammar requires or implies |

---

## 2. Contract

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

Therefore:

\[
\boxed{Failure(T)=D(T)}
\]

Failure is **inside the contract**, not an abandonment of it.

---

## 3. Falsifiable Defaults

A falsifiable default is an executable declaration of a contract shape:

\[
\boxed{x=D(T)\Rightarrow x\models T}
\]

For primitive or atomic contracts, \(D(T)\) is the falsifiable member of the same operational family.

For a structural contract:

\[
M=\{k_1:T_1,\ldots,k_n:T_n\}
\]

the falsifiable form is recursive:

\[
\boxed{
D(M)=\{k_1:D(T_1),\ldots,k_n:D(T_n)\}
}
\]

The falsifiable form preserves the complete promised structure.

Falsification is interpreted within the consuming scope. A valid falsifiable
response preserves the promised shape even when it fails a content condition;
it need not have one universal failure meaning.

---

## 4. Falsifiable Is Still Usable

Falsifiability is not invalidity.

\[
\boxed{D(T)\in T}
\]

More strongly:

\[
\boxed{O(D(T))=O(T)}
\]

Therefore:

\[
\boxed{
D(T)\models T
\land
O(D(T))=O(T)
}
\]

The negative clause remains a usable member of the same operational contract.

A failure representation that destroys the operations promised by \(T\) is not a valid \(D(T)\).

Shape agreement therefore includes **operational agreement**.

---

## 5. Return Agreement

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
\boxed{
\forall p\in P(f),\ return(p)\models T
}
\]

A function may fail to produce \(T^{+}\).

It may not fail to honor \(T\).

Thus:

\[
\boxed{
\text{Every normal return remains semantically and operationally truthful to }T
}
\]

---

## 6. Absence Resolution

Absence is not automatically a valid failure clause.

If a consumer expects \(T\), then:

\[
T\mid\varnothing
\]

must resolve absence into the falsifiable member of \(T\):

\[
\boxed{
T\mid\varnothing
\Rightarrow
T\mid D(T)
}
\]

Operationally:

\[
\boxed{
R(T\mid\varnothing,T)\rightarrow T
}
\]

Absence agrees only when absence itself belongs to the declared contract.

---

## 7. Unknown Resolution

Unknown represents unresolved agreement:

\[
U
\]

Before a consumer depends on \(T\):

\[
\boxed{
Consumption(U,T)\Rightarrow R(U,T)
}
\]

Successful resolution establishes:

\[
\boxed{
R(U,T)\models T
}
\]

At an external boundary:

\[
\boxed{
External
\rightarrow
U
\rightarrow
R(U,T)
\rightarrow
C(T)
}
\]

Unknown may be transported as unknown. It must be resolved before a consumer assumes a contract.

---

## 8. Consumer Capability

A consumer requirement is represented by \(E\):

\[
\boxed{
E(x)\Rightarrow x\models E
}
\]

Agreement is therefore defined by the capabilities required by the consumer, not necessarily by a nominal category.

The relevant question is:

\[
\boxed{
\text{Does }x\text{ agree with the operation the consumer requires?}
}
\]

---

## 9. Assignment Preservation

This obligation applies to a binding with a continuing promised contract.
Language-specific policy identifies changing-binding exceptions. In the
ECMAScript dialect, `const` prevents rebinding and explicit `let` is the
exception; see [assignment preservation](resilient-algebra-invariants.md#8-assignment-preservation).

Once:

\[
x\models T
\]

a subsequent assignment must preserve or resolve into \(T\):

\[
\boxed{
x\leftarrow v
\Rightarrow
v\models T
\lor
R(v,T)\models T
}
\]

If:

\[
x=D(T)
\]

then:

\[
x\models T
\]

and later assignments inherit the same obligation.

---

## 10. Failure vs. Semantic Ambiguity

Ordinary success and failure belong to one contract:

\[
\boxed{
T^{+}\mid D(T)\Rightarrow T
}
\]

A genuinely distinct semantic alternative is different:

\[
T_1\mid T_2
\]

When the alternatives cannot be consumed under one contract:

\[
\boxed{
T_1\mid T_2
\Rightarrow
R(T_1)\mid R(T_2)
}
\]

The distinction is:

\[
\boxed{
\text{falsifiable variation} \neq \text{semantic variation}
}
\]

Resolvers are required for distinct meanings, not merely because \(D(T)\) is falsifiable.

---

## 11. Producer–Consumer Agreement

A producer promises:

\[
Producer\rightarrow C(T)
\]

A consumer operates against:

\[
Consumer(T)
\]

Therefore:

\[
\boxed{
Producer(T)\models Consumer(T)
}
\]

The producer is responsible for preserving the contract.

The consumer is responsible for interpreting the value according to context.

The producer is not required to add coercion or additional representation merely to explain that \(D(T)\) is falsifiable.

---

## 12. Type Intent

A type or annotation may state intended shape:

\[
Intent(x)=T
\]

but intent alone does not establish executable agreement:

\[
\boxed{
Intent(x)=T
\not\Rightarrow
x\models T
}
\]

Intent may therefore become lowering input:

\[
\boxed{
TypeIntent
\rightarrow
ContractAlgebra
\rightarrow
ExecutableAgreement
}
\]

---

## 13. Cross-Language Preservation

The algebra is independent of target syntax.

Let:

\[
Policy_L
\]

represent the language-specific policy for language \(L\).

Then:

\[
\boxed{
Grammar
\rightarrow
Policy_L
\rightarrow
Program_L
}
\]

Policy determines how a language safely expresses the grammar.

Policy does not redefine the contract invariants.

This permits:

\[
\boxed{
Source_L
\rightarrow
AgreementIR
\rightarrow
Policy_K
\rightarrow
Target_K
}
\]

The translation objective is **contract equivalence**, not source equivalence.

---

## 14. Invariant Set

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
\boxed{
\forall p\in P(f),\ return(p)\models T
}
\]

### I-07 — Absence resolution

\[
\boxed{
T\mid\varnothing
\Rightarrow
T\mid D(T)
}
\]

### I-08 — Unknown resolution

\[
\boxed{
Consumption(U,T)\Rightarrow R(U,T)
}
\]

### I-09 — Resolver agreement

\[
\boxed{
R(U,T)\models T
}
\]

### I-10 — Consumer capability

\[
\boxed{
E(x)\Rightarrow x\models E
}
\]

### I-11 — Assignment preservation

\[
\boxed{
x\models T
\land
x\leftarrow v
\Rightarrow
v\models T
\lor
R(v,T)\models T
}
\]

### I-12 — Contract-contained failure

\[
\boxed{
T^{+}\mid D(T)\Rightarrow T
}
\]

### I-13 — Distinct ambiguity

\[
\boxed{
T_1\mid T_2
\Rightarrow
R(T_1)\mid R(T_2)
}
\]

when \(T_1\) and \(T_2\) represent distinct semantic contracts.

### I-14 — Boundary normalization

\[
\boxed{
External
\rightarrow
U
\rightarrow
R(U,T)
\rightarrow
C(T)
}
\]

### I-15 — Intent is not agreement

\[
\boxed{
Intent(x)=T
\not\Rightarrow
x\models T
}
\]

---

## 15. Compact Algebra

\[
\boxed{
C(T)=\langle T^{+},D(T)\rangle
}
\]

\[
\boxed{
T^{+}\models T
\land
D(T)\models T
}
\]

\[
\boxed{
O(D(T))=O(T)
}
\]

\[
\boxed{
\forall p\in P(f),\ return(p)\models T
}
\]

\[
\boxed{
U\rightarrow R(U,T)\models T
}
\]

Together:

> **A contract preserves one usable operational shape across success, failure, uncertainty, and control flow.**

The invariant is **agreement**.
