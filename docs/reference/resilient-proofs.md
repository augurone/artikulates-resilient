# Resilient: Agreement Proofs

Working proof obligations for lowering, defaults, resolution, and conservation of intent.

Status: Working formalism. These are proof obligations for the Resilient dialect, not claims of a complete mathematical type theory.

This is a companion to [Semantics](semantics.md), especially S-02, S-05,
S-07–S-09, and S-11. [Grammar](grammar.md) defines executable forms;
[Policy](policy.md) defines rules and exceptions. The notation below describes
semantic obligations, not additional source syntax or an alternative policy.
[typescript.md](typescript.md) describes current adapter support. The numbered
“proofs” state obligations whose assumptions must be established for each
transformation; they are not completed derivations or implementation guarantees.

Agreement in these proofs is scoped through functional boundaries. A producer
function owns the contract it promises at its return boundary; every reachable
return path must preserve that agreement. The caller receives the promised shape
and owns its contextual interpretation within the caller’s scope. If that caller
becomes a producer, its own return boundary establishes a new agreement.

In compact form:

```text
producer owns contract ; consumer owns interpretation
```

Consumer interpretation does not retroactively alter the producer’s contract.

## 1. Vocabulary

* `<T>` - an agreement carrying intent T.
* `!<T>` - falsification of the agreement through its content test within the current scope; this does not mean that the value has the wrong runtime family or one universal failure meaning. A guard determines what control-flow consequence follows.
* ⊥T - the canonical empty or falsifiable representation for a content-bearing agreement T: it preserves the runtime family while failing that agreement’s content test where the current boundary requires content.
* ⊕ - a resolvable alternative: a set of representations requiring a decision, not a permanently admissible TypeScript-style value union.
* ρ - a resolver: a transformation that adds evidence, chooses a representation, or exposes disagreement without silently changing the meaning of the agreement.
* K(T) - a known synthetic shape that preserves the meaning carried by T.
* ≃ - agreement-preserving equivalence under a declared boundary and input domain; observable identity must be preserved.
* Producer_f(T) - function f promising contract T at its return boundary.
* Consumer_g(T) - function or scope g consuming a value under contract T and assigning its own contextual interpretation.
* P(f) - the reachable return paths of function f.
* ⊨ - agreement: the expression on the left satisfies the contract on the right.

### Important notation boundary

⊥T is a runtime representation, not an impossible value. `!<T>` expresses
the failed content test associated with that representation. They describe
the falsifiable representation and its content-test interpretation within the
current agreement, respectively:

```text
value = ⊥T  ⇒  !<T>
```

This relation applies when T requires content. It is not a claim that every
empty value violates every agreement. An agreement that permits empty content
can accept the same representation.

| Agreement requiring content | Canonical empty representation ⊥T | Content test | Falsification at the empty representation |
| --- | --- | --- | --- |
| Object content | `{}` | `hasContent(value)` | `!hasContent({})` is true |
| Array content | `[]` | `value.length` in a boolean context | `!([].length)` is true |
| Text content | `''` | `value` in a boolean context | `!''` is true |

Falsification does not mean “wrong type.” isObject({}) and
Array.isArray([]) are true: the families are intact. The corresponding
content tests fail. In particular, !value does not test object or array
emptiness because {} and [] are truthy.

The current object hasContent helper checks the object family and whether
there are own enumerable string keys. It does not recursively validate fields:
hasContent({ name: '' }) is true. Array length tests cardinality, not element
validity; string truthiness tests nonzero length, not trimmed text or meaning.
These tests establish only the content condition they actually inspect.

A default supplies this empty representation where the boundary permits it.
It does not validate arbitrary incoming values or itself terminate execution.
A guard uses the content test to decide whether the agreement proceeds.
Family preservation alone does not establish a required record or tuple shape.

For numbers and booleans, 0 and false remain canonical defaults, but their
falsification meaning is scoped to the consuming agreement. Zero and false can
be valid results. The producer guarantees the numeric or boolean family; the
consumer decides whether the particular value is absence-like, a legitimate
result, an identity value, or something else in its own domain. Do not invent
a universal nonzero or true-only requirement.

## 2. Governing invariants: conservation of intent and scoped agreement

Resolution preserves intent:

```text
ρ(T) ≃ T
```

For a producer function:

```text
f:A -> T  =>  ∀p∈P(f), return(p) ⊨ T
```

