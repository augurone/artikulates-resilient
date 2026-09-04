# Philosophical Heritage of Resilient JavaScript

Resilient JavaScript sits within a long tradition of thinking about
**program correctness, contracts, invariants, and boundaries**. Its
argument is not fundamentally about dynamic typing versus static typing.
It is about what a program can actually establish as true, where those
truths originate, and whether subsequent operations preserve them.

## Floyd → Hoare → Dijkstra: Correctness as Propositions

The deepest foundation is the work of Robert Floyd, C. A. R. Hoare, and
Edsger Dijkstra.

Hoare logic famously expresses program reasoning as:

``` text
{ P } program { Q }
```

If proposition `P` is true before execution, what proposition `Q` can be
established afterward?

This shifts attention away from merely describing the representation of
a value and toward reasoning about **what must be true about program
state**.

That provides the conceptual foundation for:

-   Preconditions
-   Postconditions
-   Invariants
-   Formal reasoning about transformations
-   Establishing and preserving truths about program state

Resilient inherits this emphasis on **what the program establishes**,
rather than what the programmer merely declares.

------------------------------------------------------------------------

## Bertrand Meyer: Design by Contract

Bertrand Meyer's **Design by Contract** is one of the clearest direct
ancestors of Resilient's philosophy.

A component has obligations and guarantees:

``` text
PRECONDITION
     ↓
  operation
     ↓
POSTCONDITION
```

A **precondition** describes what the caller must provide.

A **postcondition** describes what the operation guarantees.

An **invariant** describes something that must remain true throughout
permitted transformations.

Importantly, Eiffel contracts can be executable runtime assertions. They
are not merely descriptive metadata.

### Relationship to Resilient

Meyer generally expects programmers to **explicitly declare contracts**.

Resilient asks a further question:

> How much of the contract can be inferred from disciplined executable
> JavaScript itself?

For example:

``` js
const calculate = (values = []) => values.reduce(...);
```

The default value, operations performed upon `values`, return behavior,
callers, and consumers all provide evidence about the function's
contract.

The implementation itself becomes a source of contract information.

------------------------------------------------------------------------

## Findler & Felleisen: Higher-Order Contracts and Blame

Robert Bruce Findler and Matthias Felleisen extended contract reasoning
into higher-order and dynamically typed programming.

Their work is particularly relevant because contracts exist **between
interacting components**.

One of their important contributions is the concept of **blame**.

If a caller violates a precondition:

``` text
CALLER → invalid input → function
```

the caller violated the contract.

If the function violates its postcondition:

``` text
function → invalid result → CALLER
```

the provider violated the contract.

Correctness therefore isn't merely a property of individual values. It
is a property of **relationships across boundaries**.

### Relationship to Resilient

This maps naturally onto Resilient's boundary analysis.

Instead of asking only:

> What type is this value?

Resilient can ask:

> Which component established this invariant, which component depends
> upon it, and where could that agreement be violated?

------------------------------------------------------------------------

## Rich Hickey: Specifications Are Not Types

Rich Hickey's work on `clojure.spec` provides one of the closest modern
philosophical relatives.

A specification can describe meaningful properties using predicates
rather than requiring those properties to become part of an elaborate
static type system.

Specifications can then support:

-   Runtime validation
-   Instrumentation
-   Documentation
-   Generative testing
-   Error reporting
-   Function contracts

A traditional type signature might establish:

``` text
reverse : List<A> → List<A>
```

but that says relatively little about the actual behavioral contract.

The meaningful properties include: 

``` text
output length == input length

output contains the same members

ordering is reversed

input is not unexpectedly mutated
```

Those are semantic properties rather than merely representational ones.

### Relationship to Resilient

Hickey demonstrates an important principle:

> Specifications describing meaningful program behavior need not be
> synonymous with types.

Resilient pushes further toward deriving those specifications from
ordinary executable JavaScript wherever sufficient evidence exists.

------------------------------------------------------------------------

## Gary Bernhardt: Functional Core, Imperative Shell

Gary Bernhardt's **Functional Core / Imperative Shell** contributes
primarily to the boundary-analysis side of Resilient.

