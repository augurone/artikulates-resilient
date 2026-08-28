# Resilient semantics

This document defines the meaning of the Resilient JavaScript dialect. It is
the semantic reference behind the coding standards and individual rule pages.
The implementation boundary for static inference is described in
[`contracts.md`](contracts.md); the rule pages describe the barriers and smells
that enforce this dialect.

## Semantic layers

Resilient treats executable JavaScript as evidence for four related contracts:

1. value contracts: what family and shape a value has;
2. control-flow contracts: which paths can execute and when work stops;
3. effect contracts: who owns mutation, transformation, and shared state;
4. failure contracts: who owns asynchronous rejection, errors, and cleanup.

The dialect uses ECMAScript constructs to make those contracts visible. It does
not add an annotation language or claim that static evidence replaces runtime
validation.

## Evidence states

Every inferred fact has one of three semantic states:

- **known**: the source provides enough evidence to support the fact;
- **unknown**: the source does not provide enough evidence to decide;
- **contradictory**: known facts conflict at a boundary, operation, pattern, or
  return path.

Only contradictions are static contract findings. Unknown data remains unknown
and belongs to runtime validation, normalization, or behavioral tests.

The current contract object represents all three states directly. A
contradictory contract retains the known conflicting families so downstream
boundaries can inspect them; it is never treated as a permissive union or as an
ordinary unknown value.

## Value contracts

The core value families are:

| Family | Meaning | Canonical empty value |
| --- | --- | --- |
| string-like | text and string operations | `''` |
| number-like | numeric values and numeric operations | `0` |
| boolean-like | boolean decisions | `false` |
| array-like | ordered collections and collection operations | `[]` |
| object-like | records and object properties | `{}` |
| nullish | explicit absence at a declared boundary | boundary-defined |
| unknown | insufficient evidence | not normalized statically |

Arrays are distinct from records for destructuring and collection operations,
while remaining objects at the JavaScript runtime level. A computed object
property on an array can therefore be valid even when object and array
destructuring have different contracts.

The canonical empty value is a dialect default for value-producing application
contracts. It is not a claim that every external value has already been
normalized.

## Shapes and defaults

Destructuring is the dialect's native shape declaration. Defaults are part of
the contract, not merely defensive syntax:

```javascript
const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

This declares an object-shaped boundary, an optional nested `data` object, and
an array-shaped `items` value when the property is absent or `undefined`.
Defaults do not convert `null`, validate arbitrary external input, or prove
that an unknown value has the declared shape.

Application-owned function boundaries should expose their shape in the
signature. Externally defined callback signatures, full-object forwarding,
dynamic properties, and platform APIs are legitimate boundary exceptions when
destructuring would change the contract or hide intent.

## Absence semantics

`null` and `undefined` are valid JavaScript values and may be meaningful at an
external boundary whose contract explicitly permits absence. Inside a normalized,
value-producing application contract, Resilient prefers one shape-specific
empty value rather than an unannounced nullish alternative.

That distinction produces three cases:

1. a missing property may be normalized by a destructuring default;
2. an external `null` or `undefined` may remain at a declared boundary until
   runtime normalization handles it;
3. an internal value-producing path should return the contract's canonical
   empty value; a known alternate family is a contract contradiction.

The falsey-return, nullish-assignment, and return-consistency rules enforce the
default dialect. A known value-producing function has one return family;
incompatible nullish and non-nullish paths are contradictions rather than an
automatically widened union. Unknown external paths remain unknown until a
normalization boundary establishes a contract.

## Control-flow contracts

Every conditional, loop, and recursive call adds possible execution paths.
Resilient prefers guard clauses and early exits because they make rejected
paths terminate before the main work, reduce nesting, and reduce the state a
reader or agent must carry through the remaining path.

Collection operations should use a prototype method when the operation is
mapping, filtering, searching, reducing, or otherwise directly expressed by a
native method. A loop is valid when it carries semantics that a collection
method would hide:

- sequential API work;
- polling or retries;
- rate limiting;
- early termination;
- detailed control flow or ordered effects.

The loop barrier is therefore a default for collection transformations, not a
ban on iteration.

## Transformation and ownership contracts

A transformation produces a new value from an existing value. The default
dialect makes that transition explicit:

```javascript
const update = (
    { count = 0, ...state } = {},
    { value = '' } = {}
) => ({
    ...state,
    count: count + 1,
    value
});
```

Direct property updates, mutating methods, and `Object.assign` obscure whether
the code is transforming a value or changing an object owned elsewhere. The
safety rule therefore rejects them by default, including on locally created
working values. Draft reducers, caches, DOM objects, refs, and similar mutable
boundaries require explicit rule configuration.

The analyzer may still model a rejected update. Understanding the resulting
value is necessary for later contract analysis; it does not make the policy
violation valid.

## Async and failure contracts

Independent asynchronous operations should be started together and awaited with
`Promise.all`. Ordered, dependent, rate-limited, polling, retrying, and
early-terminating work should remain sequential. `Promise.allSettled` is the
appropriate expression when every outcome, including failures, belongs to the
contract.

An expression-statement promise chain must have visible rejection ownership.
Returning, assigning, awaiting, voiding, or catching a chain makes propagation
or handling visible. `async` and `await` are the preferred sequential syntax,
but a required promise chain remains valid when its ownership is explicit.

`try`, `catch`, `finally`, and `throw` are valid failure-boundary constructs.
Resilient rejects silent catches, dropped rejection ownership, lost error
context, inconsistent error contracts, and broken cleanup—not exception syntax
itself.

## Policy and inference

The dialect and the analyzer have different jobs:

```text
analyzer  -> what the source proves
dialect   -> what the project permits
runtime   -> what external data and effects actually do
```

The analyzer must remain conservative. The dialect may be stricter than the
analyzer when a project convention prevents a known class of smells, but every
strict rule should name its boundary and preserve legitimate exceptions.

This is why a rule can reject code even when the analyzer understands it, and
why an unknown external value is not itself a diagnostic.
