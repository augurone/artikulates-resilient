# Resilient: Boundary Agreement and Contractual Totality

## Purpose

This note captures a compact mathematical interpretation of the Resilient model discussed here. The goal is not to replace ECMAScript semantics with mathematics, but to describe the same contract behavior at a higher level while preserving the rule that **executable source evidence determines how much agreement may be claimed**.

The central idea is:

> An operation should not reason over unconstrained input. Executable boundary constructs establish the smallest agreement required by the operation, and that agreement is propagated only as far as the source justifies it.

---

## 1. Core spaces

Let:

- \(U\) be the unconstrained space of possible runtime inputs arriving at a boundary.
- \(T\) be an operational domain: the values for which a particular operation has established an agreement.
- \(R\) be the return contract: the values the analyzed operation is guaranteed to return with respect to that contract.

At the most compact level:

\[
\boxed{
U \xrightarrow{\alpha_T} T \xrightarrow{f} R
}
\]

where \(\alpha_T\) is an agreement mapping and \(f\) is the operation performed over the established domain.

The composition is:

\[
\boxed{
f \circ \alpha_T : U \rightarrow R
}
\]

This is a statement of **contractual totality**, not a claim that arbitrary runtime execution can never fail.

---

## 2. Agreement is not merely validation

The boundary does not magically make an input “valid.” It establishes what the operation is entitled to assume.

A useful first abstraction is:

\[
x \in U
\quad
\xrightarrow{\text{boundary agreement}}
\quad
x' \in T
\]

followed by:

\[
f : T \rightarrow R
\]

The important distinction is semantic:

\[
\text{unknown input}
\rightarrow
\text{established agreement}
\rightarrow
\text{operation}
\rightarrow
\text{return contract}
\]

Resilient therefore treats defaults, guards, destructuring, transformations, and related constructs as **evidence of agreement**, not merely syntax or convenience.

---

## 3. Identity and stability

Agreement should preserve information that already satisfies the required domain.

For all \(t \in T\):

\[
\boxed{
\alpha_T(t) = t
}
\]

This is the identity/stability constraint.

A valid `0` remains `0`.  
A valid `false` remains `false`.  
An already-agreed array remains that array.

Agreement does not sanitize a value merely because it crossed a boundary.

---

## 4. Defaults belong to the operational vocabulary

An earlier formulation treated fallback values as a separate space \(F_T\):

\[
T \cup F_T
\]

That is often unnecessarily strong and does not accurately describe ordinary JavaScript defaults.

Values such as:

```js
''
[]
{}
0
false
```

can themselves be legitimate members of the operational domain.

A fallback is therefore better understood as a **distinguished member of the domain selected when the executable construct permits that selection**, rather than an “invalid-but-safe” parallel space.

Abstractly, where the source really establishes such a mapping:

\[
\delta_T : U \setminus T \rightarrow T
\]

and:

\[
\alpha_T(u)=
\begin{cases}
u & u \in T \\
\delta_T(u) & u \notin T
\end{cases}
\]

However, this abstraction must not be allowed to claim more than ECMAScript actually executes.

---

## 5. ECMAScript constrains the proof

Consider:

```js
const fn = ({
  items = [],
  count = 0,
} = {}) => {
  // ...
};
```

JavaScript parameter defaults do **not** map every value outside some desired domain into the default.

The default applies when the corresponding value is `undefined`.

So the more faithful local mapping for a default is approximately:

\[
\boxed{
\alpha_{\text{default}}(u)=
\begin{cases}
\delta_T & u = \texttt{undefined} \\
u & \text{otherwise}
\end{cases}
}
\]

Consequently:

```js
items: undefined
```

may establish `[]`, while:

```js
items: null
items: false
items: "foo"
```

do not automatically become `[]`.

This distinction is fundamental:

> **The executable construct determines how much agreement the analyzer is entitled to claim.**

The mathematics must describe the program. The program must not be assumed to implement stronger mathematics than its source establishes.

---

## 6. Guards establish stronger refinements

A stronger operational agreement requires stronger executable evidence.

For example:

```js
const fn = ({ items = [] } = {}) => {
  const safeItems = Array.isArray(items) ? items : [];

  return safeItems.map(/* ... */);
};
```

After the explicit predicate and fallback, the subsequent operation has evidence for an array domain:

\[
\alpha_{\text{Array}} : U \rightarrow T_{\text{Array}}
\]

The source has now justified the stronger agreement required by `.map()`.

This gives Resilient a useful principle:

\[
\boxed{
\text{required agreement}
\leq
\text{agreement justified by executable evidence}
}
\]

When an operation requires more agreement than the source has established, the analyzer has found a contract defect.

---

## 7. Agreement is compositional

There need not be one universal agreement function.

A real program establishes increasingly specific agreements through a sequence of executable constructs:

\[
\boxed{
U
\xrightarrow{\alpha_1}
V_1
\xrightarrow{\alpha_2}
V_2
\xrightarrow{\alpha_3}
V_3
\xrightarrow{f}
R
}
\]

For example:

\[
U
\xrightarrow{\text{default}}
V_1
\xrightarrow{\text{guard}}
V_2
\xrightarrow{\text{transformation}}
V_3
\xrightarrow{\text{operation}}
R
\]

Each arrow corresponds to source evidence.

A default may establish absence handling.  
A predicate may establish a structural refinement.  
A transformation may establish a new output shape.  
A return establishes the contract visible to the caller.

The analyzer's job is therefore not simply to classify values. It is to **derive and propagate agreements through executable paths**.

---

## 8. Contractual totality

Suppose an agreement mapping has genuinely established:

\[
\alpha_T : U \rightarrow T
\]

and the operation is contractually total over that established domain:

\[
f : T \rightarrow R
\]

Then, with respect to the analyzed contract:

\[
\boxed{
f \circ \alpha_T : U \rightarrow R
}
\]

### Compact proof

Let \(u \in U\) be arbitrary.

If the executable agreement establishes:

\[
\alpha_T(u) \in T
\]

and the analyzed operation establishes:

\[
\forall t \in T,\quad f(t) \in R
\]

then:

\[
f(\alpha_T(u)) \in R
\]

Therefore:

\[
\boxed{
\forall u \in U,\quad
(f \circ \alpha_T)(u) \in R
}
\]

with respect to the contract that has actually been established and analyzed.

---

## 9. What contractual totality does **not** prove

This formulation does **not** mean:

> “The program can never crash.”

That would be stronger than the grammar or static analysis can establish.

Execution can still be affected by things outside the local value contract, including:

- explicit `throw`;
- external I/O failure;
- platform or process failure;
- nontermination;
- side effects;
- unmodeled runtime behavior.

The defensible claim is narrower:

> **No value admitted through an analyzed agreement should become structurally unknown to a downstream operation without evidence that the required agreement was never established, was weakened, or was broken.**

Unknown is therefore evidence, not automatically failure.

---

## 10. The analyzer interpretation

The mathematical model maps naturally onto Resilient's static-analysis problem.

For each operation, determine:

1. **What agreement does this operation require?**
2. **What agreement has executable source established?**
3. **How does that agreement transform across this operation?**
4. **What return agreement becomes visible to the caller?**
5. **Where does evidence become insufficient?**

Conceptually:

\[
\boxed{
\text{Source Evidence}
\rightarrow
\text{Agreement}
\rightarrow
\text{Propagation}
\rightarrow
\text{Operation}
\rightarrow
\text{Return Agreement}
}
\]

A defect occurs when:

\[
\boxed{
A_{\text{required}} \nsubseteq A_{\text{established}}
}
\]

The important point is that the analyzer does not invent the missing contract. It reports the disagreement.

---

## 11. Resilient as a grammar of agreement

The mathematical formulation exposes why Resilient is more than a collection of lint rules.

Its recurring ECMAScript vocabulary includes constructs such as:

- destructured signatures;
- explicit defaults;
- guards and predicates;
- returned transformations;
- owned promises;
- local module boundaries.

Those forms carry recurring contractual jobs.

Their composition forms a grammar:

\[
\boxed{
\text{boundary}
\rightarrow
\text{absence}
\rightarrow
\text{refinement}
\rightarrow
\text{operation}
\rightarrow
\text{return}
\rightarrow
\text{responsibility}
}
\]

Resilient can therefore be understood as a functional ECMAScript dialect in which ordinary language constructs are used consistently enough that contractual meaning can be derived from executable code.

---

## 12. The compact model

The entire idea can be reduced to three constraints.

### Evidence

Only claim an agreement justified by executable semantics:

\[
\boxed{
A_{\text{claimed}}
\subseteq
A_{\text{evidenced}}
}
\]

### Stability

Preserve values that already satisfy the agreement:

\[
\boxed{
\forall t \in T,\quad \alpha_T(t)=t
}
\]

### Composition

Once an agreement is established, propagate it through operations whose requirements it satisfies:

\[
\boxed{
U
\xrightarrow{\text{agreement}}
T
\xrightarrow{\text{operation}}
R
}
\]

or, across a resolved program:

\[
\boxed{
U
\xrightarrow{\alpha_1}
V_1
\xrightarrow{\alpha_2}
V_2
\xrightarrow{\cdots}
V_n
\xrightarrow{f}
R
}
\]

The contract is therefore not an annotation imposed on the program.

**The executable program is the evidence from which the contract is derived.**

---

## Summary

Resilient's mathematical interpretation is not primarily “domain normalization.”

It is **boundary agreement and agreement propagation**.

An unconstrained value enters a program. Executable constructs progressively establish what may safely be assumed about that value. Operations consume only agreements they are entitled to require. Transformations establish new agreements. Returns establish what callers may rely upon.

The core relationship is:

\[
\boxed{
\text{uncertainty}
\rightarrow
\text{agreement}
\rightarrow
\text{operation}
\rightarrow
\text{known contract}
}
\]

And the governing constraint is:

> **Never infer more agreement than the executable source provides evidence for.**

That keeps the mathematical model subordinate to ECMAScript semantics while giving Resilient a compact formal vocabulary for describing what its analyzer measures.