Programs interact with uncertain external systems:

``` text
network
database
filesystem
DOM
CMS
user input
environment
third-party APIs
```

Bernhardt's architectural approach separates those interactions from a
more deterministic computational core.

Conceptually:

``` text
EXTERNAL / UNCERTAIN
        ↓
     boundary
        ↓
 normalize / establish
        ↓
  PREDICTABLE CORE
        ↓
 preserve invariants
        ↓
     boundary
        ↓
EXTERNAL / UNCERTAIN
```

### Relationship to Resilient

The architecture itself identifies **where uncertainty lives**.

This supports a central Resilient idea:

> Defensive reasoning does not need to be uniformly distributed
> throughout a program if uncertainty is identified and resolved at
> boundaries.

------------------------------------------------------------------------

## Alexis King: Parse, Don't Validate

Alexis King's **Parse, Don't Validate** arrives at a closely related
boundary principle from the static functional-programming tradition.

External data begins uncertain.

Rather than repeatedly checking that data throughout the application,
uncertainty should be discharged when the data crosses into the trusted
system.

Conceptually:

``` text
UNKNOWN
   ↓
BOUNDARY
   ↓
parse / normalize
   ↓
KNOWN
```

King's solution then uses the type system to preserve the knowledge
established by parsing.

### Relationship to Resilient

Resilient agrees strongly with the first half:

> Resolve ambiguity at the earliest trustworthy boundary.

The philosophies diverge afterward.

King's model is approximately:

``` text
boundary validation
       ↓
type carries proof
```

Resilient's direction is:

``` text
boundary establishment
       ↓
executable invariant
       ↓
constrained transformations
       ↓
static analysis verifies preservation
```

The established runtime invariant---not an annotation---is the original
source of truth.

------------------------------------------------------------------------

# The Intellectual Lineage

The philosophical heritage can therefore be represented approximately
as:

``` text
Floyd / Hoare / Dijkstra
          │
          │ program correctness
          │ propositions
          │ invariants
          ↓
    Bertrand Meyer
          │
          │ Design by Contract
          │ pre/postconditions
          ↓
Findler / Felleisen ───────── Hickey
          │                     │
          │ component contracts │ specifications
          │ blame               │ predicates
          │                     │
          └──────────┬──────────┘
                     ↓
              RESILIENT
                     ↑
                     │
             Bernhardt / King
                     │
              boundary discipline
```

------------------------------------------------------------------------

# Where Resilient Diverges

The distinctive Resilient proposition is not simply:

> JavaScript doesn't need static types.

It is closer to:

> **Infer contracts from disciplined executable JavaScript, identify
> where trust enters and leaves the system, and statically verify that
> transformations preserve established invariants.**

Different traditions solve portions of this problem differently.

**Meyer:** Write the contract explicitly.

**Findler/Felleisen:** Enforce contracts between components and identify
who violated them.

**Hickey:** Describe meaningful specifications using predicates rather
than equating specification with type.

**Bernhardt:** Architect the system so uncertainty is concentrated at
identifiable boundaries.

**King:** Resolve uncertain external representations at boundaries and
preserve the resulting knowledge.

**TypeScript:** Describe expected representations in a parallel
compile-time type system and propagate those assumptions.

**Resilient:** Allow executable JavaScript to establish contracts and
use static analysis to infer, propagate, and verify them.

------------------------------------------------------------------------

# The Central Distinction

The philosophical difference can ultimately be reduced to two questions.

A conventional static type system asks:

> **What values may this expression represent according to the
> compiler's model?**

Contract and boundary analysis asks:

> **What must actually be true here, who established that fact, and
> which operations can invalidate it?**

This distinction becomes especially important at runtime boundaries.

``` text
EXTERNAL REALITY
       ↓
     unknown
       ↓
runtime contract
       ↓
established invariant
       ↓
disciplined transformations
       ↓
preserved invariant
```

The objective is therefore not to create another descriptive language
layered on top of JavaScript.

It is to make the discipline of writing reliable JavaScript itself
**machine-verifiable**.
