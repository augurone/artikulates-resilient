# Boundary agreement and contractual totality

This note explains a conditional model of boundary agreement. It is subordinate
to [Semantics](semantics.md), [Grammar](grammar.md) and [Policy](policy.md), and
uses the [agreement algebra](resilient-algebra-invariants-generic.md). It does not
claim that arbitrary runtime data is statically validated or that every program
is safe, terminating or fully analyzed.

## Domains and evidence

Let `U` be possible runtime inputs, `T` the domain established for an operation,
and `R` its promised normal-result agreement. The intended composition is:

```text
U --αT--> T --f--> R
```

`αT` denotes the executable boundary mapping whose premises must be proved. It
is not an analyzer operation that converts uncertainty into a value. A default,
predicate, destructuring step, guard or transformation establishes only the
agreement its actual semantics justify. Some paths can throw, stop or remain
unknown rather than reach `T`.

For each use, ask what it requires, what the source established, what the
operation changes, what normal result it promises, and where evidence stops.
The governing evidence law is:

```text
claimed agreement ⊆ agreement justified by executable evidence
```

When a requirement exceeds known evidence, the unanswered part stays unknown.
When established evidence conflicts with the requirement, there is a
contradiction. A missing proof is not by itself evidence of runtime failure.

## Identity and stability

Where a boundary claims to resolve an existing agreement without changing it:

```text
∀t ∈ T, αT(t) = t
```

The equality includes observable identity where relevant. A valid zero remains
zero; false remains false; an already-agreed object, array or callable remains
that same value. The boundary does not sanitize a value merely because it crossed
a scope. A deliberate representation change requires a declared mapping and
preservation proof rather than silently claiming this identity law.

Fallbacks belong to the operational domain when their contract admits them;
they are not an inherently invalid parallel space. An empty collection may be a
valid collection result. A default is a distinguished value chosen only when
the actual construct permits that selection.

## ECMAScript defaults establish a local mapping

For an authored default, the faithful mapping is:

```text
αdefault(u) = fallback   if u is undefined
              u         otherwise
```

Consider:

```javascript
const selectItems = ({ items = [] } = {}) => items;
```

An omitted argument or undefined `items` can select an empty array. A provided
array retains its identity. A provided null, false or string does not become an
array. A null outer argument also retains native destructuring failure. The
default expression can have effects and executes only when selected.

Thus a default can establish absence handling without establishing a total
mapping from all `U` to an array domain. Moving the property Get to another phase,
adding a container fallback, or coercing all provided values would be a different
program and needs its own declared policy/behavior proof.

An explicit predicate and branch can establish stronger local evidence:

```javascript
const selectArray = ({ items = [] } = {}) => {
    if (!Array.isArray(items)) return [];

    return items;
};
```

On normal return this authored function selects an array family while preserving
provided array identity. That does not validate elements or prove an inert
iterator, prototype or callback. It is a stronger authored boundary, not a
normalization the analyzer may silently invent for `selectItems`.

## Composition and contractual totality

Agreement can accumulate through several owned steps:

```text
U --absence handling--> V1 --guard--> V2 --transformation--> T --operation--> R
```

Every arrow needs its own evidence, scope and effect/completion conditions.
Established evidence can propagate; unknown branches, aliases, mutation and
effects can withhold or invalidate premises. A later consumer need not rediscover
an established agreement, but cannot assume a stronger one or reuse stale proof.

The conditional totality proposition is:

```text
If αT maps every admitted input in U to T,
and f establishes its promised result R over T,
then f ∘ αT establishes R over that admitted input domain.
```

For any admitted `u`, the first premise gives `αT(u) ∈ T`; the second gives
`f(αT(u)) ∈ R`. The conclusion follows from those premises. The notation speaks
about the stated value/result contract; it does not independently establish that
either premise holds for a real function. If the model includes abrupt or absent
normal completion, those outcomes must remain explicit rather than be hidden in
the arrow. Normal-result containment can also be written
`NormalResults(f, t) ⊆ R`; it does not assert that this set is nonempty.

Contractual totality therefore does not prove absence of explicit throws,
rejections, external I/O failure, platform failure, nontermination, side effects
or unmodeled behavior. It is not a claim that a program cannot crash.

## Current implementation boundary

The architecture separates producer evidence from consumer requirements and
retains known conflicts beside incomplete evidence. Revisions invalidate owned
premises; arbitrary JavaScript source edits require a new source session.
See [architecture](../engineering/architecture.md) and
[preservation obligations](resilient-proofs.md).

The model does not imply whole-program activation, arbitrary external execution,
unlimited precision or linear work. An implementation claim needs a supported
acquisition boundary, representative functional proof and a stated cost model.
TypeScript annotations express requirements and declaration identity; only
supported executable evidence establishes actual values.