Return agreement covers normal completion, including implicit `undefined` on
fallthrough. It does not prove termination. Throws and async rejections retain
their separate failure contracts under S-09; an async value agreement applies
to fulfillment.

The first invariant constrains transformation. The second constrains functional
scope: every reachable return path must honor the producer’s promised contract.

Resolution may add evidence, choose an executable representation, or expose
disagreement. It may not silently alter the meaning of the original agreement.
Once the value crosses the producer boundary, the consumer may interpret it
according to its own scope without changing the agreement that produced it.

Equivalence must preserve observable results, property-read and call order,
receiver binding, effects, failures, cleanup, and identity where observable
(see Semantics S-07–S-11). A changed representation needs an explicit mapping
back to the agreement. Intentional normalization must declare its input domain
and default/guard behavior; it is not evidence that arbitrary source programs
are behaviorally equivalent after normalization.

A proof obligation therefore ends at a boundary with preservation of T, not
with one globally fixed interpretation of the returned value. The next consumer
may guard, transform, branch on, or otherwise interpret that value under a new
local context. If that consumer returns a value, its own producer obligation
applies.

These invariants are the boundary on every lowering rule:

* a resolver may determine whether an agreement holds;
* a guard may establish that an agreement need not continue in the current scope;
* a fallback may provide a falsifiable representation of the same runtime family without assigning that representation one universal domain meaning;
* a model may materialize a known synthetic shape;
* none of these may turn one agreement into a different agreement merely to make code run.

The producer/consumer relationship can therefore be written:

```text
Producer_f(T) -> Consumer_g(T)
```

The boundary preserves T. Interpretation belongs to g.

## 3. Proof I - required unknown / any

```text
<T:any> -> <T> ∨ !<T>
```

An unbounded source agreement remains required unless supported executable
evidence establishes a different boundary: an owned guard, an explicit fallback,
or a configured resolver. A guard alone does not create a default or prove
optionality. The formula describes proceeding versus non-proceeding control flow
inside the current producer/consumer scope, not every supported adapter
representation. “Required” records a target contract obligation; a bare JavaScript
parameter does not itself enforce arity or validate a runtime argument.

### Proof obligations

1. The source provides intent but insufficient evidence for a falsifiable default.
2. Lowering may not fabricate optionality or invent a canonical positive value.
3. If the target consumes T, the agreement remains required.
4. A guard must establish the relevant condition on every path to the protected use; rejected paths must terminate or be handled explicitly. Merely containing a guard-like expression is insufficient.
5. Therefore the lowered result preserves intent in either branch: required agreement or explicit non-proceeding/falsification path.

### Conservation check

Neither branch invents a new meaning for T. The guard only determines whether
the agreement proceeds in that scope. A non-proceeding branch does not redefine
the producer’s contract, and a proceeding branch remains responsible for honoring
that contract at its eventual return boundary.

This is a control-flow alternative (∨), not the same operator as a synthetic
value alternative (⊕).

## 4. Proof II - falsifiable defaults

```text
validDefault(⊥T, T, boundary) => family(⊥T) = family(T)
```

A valid fallback preserves the required runtime family and separately satisfies
the boundary’s shape and absence obligations without assigning the fallback one
universal meaning outside that boundary.

### Proof obligations

* A JavaScript parameter or destructuring default handles undefined, including an omitted argument or missing property. It does not replace null or NaN, or validate arbitrary incoming values.
* The canonical default belongs to the same runtime family as the positive agreement.
* Canonical value-family defaults include:

```text
string  -> ''
number  -> 0
boolean -> false
array   -> []
object  -> {}
```

* The fallback preserves the runtime family required by downstream operations.
* The default provides static evidence about fallback behavior. It does not promote an unknown incoming value to a validated value or erase a known contradiction.

### Falsifiability is contextual

For an agreement requiring content, the canonical empty representation fails
its content test as defined above. For an agreement allowing empty content, that
same value may be a legitimate result. Therefore a fallback is not automatically
an observable absence marker. Whether absence is distinguishable from a valid
empty value depends on the surrounding guard, model, or contract.

When that distinction matters, the lowering must preserve the evidence explicitly
through a guard, resolver, model, or required boundary rather than pretending that
a falsy value proves absence.

This contextuality is a producer/consumer property. The producer may return 0,
false, '', or another valid falsifiable realization while still honoring its
promised family and shape. The caller decides what that value means in its own
scope. Its interpretation may affect control flow or domain meaning, but it does
not retroactively change the producer’s contract.

For example:

```text
Producer_f(Number) -> 0
```

