# Architecture and cross-language research

> Preserved historical or design material. Counts, plans and status below belong
> to their original context. Use the [current record](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/REARCHITECTURE.md) for accepted
> implementation and the [documentation index](../README.md) for the specification.

## Resilient Architecture Ownership and Refactor Method

### Status

Architectural analysis and refactor method, not a new dialect specification or
an instruction to rearrange directories. The authority order remains
[the agreement map](../reference/AGREEMENT_MAP.md), executable Grammar/Policy/Semantics,
proofs, adapter algebra, and the [agent operating contract](https://github.com/augurone/artikulates-resilient/blob/main/AGENTS.md).
The [accepted rearchitecture record](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/REARCHITECTURE.md) owns the
completed baseline and accepted replacements and deletions. This document
explains how to find the next architectural improvement without overruling
those sources.

The completed native-fixed fp-ts artifact has **zero errors**, with 30 async
warnings tracked separately and baseline/generated runtime green at the
accepted checkpoint. That is a compatibility milestone, not evidence that
all duplicate decisions or legacy routes are gone. fp-ts is a broad proof
corpus, never a recognition target or a source of transformer policy.

This brief proposes *logical ownership*. A shared concept does not by itself
justify a shared package, universal AST, new persistent graph, or public API.
Move code only after an inventory identifies a duplicated decision and a
replacement proof covers its full source shape.

### Executive decisions

- Preserve the achieved zero-error corpus and runtime baseline; it measures
  compatibility, not architectural completeness.
- Keep evidence, agreement interpretation, finite Policy outcome, grammar,
  placement, and enforcement as distinct decision rights. Do not let a late
  pass choose an outcome from printed syntax.
- Treat a fact's `action` field and a generated suppression without completed
  provenance as audit candidates, not as automatic defects or precedents.
- Treat evidence, agreement, and derivation “graphs” as logical views until a
  proved consumer requires a new representation.
- Inventory and remove one duplicate route at a time. Preserve lawful legacy
  coverage; share a kernel only after its semantics are common to real
  consumers, not because their directory names look similar.

### 1. Why the refactor exists

Resilient grew in discovery order rather than architectural order.

``` text
ESLint rule
  ↓
recognize syntax
  ↓
infer meaning
  ↓
apply policy
  ↓
report
```

As contracts began propagating through functions, flow, modules,
aliases, operations, and returns, `rules/contracts` accumulated general
program knowledge.

TypeScript lowering then needed richer evidence: checker facts, erased
intent, shapes, capabilities, evaluation order, source observables, and
behavior-preserving transformations. Because no shared architectural
owner yet existed for all of that knowledge,
`transforms/typescript/understand`, transform policy, lowering, grammar,
and exception handling learned overlapping answers.

fp-ts exposed the transition. At 6,000+ disagreements, the problem was
missing capability. Near zero, the question becomes:

> Why are multiple subsystems independently discovering or deciding the
> same agreements?

The refactor goal is therefore:

> **Give evidence, agreement, policy, lowering, grammar, enforcement,
> and exceptions explicit ownership, and prevent a second authority from
> rediscovering an agreement already owned elsewhere.**

### 2. The essays already describe the architecture

#### The Code Is the Contract

``` text
SOURCE → EVIDENCE
```

Executable source is the primary evidence for application-owned
agreements.

#### Software as an Agreement Engine

``` text
EVIDENCE → AGREEMENT
producer ↔ consumer
```

Evidence matters because participants offer and require agreements.

#### The Fallacy of the Unknown Cliff

``` text
known | contradiction | unknown
```

Evidence has boundaries. Unknown is an epistemic state, not a fallback
or generic failure.

#### Let's Define Undefined

``` text
T+
D(T)

undefined     ≠ D(T)
unknown       ≠ undefined
contradiction ≠ unknown
```

Positive values, falsifiable/default values, absence, unknown, and
contradiction have distinct jobs.

#### Style Is Grammar

``` text
agreement → grammar → executable source
```

Native ECMAScript forms can carry recurring semantic responsibilities
and compose into mechanically recoverable agreement.

#### How to Swear in Resilient

``` text
grammar → program → exception → evidence → grammar feedback
```

Legitimate departures remain explicit, scoped, reviewable, and
measurable.

Together:

``` text
CODE
 ↓
evidence
 ↓
AGREEMENT
 ↓
grammar
 ↓
CODE
```

Analysis moves primarily from code toward agreement. Lowering
participates in agreement while moving toward another executable
grammar.

### 3. Holistic architecture

``` text
┌──────────────────────────────────────────────────────────────────────┐
│                           SOURCE SURFACES                            │
│                                                                      │
│      ECMAScript              TypeScript               Future         │
│      ESTree                  TS AST + checker         Python/adapters│
│      runtime forms           declarations              shapes        │
└────────────┬──────────────────────┬─────────────────────┬────────────┘
             └──────────────────────┼─────────────────────┘
                                    ▼
┌──────────────────────────────────────────────────────────────────────┐
│                       UNDERSTAND / EVIDENCE                          │
│                                                                      │
│             "What can this source actually establish?"               │
│                                                                      │
│ syntax • identity • provenance • bindings • signatures • defaults    │
│ operations • members • returns • control • capabilities • traversal  │
│ effects • mutation • evaluation order • observables • shapes         │
│ module relationships                                                 │
│                                                                      │
│ TypeScript adds checker-backed evidence: tuples, unions, declared    │
│ intent, generic relationships, narrowing, erased/provider shapes.    │
│                                                                      │
│                  OBSERVES — DOES NOT PERMIT                          │
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ evidence + provenance
                                   ▼
╔══════════════════════════════════════════════════════════════════════╗
║                        AGREEMENT FRAMEWORK                           ║
║                                                                      ║
║             "What relationships does the evidence support?"          ║
║                                                                      ║
║ Epistemology:       KNOWN | CONTRADICTION | UNKNOWN                  ║
║                                                                      ║
║ Primitives: producer • consumer • offer • requirement • evidence     ║
║ provenance • compatibility • derivation • boundary • ownership       ║
║ composition • resolution                                             ║
║                                                                      ║
║ Families: values/defaults • shapes • capabilities • returns          ║
║ callbacks • control • async/failure • iteration • mutation • modules ║
║ providers • interfaces • lowering/preservation                       ║
║                                                                      ║
║                   AGREEMENT IS RELATIONAL                            ║
║             producer ── offers ──► consumer                          ║
║             producer ◄ requires ── consumer                          ║
╚══════════════════════╤═══════════════════════════════════════════════╝
                       │
           ┌───────────┼───────────────────┐
           ▼           ▼                   ▼
┌────────────────┐ ┌─────────────────┐ ┌────────────────┐
│    ANALYSIS    │ │    LOWERING     │ │     POLICY     │
│                │ │                 │ │                │
│ discover and   │ │ source ↔ target │ │ which valid    │
│ propagate      │ │ preservation    │ │ forms are      │
│ agreements     │ │ agreement       │ │ accepted here? │
│ contradictions │ │                 │ │                │
│ unknown edges  │ │ preserve:       │ │ invariants     │
│ ownership      │ │ order/timing    │ │ accepted forms │
│ graph          │ │ receiver        │ │ exceptions     │
│ diagnostics    │ │ iterator        │ │                │
└───────┬────────┘ │ failure/identity│ └───────┬────────┘
        │          └───────┬─────────┘         │
        │                  ▼                   │
        │           ┌──────────────┐◄──────────┘
        │           │TARGET GRAMMAR│
        │           │defaults      │
        │           │guards        │
        │           │transforms    │
        │           │resolvers     │
        │           │returns       │
        │           │async paths   │
        │           └──────┬───────┘
        │                  ▼
        │              ECMAScript
        │                  │
        │                  └────► UNDERSTAND / EVIDENCE
        │                              ↓
        │                         AGREEMENT ANALYSIS
        │                              ↓
        │                  source agreement ≃ target agreement?
        │
        ├──────────────────────────────────────────────┐
        ▼                                              ▼
┌──────────────────┐                         ┌──────────────────┐
│ESLINT/ENFORCEMENT│                         │   EXPOSE/QUERY   │
│policy violations │                         │agreement graph   │
│contradictions    │                         │evidence          │
│strict diagnostics│                         │provenance/shapes │
│NOT the theory    │                         │unknown boundaries│
└────────┬─────────┘                         └──────────────────┘
         ▼
┌────────────────────────────┐
│    EXCEPTION GOVERNANCE    │
│named rule • narrow scope   │
│concrete semantic reason    │
│claim provenance            │
│exception ≠ proof           │
└────────────┬───────────────┘
             ▼
┌──────────────────────────────────────────────────────────────────────┐
│                         GRAMMAR FEEDBACK                             │
│ repeated legitimate exceptions may expose missing forms, bad policy, │
│ missing agreement families, weak boundary models, or missing facts.  │
│                                                                      │
│              PROGRAM PROVIDES EVIDENCE ABOUT GRAMMAR                 │
└──────────────────────────────────────────────────────────────────────┘
```

The boxes are responsibilities, not proposed directories or processes.
In particular, the Agreement Framework box names common semantics; it does
not assert that ESLint analysis and TypeScript lowering must share one AST,
one mutable graph, or one implementation object. Keep the existing
`rules/contracts/` analyzer independent of adapter convenience. Extract a
shared kernel only for an operation both consumers actually perform with the
same inputs, outputs, and laws.

### 4. Understand / Evidence

`Understand` should not become a universal analyzer or policy engine.

Its question is:

> **What can this source establish?**

Evidence may observe. Evidence may not grant permission.

A useful ownership test:

> **If Analysis and Lowering can truthfully ask the same factual
> question about source, the answer probably belongs in
> Understand/Evidence.**

Examples:

-   What source construct is this?
-   Where did it come from?
-   What identity/provenance owns it?
-   What capabilities are established?
-   What shape is known?
-   What traversal protocol exists?
-   Where are observable effects?
-   What remains unknown?
-   Which facts exist only because TypeScript's checker exposes them?

TypeScript legitimately contributes richer evidence than emitted
ECMAScript. That evidence should survive erasure where it matters,
without becoming automatic permission.

#### The fact/decision seam to repair

An immutable fact may say *which source operation exists*, its checker symbol,
original range, owner, phase, and observable constraints. It must not say
that the operation is permitted, should lower, or deserves an exception.
Policy maps that fact and the applicable agreement to one finite outcome;
grammar and placement consume the outcome without rediscovery.

The current transformer does not always honor this boundary literally. Some
`collect…Contracts` facts carry an `action` field, and some Policy paths return
that field. This is an **audit finding**, not a reason to mechanically rename
fields or delete working lowering. For each such field, determine whether it
is (a) a factual operation label with a misleading name, (b) a preselected
policy outcome, or (c) a completed agreement passed through Understand. Move
the decision only with a focused negative proof and corpus parity. A new
shared fact schema that merely copies the same `action` into a different
location would not fix the ownership problem.

### 5. Agreement is the center

Agreement is not merely an analyzer subsystem. It is the shared
relational framework.

Examples:

``` text
producer agrees with consumer
value agrees with operation
return agrees with function contract
callback agrees with invocation
provider agrees with requirement
module export agrees with importer
source agrees with lowered target
adapter shape agrees with interface requirement
```

Shared primitives should include at least:

``` text
known / unknown / contradiction
producer / consumer
offer / requirement
evidence / provenance
compatibility / derivation
boundary / ownership
composition / resolution
```

Specialized agreement families can build on those primitives without
independently redefining them.

Architectural invariant:

> **Two consumers must not independently redefine the same agreement
> semantics.**

Shared *law* is not automatically shared *inference*. ESTree analysis and a
TypeScript checker may reach compatible agreement conclusions from different
evidence. Compare their producer/consumer, presence, operation, failure, and
ownership relations; do not force one consumer to simulate the other's AST.
Identity is the source range plus symbol/provenance and lexical owner where
available, not a generated name guessed after lowering.

### 6. Analysis participates in agreement

Analysis asks:

> **What agreements can be established from available evidence?**

It owns propagation, compatibility, contradiction detection, unknown
boundaries, ownership relationships, module relationships, graph
construction, and diagnostics.

It must not manufacture evidence.

When evidence ends:

``` text
unknown
```

A proof obligation may fail closed because the relationship is unknown.
That does not mean unknown itself is failure.

### 7. Lowering participates in agreement

Lowering is not merely downstream from Analysis.

It makes a new claim:

> **This target representation preserves the relevant source agreement
> and source observables.**

``` text
SOURCE EVIDENCE
      ↓
SOURCE AGREEMENT
      ↓
    LOWERING
      ↓
TARGET GRAMMAR
      ↓
TARGET SOURCE
      ↓
TARGET EVIDENCE
      ↓
TARGET AGREEMENT
```

The required relationship is:

``` text
source agreement ≃ target agreement
```

Here `≃` uses the boundary-relative equivalence defined by
[the proofs](../reference/resilient-proofs.md), not textual similarity or a claim about
all imaginable consumers. State the admitted input domain, source and target
owners, normal and failure channels, and the observables available at that
boundary. Then compare source and target executions for admitted source inputs,
including normal and abrupt traces. If the representations differ, state the
mapping used for comparison. A TS declaration alone is not runtime validation;
unknown evidence stays unknown.

Current preservation obligations include evaluation count/order, getter
and call timing, receiver binding, iterator liveness, native failure
phase, key/value identity, callback count, argument order,
mutable-builder identity, and direct-return ownership.

A lowering is not correct because lint passes. Lint cleanliness is one
consequence of a proved lowering agreement. A retained source form may also
be the only correct outcome when a preferred grammar changes the observation
trace. In that case Policy names the boundary; it does not invent a value to
manufacture a cleaner target.

### 8. Lowering proof loop

``` text
source agreement + declared domain/observables
       ↓
     LOWER
       ↓
target grammar
       ↓
target code
       ↓
  UNDERSTAND
       ↓
target evidence
       ↓
    ANALYZE
       ↓
target agreement
       ↓
       ?
       ↓
source agreement
```

The return arrow is a **comparison**, not an inference that can be performed
from generated ESLint output alone. Target reanalysis can detect a lost
agreement or an introduced contradiction, but cannot recover checker-only
intent that was erased. Keep the source fact and derivation as provenance
through placement; compare what each side can truthfully establish. A passing
runtime corpus is necessary acceptance evidence for a completed packet, not a
proof for every possible source program.

A mature acceptance model can combine:

``` text
behavioral parity
+
agreement parity
+
strict Resilient grammar
```

Agreement parity adds a proof dimension; it does not replace runtime
tests.

### 9. Policy is not evidence

Policy asks:

> **Which valid language forms does the Resilient dialect permit at this
> boundary?**

Valid ECMAScript does not automatically mean accepted Resilient grammar.

Every policy restriction should name its invariant, evidence, owning
boundary, unknowns, and legitimate exception model.

### 10. Grammar expresses agreement

Grammar is the executable form through which agreements remain legible.

Examples include destructured signatures, explicit defaults, guards,
returned transformations, resolvers, owned async paths, explicit mutable
boundaries, and module relationships.

Restriction alone is not grammar.

> **Forms become grammar when meaning established by one can be
> preserved, consumed, transformed, or contradicted by another.**

``` text
signature → default → operation → return → next use
```

### 11. Exception governance

There are two provenance classes. An **authored exception** is a human claim
that preserving the contract requires relaxing one named policy at one
boundary. A **generated retained-boundary annotation** is a transformer claim
backed by a completed source agreement and a counterexample to the proposed
preferred rewrite, or another specific preservation obligation it cannot
yet discharge. This does not prove that no future lawful grammar exists. Neither
claim is a policy rule, a fact about incoming runtime data, or a proof by
itself. The generated class has the *stronger* obligation to identify its
source fact, selected outcome, exact placement, and the concrete preservation
obligation or counterexample that defeats the proposed preferred lowering.

Both classes must have:

``` text
named rule
narrow scope
concrete semantic reason
visible source location
continued enforcement of unrelated obligations
```

Neither validates data, turns unknown into known, makes a contradiction
correct, creates global permission, or proves runtime behavior. A directive
may be emitted only after its owning policy outcome is fixed; a final pass
must not classify generated syntax to decide whether to invent one.

[Policy P-03](../reference/policy.md#p-03-exceptions-and-precedence) owns the permitted
repository directive forms. The transformer has historically emitted some
other comment shapes, including `eslint-disable-line`; zero corpus errors
does not certify those comments as compliant with P-03. Audit them by source
fact and reason before changing the printer or deleting a boundary. Preserve
runtime parity and unrelated rule enforcement during that cleanup.

Repeated legitimate exceptions are measurable evidence about the
adequacy of grammar, policy, boundary modeling, or evidence collection.

### 12. Loops as a vertical slice

The proposed loop recovery is a useful reference implementation.

#### Evidence

``` js
{
    kind: 'loop',
    key: '<source identity>',
    evidence: {
        traversal: 'array',
        effects: 'ordered-async',
        control: 'none',
        mutation: 'fresh-local-only'
    }
}
```

No permission belongs in the fact.

#### Agreement

Interpret those facts and compare a candidate target against the source
behavior.

``` text
for...of
    ↓
map?
```

Ask:

``` text
same traversal?
same cardinality?
same evaluation order?
same callback semantics?
same mutation visibility?
same async behavior?
same failure phase?
```

Possible agreement results, before Policy chooses a permitted form:

``` text
compatible    → candidate may lower under Policy
unknown       → preserve or request more evidence
contradiction → reject candidate
```

#### Policy / enforcement

A retained loop can still be outside ordinary grammar. Authored source may
need a narrow human exception. Generated source may receive an exact
annotation only if the source agreement and retained operational outcome
have been proved; it must not be a lint-cleaning fallback.

Understanding why a loop exists is not the same as granting permission.

For example, a direct live `Set` traversal can observe additions during
visitation. A target that first materializes the set may pass an ordinary
empty/nonempty test yet fail that liveness observation. Understand records the
standard collection and exact loop/update ranges; Agreement rejects the
materialization candidate; Policy selects a retained operational unit; Grammar
keeps the direct loop; placement carries only that completed decision. A
focused hostile-iterator/live-addition proof precedes corpus measurement.
No layer is allowed to infer a different outcome merely because the generated
loop looks inconvenient to lint.

### 13. Three distinct graphs

Avoid making "graph" another junk drawer.

#### Evidence graph

``` text
Where did this fact come from?

source → binding → operation → return → alias → module
```

#### Agreement graph

``` text
Who promises what to whom?

producer → offer ↔ requirement ← consumer
```

#### Derivation/proof graph

``` text
Why is this conclusion justified?

agreement
  ↓
derivedFrom
  ├── source fact
  ├── checker fact
  ├── operation
  └── prior agreement
```

These are three *queries* over provenance, obligations, and derivation, not
three required databases. Start with the existing source-range and symbol
identity mechanism. Introduce an explicit graph representation only when a
proved consumer needs a relation that cannot be faithfully expressed by the
current immutable facts and agreement record. Never reconstruct source
identity from printed names or generated text.

### 14. Cross-language implications

The Agreement core should not require a universal AST.

``` text
ECMAScript ─► ECMA evidence ────┐
TypeScript ─► TS evidence ──────┼──► AGREEMENT
Python ─────► Python evidence ──┘
```

Python is a plausible future stress test because its dynamic, structural
ecosystem exposes related agreement problems while remaining a different
language. It is not a current implementation dependency or evidence that the
proposed kernel is language-independent. Prove that claim with a second
adapter before promoting it into an architectural requirement.

Go and Rust need not become Resilient dialects. They can participate
through agreement adapters:

``` text
Go/Rust interface
      ↓
Agreement Adapter
      ↓
offered/required shape
      ↕
interface agreement
```

Agreement, not Resilient syntax, is the interoperability layer.

### 15. Refactor method after zero errors

Do not begin by inventing the final directory tree. Zero native-fixed errors
and green runtime create a **baseline to protect**, not a license to delete
all retained paths. The remaining work is route ownership and duplicate
decision removal. Some boundaries represent irreducible source behavior.

#### 15.1 Inventory one route at a time

For each major collector, Policy branch, grammar/lowerer, annotation pass,
and legacy fallback, record:

| Field | Question |
| --- | --- |
| Source shape and owner | Which original AST ranges, checker symbols, lexical scope, and input/result/failure owners does it serve? |
| Fact | What does it observe without choosing an outcome? Which evidence is unknown? |
| Agreement and outcome | Which obligation is interpreted, and where is the **single** finite Policy decision made? |
| Placement | Which exact source unit is replaced or retained? How does original-node identity survive later passes? |
| Observables | Which evaluation, iterator, receiver, identity, callback, failure, arity, and return properties could change? |
| Consumers | Which passes use the completed decision? Does another pass classify the same operation from generated syntax? |
| Proof and coverage | Which positive, guarded, and rejected shapes prove the route, and which corpus sites exercise it? |
| Replacement status | Is another path equivalent on the *entire* source shape, only an overlap, or no overlap? |

Do not confuse **capability debt** (“no lawful handling is known”) with
**architectural debt** (“two paths know the same answer”) or **policy debt**
(“the accepted boundary/comment form disagrees with the governing policy”).
The three require different repairs. A zero-error corpus does not prove that
none remain.

#### 15.2 Remove duplicate authority, not just code

Each implementation packet follows the governing sequence:

``` text
Grammar → Policy → Semantics → checker → Understand → Policy → Grammar → placement → proof
```

1. Identify a repeated decision by source operation and owner, not by a
   package file, lint rule, helper name, or shared string.
2. Name the governing grammar and policy law, then find its existing fact and
   completed agreement. Extend that record if evidence is missing; do not add
   a parallel origin map or new classifier.
3. Prove the smallest positive, guarded, and rejection cases, including a
   counterexample that would make the old shortcut unsound.
4. Route later passes to the completed outcome. Only then remove an overlapping
   classifier, lowerer, import, and dead helper when its **full** source-shape
   coverage is replaced. Retain lawful non-overlapping branches.
5. Run the repository gate and one completed corpus runtime/lint measurement
   for the replacement packet. Record replacement, focused proof, deleted
   route, and measured delta in the evidence ledger. A zero lint delta can
   still be an accepted architectural improvement; a regression cannot.

Use focused proofs during development. The full corpus is an acceptance and
regression check for a completed packet, not the inner loop for each assertion.
The current 30 async warnings remain a separate inventory; their mere
presence does not authorize a broad async rewrite or a warning suppression.

#### 15.3 Extract a shared kernel only when it reduces decisions

`rules/contracts/` is the existing senior implementation of agreement
inference and flow. It is a reference to compare against, not a package to
modify for transformer convenience. A shared primitive is warranted when
both consumers use the **same semantic operation**—for example presence or
compatibility—with a stable input/output contract and proofs independent of
either AST. If an extraction needs TS checker nodes, ESTree node shapes,
generated comments, or corpus names in its core API, the seam is misplaced.

The first deliverable for a new effort is an ownership inventory and a small
deletion candidate with exact replacement coverage, not a framework migration.
The [accepted record](https://github.com/augurone/artikulates-resilient/blob/main/docs/engineering/REARCHITECTURE.md) preserves the prior
packet outcomes and whether those deletions were accepted.

### 16. Core invariants for the rearchitecture

#### Evidence

> **Evidence may observe. It may not grant permission.**

#### Agreement

> **No participant may independently rediscover or redefine an agreement
> already owned elsewhere.**

#### Policy

> **Policy may permit or reject forms only in service of a named
> invariant.**

#### Lowering

> **Lowering must agree with the source it replaces.**

#### Grammar

> **Grammar expresses agreement through composable native forms.**

#### Enforcement

> **Enforcement reports agreement/policy results; it is not the
> theory.**

#### Exceptions

> **Authored exceptions and generated retained-boundary annotations record
> different claim provenance; neither proves itself.**

### 17. Completion criteria for this refactor

The architectural audit is complete only when every semantics-changing
transformer route has one explicit fact owner, agreement interpretation,
finite Policy outcome, grammar/placement owner, and proof location. Mechanical
printer routes must state their limited ownership and must not classify source
semantics. Overlapping legacy decisions have either been removed with full
replacement coverage or retained with a documented non-overlapping source
shape. Every deletion must appear in the
evidence ledger with corpus parity. No shared framework is required unless a
proved duplication calls for it. The accepted zero-error artifact and green
runtime baseline must remain intact, while the 30 async warnings stay a
separate question.

This is a stricter finish line than “the corpus lints”: it measures who owns
each decision and whether later passes preserve it. It is also narrower than
“rewrite the whole analyzer”: lawful existing code does not need to move merely
to fit the diagram.

### 18. North star

The target architecture should make this statement true in
implementation, not merely in prose:

> **Evidence may observe. Agreement may conclude. Policy may permit.
> Lowering may preserve. Grammar may express. Enforcement may report.
> Exceptions may disagree.**

And the entire system should preserve the founding principle:

> **The Code Is the Contract.**

Resilient should not maintain multiple competing structures that
rediscover what another part of the program already knows.

The next architecture should be the smallest system that can explain how
authored Resilient, generic lowered TypeScript (tested on the current fp-ts
corpus and future independent corpora), and eventual agreement adapters
participate in the same model without fabricating knowledge or duplicating
authority.

## The Argument for Resilient Python

Status: Proposal for a second language expression; this document does not
claim a shipped Python analyzer or change ECMAScript policy.

### Thesis

Resilient should have a Python expression because Python tests whether the grammar is genuinely language-independent without changing its meaning.

JavaScript and Python share the conditions that make Resilient necessary:

- dynamic values,
- runtime uncertainty,
- optional static typing layered above execution,
- structural and duck-typed behavior,
- nullable/absent states,
- external data that must be normalized before use,
- functions whose callers depend on stable return shapes.

This makes Python a much stronger second target than a strictly typed language. In Go or Rust, the compiler already owns a large part of the structural agreement problem, so Resilient changes roles. In Python, the same grammatical obligations remain visible.

The proposition is simple:

> Resilient Python should express the same grammar of contracts, falsifiable defaults, resolution, and agreement that Resilient expresses in JavaScript.

If the grammar survives that translation with only syntactic changes, Resilient is not a JavaScript style system. It is a broader grammar for dynamically typed software.

---

### 1. Python Has the Same Fundamental Problem

Python permits a program to state or imply a shape without guaranteeing that runtime values will honor it.

```python
def get_name(user):
    return user.name
```

The function assumes that `user` agrees with the capability being exercised.

Likewise:

```python
def get_items(source):
    return source.get("items")
```

The return value may be:

- a list,
- `None`,
- an unexpected value supplied by the source.

The caller inherits that uncertainty.

Optional typing does not remove the problem:

```python
def get_items(source: Source) -> list[Item]:
    return source.items
```

The annotation expresses intent. It does not make the runtime result conform to that intent.

This is the same distinction Resilient already exposes in TypeScript:

\[
TypeIntent
eq RuntimeAgreement
\]

Resilient Python would treat typing information as useful source notation while still requiring executable code to honor the contract.

---

### 2. Falsifiable Defaults Map Directly to Python

Falsifiable default declarations are one of the primary grammatical rules of Resilient, and Python expresses them naturally.

```python
name = ""
items = []
config = {}
count = 0
enabled = False
```

These are not merely convenient initial values.

They declare the shape of the contract through executable behavior.

\[
x = D(T) \Rightarrow x \models T
\]

Examples:

\[
D(String) = ""
\]

\[
D(List) = []
\]

\[
D(Mapping) = \{\}
\]

\[
D(Number) = 0
\]

when zero is the semantic negative state.

Python already uses these patterns idiomatically:

```python
items = source.get("items") or []
name = source.get("name") or ""
```

Resilient would formalize the semantic meaning of those expressions.

They are not just fallbacks.

They are contract declarations and resolution rules.

---

### 3. A Function Contract Contains Success and Failure

The strongest reason for Resilient Python is that Python functions commonly return unrelated failure sentinels.

```python
def get_items(source):
    if not source:
        return None

    return source.get("items")
```

If the positive response is a list, `None` abandons the function's claimed shape.

Resilient defines a contract as containing both a success clause and a failure clause:

\[
C(T)=\langle T^+,D(T)
angle
\]

Therefore:

\[
F(T)=D(T)
\]

For a collection-returning function:

```python
def get_items(source):
    if not source:
        return []

    return source.get("items") or []
```

This example assumes `source` is a mapping whose `items` value has already
been validated as a list or an allowed absent value. Under that precondition,
both success and failure remain expressions of the same collection contract.
For arbitrary external data, `or []` is insufficient: a truthy string passes
through unchanged. A boundary-owned family check or resolver must establish
the precondition before this function consumes the value.

The function is semantically truthful even when it cannot produce a positive value.

That gives Resilient Python a normal-return agreement:

\[
\forall p\in P(f),\quad return(p)\models T
\]

Every reachable normal return path must honor the same contract. This does
not prove termination or replace the function’s exception contract.

---

### 4. Python's Duck Typing Strengthens the Agreement Model

Python makes an important part of Resilient especially clear.

The grammar does not need to ask:

> What nominal type is this value?

It can ask:

> Does this value agree with what the consumer is about to do?

For member access:

\[
x.m \Rightarrow x \models \{m\}
\]

For iteration:

\[
iterate(x) \Rightarrow x \models Iterable
\]

For mapping access:

\[
x[k] \Rightarrow x \models Mapping(k)
\]

For tuple-style extraction:

\[
a,b=x \Rightarrow x \models Iterable$arity(2)
\]

This maps naturally onto Python's structural and duck-typed semantics.

Resilient Python therefore does not need to recreate a nominal type system.

It can analyze whether the executable program establishes sufficient agreement before consumption.

---

### 5. Python Typing Becomes a Lowering Source

Modern Python provides:

- `Any`,
- `Optional`,
- `Union`,
- `X | Y`,
- `TypedDict`,
- protocols,
- dataclasses,
- generic annotations,
- return annotations.

These can serve the same role TypeScript serves in Resilient's JavaScript work: a notation for programmer intent that can be lowered into stronger executable agreements.

For example:

```python
def get_user() -> User | None:
    ...
```

contains useful information:

- the programmer expects `User`,
- failure is currently represented as absence.

Resilient can ask whether absence should instead resolve to the falsifiable `User` shape.

Similarly:

```python
def result() -> User | Error:
    ...
```

expresses semantic ambiguity.

If the alternatives represent genuinely different meanings, Resilient can require a resolver into discriminable shapes:

```python
{
    "kind": "user",
    "value": user,
}
```

or:

```python
{
    "kind": "error",
    "error": error,
}
```

Thus:

\[
TypeIntent

ightarrow
ContractGrammar

ightarrow
ExecutableAgreement
\]

Python typing becomes input to the grammar, not the source of runtime safety.

---

### 6. Python Preserves the Meaning of the Existing Grammar

A good second language should challenge the grammar without forcing it to become a different system.

Python satisfies that condition.

The same rules survive:

#### Falsifiable default

\[
T\mid\varnothing \Rightarrow T\mid D(T)
\]

#### Unknown resolution

\[
U\Rightarrow R(U,T)
\]

#### Return agreement

\[
\forall p\in P(f),\ return(p)\models T
\]

#### Capability agreement

\[
E(x)\Rightarrow x\models E
\]

#### Ambiguous semantic union

\[
T_1\mid T_2\Rightarrow R(T_1)\mid R(T_2)
\]

#### Recursive falsifiable models

\[
D(M)=\{k_1:D(T_1),\ldots,k_n:D(T_n)\}
\]

The AST representation changes.

The syntax changes.

The grammar does not.

That is exactly what a second implementation should prove.

---

### 7. Python Gives Resilient New Evidence

A Python implementation would strengthen several claims about Resilient.

#### Resilient is not an ESLint project

ESLint is the current enforcement surface, not the theory.

A Python AST implementation would demonstrate that the grammar exists independently of ESTree and ECMAScript.

#### Resilient is not anti-TypeScript

If the same grammar can consume Python type hints and lower their intent into executable contracts, the project is clearly not merely a reaction to TypeScript.

The broader claim becomes:

> Static annotations can describe intent, but dynamic programs still require executable agreement.

#### Resilient is not a JavaScript style guide

If the same contract algebra applies cleanly to Python, conventions such as falsifiable defaults and shape-preserving failure are no longer stylistic preferences.

They are grammatical consequences of a language-independent contract model.

#### Resilient describes dynamic software boundaries

JavaScript and Python both live heavily at boundaries:

- HTTP,
- JSON,
- databases,
- user input,
- configuration,
- automation,
- AI/model output,
- third-party libraries.

Those are exactly the places where external possibility must become internal agreement.

---

### 8. What Resilient Python Would Analyze

A first Python implementation could focus narrowly on the same high-value grammar.

#### Return contract analysis

Infer or read the intended positive shape and verify every return path.

Flag:

```python
return None
```

when the function contract is a collection, string, model, or other incompatible shape.

#### Falsifiable default enforcement

Recognize declarations such as:

```python
items = []
```

and ensure later assignments preserve that shape or explicitly resolve into it.

#### Member and key access

Track unresolved values into:

```python
x.attr
x["key"]
```

and require sufficient upstream agreement.

#### Destructuring and positional extraction

Analyze:

```python
a, b = value
```

as an arity and iterable contract.

#### Boundary normalization

Identify external or uncertain values and require resolution before stable internal use.

#### Optional and union lowering

Use Python type annotations as signals of unresolved absence or ambiguity and recommend or transform them into contract-preserving forms.

---

### 9. The Architectural Shape

Resilient Python should not duplicate the grammar.

The architecture should separate broad rules from language surfaces.

```text
Resilient Agreement Grammar
        |
        +-- ECMAScript semantics
        |      |
        |      +-- JavaScript analysis
        |      +-- TypeScript lowering
        |
        +-- Python semantics
               |
               +-- Python AST analysis
               +-- Python typing lowering
```

The shared grammar defines:

- contract,
- success clause,
- failure clause,
- falsifiable default,
- resolver,
- agreement,
- totality,
- boundary,
- ambiguity.

The Python layer defines only how those concepts are recognized and expressed in Python.

---

### 10. Why Python Is the Right Next Test

Strictly typed languages change the problem too much.

In Rust, algebraic data types, exhaustive matching, `Option`, and `Result` already encode large portions of structural uncertainty.

In Go, static typing and explicit error returns similarly shift the grammar toward policy about failure handling rather than establishing shape agreement.

Those languages may eventually be interesting applications of Resilient principles, but they are poor tests of whether the current grammar generalizes unchanged.

Python is different.

It preserves:

- dynamic execution,
- optional typing,
- structural behavior,
- runtime uncertainty,
- implicit contracts,
- shape ambiguity.

That makes it close enough for the grammar to retain its identity and different enough to validate that the grammar is not JavaScript-specific.

---

### Conclusion

The argument for Resilient Python is not that Python needs JavaScript rules.

It is that both languages expose the same underlying problem:

\[
Possibility
eq Agreement
\]

Resilient supplies the missing grammar.

A function promises a shape.

That promise includes success and failure.

Failure must remain a falsifiable expression of the promised shape.

Unknown values must be resolved before consumers rely on them.

Boundaries must translate external possibility into internal agreement.

Static type notation may describe intent, but executable code must make that intent true.

If those rules can be expressed over Python's AST with the same algebra used for JavaScript, then Resilient has crossed an important boundary of its own:

> It is no longer merely a JavaScript dialect. It is a grammar for resilient dynamically typed software.

## What Glass Fort Can Contribute to Resilient

### Purpose

Glass Fort and Resilient are not attempting to solve the same problem.

Glass Fort describes itself as a **domain-invariant, lossless relational atlas**: a system for preserving differentiated views, relations, transformations, provenance, and consequences while seeking invariant structure across them.

Resilient is considerably narrower and more reductionist. Its concern is executable ECMAScript: derive contractual agreement from code, preserve the distinctions required for predictable execution, propagate those agreements through a resolved graph, and allow unnecessary information to be managed out of the system.

The purpose of studying Glass Fort should therefore **not** be to incorporate its ontology into Resilient.

The useful question is:

> What problems has Glass Fort been forced to articulate that Resilient may encounter as agreement analysis expands beyond local syntax into transformations, boundaries, and whole-application graphs?

The Fort can be treated as an adjacent experiment in relational analysis.

Take useful questions.

Do not inherit unnecessary machinery.

---

### 1. Shared Territory: Invariants Under Transformation

The clearest common ground is the search for invariants beneath changing representations.

Glass Fort's discovery sequence explicitly calls for:

1. reconstructing a domain in its native grammar;
2. identifying domain-native relations;
3. comparing structural functions rather than surface vocabulary;
4. freezing the smallest invariant relation that survives deformation;
5. testing that invariant against untouched and prospective cases without retuning.

This resembles the empirical development of Resilient.

Resilient encounters many surface representations:

```text
syntax A
syntax B
syntax C
TypeScript A
TypeScript B
framework convention
library idiom
```

and asks whether they reduce to a smaller executable relationship:

```text
producer
    ↓
contract
    ↓
transformation
    ↓
consumer
```

The important shared question is:

> What remains true when representation changes?

#### Consideration for Resilient

Make **invariance under transformation** explicit as an analytical concept.

A candidate Resilient invariant should survive:

- equivalent ECMAScript expressions;
- TypeScript lowering;
- syntactic normalization;
- composition;
- function boundaries;
- module boundaries;
- framework-mediated relationships;
- refactoring that preserves executable behavior.

The invariant is not the syntax.

The invariant is the agreement that survives the syntax.

---

### 2. Native Grammar Before Cross-Domain Transfer

Glass Fort explicitly warns against discovering a universal grammar first and imposing it upon individual domains. It says a domain must first be reconstructed according to the transformations, clocks, custody rules, resistance, closure, and consequences recognized by that domain itself.

This strongly reinforces an existing Resilient direction:

> Stay close to ECMAScript.

Resilient should not become an abstract contract language that happens to compile to JavaScript.

Its grammar should remain grounded in executable ECMAScript semantics.

Frameworks, TypeScript, JSX, and other representations can contribute additional evidence, but they should resolve toward executable agreements rather than replace the native language with a new ontology.

#### Consideration for Resilient

Preserve the hierarchy:

```text
ECMAScript semantics
        ↓
Resilient grammar
        ↓
contract inference
        ↓
agreement analysis
        ↓
framework/project conventions
```

rather than:

```text
Resilient ontology
        ↓
JavaScript interpreted through it
```

The first can be falsified against the runtime.

The second risks becoming self-confirming.

---

### 3. Agreement May Belong to the Edge

Glass Fort places unusual emphasis on relations themselves carrying information.

Its representation model attempts to preserve not merely objects or views, but correspondence, opposition, sequence, containment, constraint, return, transformation, and invariant relations among them.

This suggests an important question for Resilient.

Resilient frequently describes:

```text
Producer Contract

Consumer Contract
```

But agreement does not reside entirely in either participant.

It exists **between them**.

A future graph representation might therefore treat the edge as a first-class analytical object:

```text
Producer
    │
    │ AgreementEdge
    │
    ▼
Consumer
```

Conceptually:

```text
AgreementEdge {
    producer
    consumer
    producerContract
    consumerContract
    relation
    evidence
    transformation
    resolution
}
```

This is not a proposed implementation shape.

It is an analytical question:

> Is the relationship between contracts itself information Resilient needs to preserve?

Possible edge states might conceptually include:

```text
SATISFIED
DISAGREEMENT
UNKNOWN
CONDITIONALLY_SATISFIED
TRANSFORMED
FRAMEWORK_SUPPLIED
```

The exact vocabulary should emerge from executable requirements rather than be invented in advance.

---

### 4. Contract Provenance and Contract Authority

One of Glass Fort's strongest ideas is that informational categories cannot silently promote into one another.

It distinguishes observation, testimony, memory, inference, model output, interpretation, authority, ethical judgment, symbolic meaning, and prediction, even when they concern the same object. It also requires uncertainty to remain local rather than replacing the entire analysis with uncertainty.

Resilient may eventually need an analogous distinction for **contract evidence**.

Consider:

```text
Contract: {}
```

Resilient may know that for very different reasons:

```text
executable guarantee

consumer requirement

producer inference

explicit default

control-flow evidence

framework convention

project configuration

lowered TypeScript intent

external boundary declaration

unresolved assumption
```

Those sources should not necessarily possess equal authority.

For example:

```text
TypeScript says {}
```

is not necessarily equivalent to:

```text
every executable path returns {}
```

Likewise:

```text
Next.js convention guarantees X
```

is different from:

```text
Resilient inferred X from this function body
```

#### Consideration for Resilient

Investigate whether a contract eventually needs:

```text
contract
+
evidence
+
provenance
+
scope
```

This does **not** mean carrying provenance indefinitely.

Under Resilient's managed-loss principle, provenance should survive only as long as something downstream requires the distinction.

---

### 5. Local Unknown Should Remain Local

Glass Fort explicitly states:

> A local uncertainty remains local.

It abstains on the unavailable fact rather than replacing otherwise useful work with an empty result.

This strongly parallels Resilient's existing principle:

> Unknown is evidence, not failure.

Whole-graph analysis makes this increasingly important.

Given:

```text
A → B → C → ? → E → F
```

an unresolved boundary should not automatically imply:

```text
A → UNKNOWN
B → UNKNOWN
C → UNKNOWN
E → UNKNOWN
F → UNKNOWN
```

Known agreements should remain known.

The unresolved edge should remain visible as an unresolved edge.

#### Consideration for Resilient

Agreement propagation should preserve the **smallest possible uncertainty boundary**.

Unknown should propagate only when a downstream conclusion actually depends upon the unknown information.

This could become one of the defining differences between Resilient and conservative type systems.

---

### 6. Agreement Exists at Multiple Scales

Glass Fort explicitly distinguishes nested scales and warns that closure at one scale does not imply closure at another. A smaller story can close while the larger system remains open.

There is an obvious software analogue:

```text
expression
    ↓
statement
    ↓
function
    ↓
module
    ↓
component
    ↓
route
    ↓
application
```

Resilient will increasingly need to distinguish between:

```text
LOCAL AGREEMENT

BOUNDARY AGREEMENT

GRAPH AGREEMENT
```

A function may be internally safe while violating its consumer's contract.

A locally ambiguous function may become completely constrained by its graph position.

A component may satisfy its direct caller while a framework-mediated relationship remains unresolved.

#### Consideration for Resilient

Ask of every agreement:

> At what scope has this actually been established?

Do not silently promote:

```text
local proof
```

into:

```text
graph proof
```

and do not allow graph uncertainty to erase valid local proof.

---

### 7. Transformations Change What Can Subsequently Be Known

Glass Fort models consequence recursively:

```text
state
→ action
→ consequence
→ next state
```

Its central point is that passage changes the possibility field available afterward.

Programming-language theory already contains more appropriate vocabulary for the software version of this problem: control-flow analysis, narrowing, data-flow analysis, abstract interpretation, reachability, and so forth.

Resilient should **not import Glass Fort terminology where established computer-science terminology already exists**.

But the conceptual question remains useful.

For example:

```js
const read = (value) => {
    if (!value) return '';

    return value.name;
};
```

After the guard, the set of reachable possibilities has changed.

Likewise:

```js
const normalize = ({ name = '' } = {}) => ({
    name
});
```

has deliberately discarded information while establishing a stronger downstream shape.

#### Consideration for Resilient

Treat transformations not merely as operations upon values, but as operations upon the **agreement possibilities available downstream**.

Conceptually:

```text
incoming possibilities
        ↓
transformation
        ↓
information gained/lost
        ↓
remaining possible contracts
        ↓
downstream agreement
```

Existing compiler theory should provide the machinery.

Resilient supplies the agreement semantics.

---

### 8. Necessary Difference

Glass Fort repeatedly insists that genuine differences must not be destroyed merely to produce coherence. Its admission rule fails when a necessary distinction can no longer be reconstructed.

Resilient should adopt the question but **not Glass Fort's answer**.

The useful question is:

> Which differences are actually necessary?

Resilient's answer should remain consumer-relative.

```text
Does some downstream agreement require this distinction?
```

If yes:

```text
preserve
```

If no:

```text
manage out
```

This is fundamentally different from treating recoverability as inherently valuable.

---

### 9. Managed Loss Is a Resilient Principle

Glass Fort describes perfect parsimony as maximum relational compression with zero loss of necessary difference.

Resilient can push this further.

A transformation is not defective merely because it loses information.

```js
const names = (users = []) =>
    users.map(({ name = '' } = {}) => name);
```

The transformation intentionally destroys information.

That is its contract.

Correctness concerns whether the resulting agreement is satisfied, not whether `users` can later be reconstructed from `names`.

Therefore:

> **Information may be managed out once no required agreement depends upon it.**

This applies not only to runtime values but potentially to analysis itself.

Discovery may require:

```text
syntax
history
provenance
alternative interpretations
temporary distinctions
candidate classifications
```

Once an invariant has survived sufficient falsification, some of that scaffolding may cease to be necessary.

Resilient should be willing to forget.

---

### 10. Discovery Information Is Not Necessarily Contract Information

This distinction deserves explicit consideration.

Suppose 300 TypeScript constructions are required to discover one invariant.

That does not imply that the final analyzer needs an ontology containing 300 permanently preserved categories.

The development process may be:

```text
300 manifestations
        ↓
pattern discovery
        ↓
20 candidate relations
        ↓
falsification
        ↓
3 surviving relationships
        ↓
1 invariant
```

If the invariant adequately explains and predicts the behavior, the discarded distinctions have completed their work.

This is the **pixel/fractal principle**:

> If the pixel contains the generative relation necessary to reproduce and test the relevant structure, Resilient does not need to preserve a map of the entire fractal.

The hypothesis can be cheaper than the complete representation.

The test determines whether the reduction went too far.

---

### 11. Falsification Is the Garbage Collector

Glass Fort emphasizes preservation and recoverability.

Resilient has access to something much cheaper and more aggressive:

**execution.**

A candidate theorem can be reduced early and then attacked.

```text
observe
   ↓
hypothesize
   ↓
reduce
   ↓
test
   ↓
counterexample?
 ↙           ↘
yes           no
 ↓             ↓
revise      broaden corpus
```

This means Resilient does not need to become 100% structurally complete before testing begins.

It can deliberately risk an incomplete abstraction because ECMAScript, test suites, corpus analysis, and runtime parity provide external resistance.

#### Principle

> Prefer the smallest falsifiable model over the largest internally coherent model.

Structural completeness is not the objective.

Predictive agreement with executable behavior is.

---

### 12. False Equivalence vs. False Separation

Glass Fort explicitly guards against two reciprocal failures:

```text
FALSE SEPARATION

A differs from B
therefore
A and B share no recoverable structure
```

and:

```text
FALSE EQUIVALENCE

A and B share structure
therefore
their differences do not matter
```

This is potentially useful language for evaluating lowering.

#### False separation

Two syntax patterns are treated as fundamentally different even though they establish the same executable agreement.

Result:

```text
unnecessary grammar
```

#### False equivalence

Two syntax patterns are normalized together even though a meaningful contractual distinction is destroyed.

Result:

```text
incorrect lowering
```

This gives Resilient a useful analytical test:

> Does this normalization remove only representational difference, or does it destroy contractual difference?

That question is directly actionable.

---

### 13. Compatible Structure Does Not Imply Identity

The Fort's analysis of the Manifold paper is interesting because its own validation caught places where a structural similarity had been promoted too strongly into identity.

It subsequently distinguished:

```text
technical identity
```

from:

```text
compatible translation
```

and:

```text
inference
```

rather than treating similar relational patterns as literally the same machinery.

This matters to Resilient lowering.

Two patterns can share an invariant without being identical.

Therefore:

```text
same invariant
≠
same representation
≠
same transformation
≠
same evidence
```

Resilient should collapse representations only as far as executable agreement permits.

---

### 14. What Resilient Should Not Import

Glass Fort is useful partly because it demonstrates what Resilient does **not** need.

Do not inherit:

- universal ontology;
- metaphysical correspondence;
- symbolic architecture;
- astrology;
- telic vocabulary where ordinary software terminology suffices;
- mandatory lossless reconstruction;
- permanent provenance where no downstream agreement requires it;
- exhaustive mapping before experimentation;
- representational completeness as a goal;
- terminology that obscures established ECMAScript/compiler concepts.

Glass Fort's complexity is partly a consequence of what it chooses to preserve.

Resilient makes a different choice.

---

## Candidate Questions for Future Resilient Analysis

When reviewing the architecture, ask:

1. **What is invariant here?**
2. **Is the apparent difference contractual or merely representational?**
3. **What is the native ECMAScript interpretation before Resilient interprets it?**
4. **Where does the agreement actually live: node, edge, transformation, or graph?**
5. **What evidence establishes this contract?**
6. **What authority does that evidence have?**
7. **At what scope is the agreement proven?**
8. **Can uncertainty remain local?**
9. **What information does this transformation intentionally destroy?**
10. **Does any downstream consumer require the destroyed information?**
11. **Are two patterns being falsely separated?**
12. **Are two patterns being falsely equated?**
13. **Does the abstraction survive deformation?**
14. **Does it survive untouched examples?**
15. **Can executable behavior falsify it?**
16. **What machinery was necessary for discovery but is no longer necessary for execution or analysis?**
17. **Can that machinery now be managed out?**

---

## Possible Resilient Compression

Glass Fort can be reduced to a useful external challenge for Resilient:

```text
representation
    ↓
difference
    ↓
relation
    ↓
transformation
    ↓
invariant
```

Resilient adds its own stronger constraint:

```text
representation
    ↓
ECMAScript grammar
    ↓
contract
    ↓
agreement
    ↓
transformation
    ↓
preserved invariant
    ↓
falsification
    ↓
managed loss
```

Or more compactly:

```text
syntax
→ contract
→ relation
→ transformation
→ invariant
→ test
→ discard what no longer matters
```

---

## Working Conclusion

Glass Fort does not currently appear to provide a missing foundation for Resilient.

Its value is as an **adjacent relational system that has already been forced to think explicitly about problems Resilient will encounter at greater graph depth**:

- relational information;
- provenance and authority;
- local uncertainty;
- scope;
- transformation;
- invariant preservation;
- false equivalence;
- false separation;
- and distinctions between compatible structure and identity.

Resilient should study those problems without inheriting Glass Fort's solution architecture.

The central difference should remain deliberate:

> **Glass Fort attempts to preserve enough information to reconstruct the field.**

> **Resilient attempts to preserve enough information to guarantee the agreement.**

Everything beyond that requirement is eligible to be managed out.

That is not a weakness in the model.

It is part of the model.