establishes that f has honored its numeric contract. It does not establish what
0 must mean to every consumer.

A consumer may interpret it through truthiness:

```text
!0 -> falsifiable interpretation
```

or through arithmetic:

```text
0 + n -> numeric interpretation
```

without either interpretation changing the contract fulfilled by f.

### Conservation check

The family condition is necessary but insufficient. validDefault also
requires the boundary’s declared shape and absence behavior to be preserved.
{} does not establish a required { name: string } property, and [] does
not establish a required tuple element. Nested defaults or explicit models may
supply such contracts where supported; they are additional evidence.

A default must never stand in for an incompatible object, tuple, synthetic type,
or opaque agreement.

## 5. Proof III - resolvable alternatives / synthetic types

```text
<T1> ⊕ <T2> --ρ--> K(T1) ⊕ K(T2)
```

Ambiguous alternatives create a resolution obligation. Synthetic alternatives
lower to known executable shapes that preserve branch meaning.

### Proof obligations

* A TypeScript union supplies alternatives; it does not by itself establish which alternative is active.
* Each synthetic branch may be materialized as a model or executable shape when its meaning is known.
* ρ distinguishes alternatives using available evidence and returns a stable branch representation K(Ti).
* The caller may decide what the resolved branch means within its own scope, but resolution may not redefine the branch contract established at the producer boundary.
* If evidence cannot distinguish alternatives, preserve that ambiguity. The adapter may retain a known runtime family without choosing a synthetic model; missing branch evidence remains unknown. Unsupported type forms may instead produce a lowering diagnostic.

### Branch-local resolution

Resolution belongs to the functional scope where evidence exists. The source
may arrive as a nested conditional, but that is not acceptable Resilient target
style. Each branch must consume only payloads established in that branch. Naming
checks is one readable form, not an additional universal policy requirement.

```javascript
// Source shape: this nested conditional is lowered, not preserved.
isLeft(fa)
    ? left(f(fa.left))
    : isBoth(fa)
    ? both(f(fa.left), fa.right)
    : fa
```

The payload agreements are branch-local. This example uses narrow default-rule
exceptions because payloads are opaque and owned by the callee; invented defaults
would change their meaning. The helper bindings (isLeft, isBoth, left,
both, and f) are assumed stable during the expression. The original result
constructors are therefore resolved to the same functions in both forms.
Without that assumption, lowering must also preserve their lookup timing.
The right property is read only after f completes, as in the source:

```javascript
const resolve = (fa) => {
    const leftResult = isLeft(fa);
    if (leftResult) {
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- branch payload is opaque; f owns its agreement
        const { left: faLeft } = fa;
        return left(f(faLeft));
    }
    const bothResult = isBoth(fa);
    if (bothResult) {
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- branch payload is opaque; f owns its agreement
        const { left: faLeft } = fa;
        const mappedLeft = f(faLeft);
        // eslint-disable-next-line resilient/prefer-safe-destructuring-defaults -- preserve the post-call read; both owns the opaque right payload
        const { right: faRight } = fa;
        return both(mappedLeft, faRight);
    }
    return fa;
};
```

The Left branch resolves left; the Both branch resolves left and right;
the final branch preserves fa. No payload is invented and no incompatible
union is coerced.

### Conservation check

```text
K(Ti) ≃ Ti
```

K(Ti) is permitted only when the known executable shape preserves the branch
agreement. Resolution may discriminate; it may not redefine.

The resolved value may subsequently acquire a different contextual meaning in
its consumer scope. That interpretation is outside the resolver’s conservation
obligation so long as the resolver truthfully preserves the branch contract.

## 6. Lowering theorem

```text
TypeScript intent --Resilient lowering--> executable JavaScript agreement
```

Resilient uses TypeScript notation as source evidence, not as its ontology. The
lowering target is executable JavaScript whose models, defaults, guards,
resolvers, discriminated shapes, and return contracts retain useful source intent
that ordinary TypeScript emission would otherwise erase.

For every lowering L that claims to resolve source intent T:

```text
L(T) ≃ T
```

For every lowered producer f:A -> T, the target must also satisfy:

```text
∀p∈P(f), return(p) ⊨ T
```

Lowering therefore preserves both intent and the producer’s scoped return
obligation. It does not require all downstream consumers to assign one shared
semantic interpretation to every realization of T.

Where a supported representation has incomplete evidence, retain an unknown
or required boundary. Where the type form has no supported faithful lowering,
report a transformer diagnostic rather than emit invented behavior; the current
adapter suppresses JavaScript output when such diagnostics are present. These
outcomes are distinct from ESLint policy findings.

The theorem is therefore a compiler obligation, not a promise that every
TypeScript construct has a safe automatic translation.

## 7. Evidence states

The proofs depend on preserving epistemic state rather than maximizing certainty.

* Known - available evidence establishes an agreement.
* Unknown - available evidence is insufficient; the question remains open.
* Contradictory - available evidence establishes incompatible agreements.

Unknown is not failure. Contradiction is not uncertainty. A transformation is
unsound in Resilient when it converts either state into fabricated certainty.

Evidence is interpreted in scope. A value may be known to satisfy a producer’s
boundary contract while its downstream domain meaning remains intentionally open
to the consumer. Contract knowledge and contextual interpretation are separate
concerns.

Thus:

```text
known contract ≠ globally fixed meaning
```

A consumer does not need to rediscover a known contract merely because it assigns
the received value a new contextual meaning.

## 8. General proof test for Resilient transformations

For a proposed transformation P -> P', ask:

1. What intent and evidence are present before transformation?
2. What new evidence or executable representation is introduced?
3. Does the transformation resolve, expose, or guard the agreement without redefining it?
4. If a fallback is introduced, does it preserve the required runtime family and shape?
5. If a resolver is introduced, does each branch preserve its own meaning?
6. If evidence is insufficient, does the result remain unknown or required?
7. At each producer boundary, do all reachable return paths still satisfy the promised contract while leaving downstream interpretation to the consumer?
8. Does the resulting agreement satisfy ρ(T) ≃ T?
9. Are observable evaluation order, receivers, identity, effects, and failure paths preserved under explicit assumptions?
10. If conservation cannot be established, is the original behavior retained or unsupported lowering reported? Unknown evidence must not become fabricated certainty.
11. If behavior-preserving code needs a policy exception, is that exception narrow, local, and explained? An exception cannot waive conservation or resolve a contradiction.

The two central questions can therefore be reduced to:

Did the transformation preserve what was agreed?
Did every producer preserve what it promised?

What a later consumer chooses to mean by a valid realization is not itself a
lowering violation.

## 9. Compiler consequences

These obligations motivate the following proposed lowering architecture; this
is not a claim that the current adapter implements a separate intermediate
representation:

```text
TypeScript AST and type evidence
        |
        v
Resilient agreement / evidence model
        |
        v
Resilient AST with guards, defaults, models, and resolvers
        |
        v
ECMA 2016+ executable output
```

The intermediate model should record, at minimum:

* agreement family and known shape;
* producer boundary and scoped return obligation;
* required versus guarded status for any and opaque values;
* falsifiable representation, when one is valid;
* union alternatives and their discriminating evidence;
* branch-local member agreements;
* consumer-local interpretation state where relevant to guards or resolution, without folding that interpretation back into the producer contract;
* unresolved or contradictory evidence;
* evaluation-order, receiver, identity, and effect obligations;
* policy exceptions and their reasons, separate from unsupported-lowering diagnostics.

This separates source-language syntax from target-language policy. TypeScript
supplies analysis evidence; Resilient determines the executable agreement.

It also separates contract evidence from contextual interpretation:

```text
producer evidence
      |
      v
contract boundary T
      |
      v
consumer interpretation
      |
      v
next producer boundary T'
```

Each boundary establishes its own proof obligation.

## 10. Current interpretation

This notation is best treated as compact notation for semantic proof obligations,
rather than as a claim that Resilient is already a complete algebra or type system.
Its purpose is to state what transformations are allowed to do to intent, what a
producer must preserve at its functional boundary, and what remains intentionally
open to consumer interpretation.

The practical standard is:

Resolution can increase knowledge, choose a representation, or expose disagreement without changing intent.

For functional scope:

A producer owns the contract at its return boundary. A consumer owns the contextual interpretation of the value it receives. Interpretation may guide use, branching, or further transformation, but it does not retroactively redefine the producer’s agreement.

Or, more strictly:

A fallback supplies declared default behavior without proving input validity. A guard may stop an agreement from proceeding. A resolver may establish or expose a branch. None may silently change what was agreed.

The governing relationship is therefore:

```text
Producer_f(T)
    |
    | guarantees T
    v
Consumer_g(T)
    |
    | interprets T locally
    v
Producer_g(T')
```

Agreement is conserved at the boundary. Meaning is interpreted in scope.
