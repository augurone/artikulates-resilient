# Resilient semantics

This document defines what Resilient constructs mean. Together with
[Grammar](grammar.md) (forms) and [Policy](policy.md) (rules and exceptions), it
is the normative dialect reference. ECMAScript supplies runtime behavior;
Resilient interprets executable source as contract evidence.

The implementation boundary for static inference is described in
[`contracts.md`](contracts.md). The [AI guide](../ai/CODING_STANDARDS.md) is a
compact presentation of the same specification, not a separate authority.
Section identifiers below are shared reference labels, not source annotations.

## S-01: Semantic layers

Resilient treats executable JavaScript as evidence for four related contracts:

1. value contracts: what family and shape a value has;
2. control-flow contracts: which paths can execute and when work stops;
3. effect contracts: who owns mutation, transformation, and shared state;
4. failure contracts: who owns asynchronous rejection, errors, and cleanup.

The dialect uses ECMAScript constructs to make those contracts visible. It does
not add an annotation language or claim that static evidence replaces runtime
validation.

## S-02: Evidence states

Every inferred fact has one of three semantic states:

- **known**: the source provides enough evidence to support the fact;
- **unknown**: the source does not provide enough evidence to decide;
- **contradictory**: known facts conflict at a boundary, operation, pattern, or
  return path.

Only contradictions are static contract findings. Unknown data remains
unknown; Resilient does not evaluate runtime data. The owning application or
data boundary is responsible for what happens at runtime.

The current contract object represents all three states directly. A
contradictory contract retains the known conflicting families so downstream
boundaries can inspect them; it is never treated as a permissive union or as an
ordinary unknown value.

## S-03: External data is outside the analyzer

Resilient never evaluates runtime data and never becomes a runtime dependency
of the client application. A source declaration expresses the contract authored
code expects. The build can report a contradiction when known source data does
not satisfy that declaration; it cannot observe whether an external payload
actually fails at runtime.

External, dynamic, unresolved, and unsupported inputs remain unknown. A
consumer may inspect a static boundary marker identifying the expected contract
and the external-data owner of a possible failure, but that marker is not
runtime evidence and does not validate, normalize, or repair the data.

## S-04: Value contracts

The core value families are:

| Family | Meaning | Canonical empty value |
| --- | --- | --- |
| string-like | text and string operations | `''` |
| number-like | numeric values and numeric operations | `0` |
| boolean-like | boolean decisions | `false` |
| regexp-like | regular-expression literals and matching operations | literal-defined |
| array-like | ordered collections and collection operations | `[]` |
| object-like | records and object properties | `{}` |
| function-like | callable values, callbacks, and returned functions | no synthetic default |
| nullish | explicit absence at a declared boundary | boundary-defined |
| unknown | insufficient evidence | not normalized statically |

Arrays are distinct from records for destructuring and collection operations,
while remaining objects at the JavaScript runtime level. A computed object
property on an array can therefore be valid even when object and array
destructuring have different contracts.

Functions are a first-class value family. When a function's parameters and
return paths are known, its contract travels through assignment, object
properties, aliases, and returns. A returned function can therefore be called
and checked at its later call site. A function without enough evidence for its
signature remains a known callable family with an unknown signature; the
analyzer does not infer a parameter type merely from an operation in the
function body.

Regular-expression literals are inferred as `regexp-like` values directly;
they do not need a declaration contract. Native matching such as
`pattern.test(value)` is therefore an ordinary implicit JavaScript contract,
with a known boolean result.

Prototype methods must agree with the receiver family. Collection methods such
as `map`, `filter`, `reduce`, `some`, `find`, and `forEach` require an
array-like receiver; string methods such as `trim`, `toLowerCase`,
`toUpperCase`, and `replaceAll` require a string-like receiver. Native helpers
that produce a known family participate in the same rule, so
`Object.entries({}).map(...)` is valid while
`Object.entries({}).trim()` is contradictory.

The canonical empty value is a dialect default for value-producing application
contracts. It is not a claim that every external value has already been
normalized.

## S-05: Shapes and defaults

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

An empty object default assigned to an undeclared value field defines a safe
absent value but does not declare any named properties. The analyzer therefore
treats that binding as open: later properties remain unknown rather than being
guessed or reported as absent. When a boundary needs named properties and
intentional passthrough, express it with nested destructuring and an object
rest element, such as `variables: { known = '', ...variables } = {}`. This
establishes the safe absent value, records the known field, and explicitly
preserves passthrough keys. Direct object literals and named destructuring
without a rest element remain closed when their properties are known.

A signature describes the boundary at the point of invocation. Moving a
property read from the body into the signature can change its timing, getter
execution, or receiver binding. The [signature policy](policy.md#p-01-rules)
therefore preserves external and dynamic boundaries where that move would
change the contract.

## S-06: Absence semantics

`null` and `undefined` are valid JavaScript values and may be meaningful at an
external boundary whose contract explicitly permits absence. Inside a normalized,
value-producing application contract, the [absence policy](policy.md#p-01-rules)
selects one shape-specific empty value rather than an unannounced nullish alternative.

That distinction produces four cases:

1. a missing property may be normalized by a destructuring default;
2. an external `null` or `undefined` may remain at a declared boundary; the
   owning runtime boundary handles it;
3. an omitted callback remains real `undefined` and must be guarded with
   `isFunction` or `typeof callback === 'function'` before invocation;
4. an internal value-producing path should return the contract's canonical
   empty value; a known alternate family is a contract contradiction.

The falsey-return, nullish-assignment, and return-consistency rules enforce the
default dialect. A known value-producing function has one return family;
incompatible nullish and non-nullish paths are contradictions rather than an
automatically widened union. Unknown external paths remain unknown to
Resilient. Source declarations may make the expected contract explicit, but
Resilient does not evaluate whether runtime data satisfies it.

### Content falsification preserves the family

For an agreement requiring content, the canonical empty representation `⊥T`
preserves its runtime family while falsifying its content condition, written
`!<T>`. Falsification does not mean that the value has the wrong type:

```text
value = ⊥T  ⇒  !<T>     (when T requires content)

object:  !hasContent({})  → true
array:   !([].length)     → true
text:    !''              → true
```

`isObject({})` and `Array.isArray([])` still succeed. Testing `!value` would
not detect their emptiness: both values are truthy. Use the agreement's own
content test. The object helper tests own enumerable string-key presence;
array length tests cardinality; text truthiness tests nonzero length. None
establishes validity of nested payloads or meaningful text.

An empty value may satisfy an agreement that permits empty content. Likewise,
`0` and `false` may be valid results. A content requirement must come from the
agreement rather than an invented blanket truthiness requirement. A guard
owns the consequence of failed content; the empty representation does not
itself exit a scope. See the [shared notation and examples](resilient-proofs.md#1-vocabulary).

## S-07: Control-flow contracts

Conditionals select paths; `return` terminates the current function; `throw`
transfers control to an error boundary. A loop's iteration order, direct
`break`/`continue`, and early exits are observable behavior. A `break` in a
nested `switch` exits that switch, not the surrounding loop.

Replacing iteration with a collection method must account for the receiver,
sparse elements, callback arguments, traversal order, and effects. Similar
looking syntax does not establish equivalent behavior. The preference for
guards and prototype methods, and retained-loop exceptions, belongs to
[Policy](policy.md).

## S-08: Transformation and ownership contracts

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

A property update changes the referenced object; aliases can observe that
change. A returned object spread creates a new outer object but does not deep
clone nested values. Replacing mutation with copying can therefore change
identity and shared-state behavior.

The analyzer may model an update that policy rejects. Understanding the
resulting value is necessary for later contract analysis; it does not approve
the mutation. The default transformation rule and explicit mutable boundaries
are defined in [Policy](policy.md).

## S-09: Async and failure contracts

Sequential `await` preserves dependency and ordering between operations.
`Promise.all` aggregates work with rejection on a rejected input;
`Promise.allSettled` produces each outcome. Grouping calls changes when work
starts and is not justified merely because both forms return promises.

Returning a promise propagates it to the caller. Awaiting exposes fulfillment
or rejection in the current async scope. Catching handles or translates a
rejection. Assignment and `void` make ownership or deliberate detachment
visible to the chain rule, but do not themselves install a rejection handler.

`try`, `catch`, `finally`, and `throw` retain their JavaScript behavior,
including cleanup and abrupt completion. A rewrite must preserve returned
values, error context, receiver binding, timing, and cleanup behavior. The
rules for silent catches, promise ownership, and preferred async syntax are
in [Policy](policy.md).

## S-10: Policy and inference

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

## S-11: TypeScript lowering contracts

The [TypeScript adapter](typescript.md) translates source declarations into
executable target evidence where supported. The portable core analyzer consumes
ESTree-compatible executable evidence; the TypeScript adapter is a separate
source-evidence producer that feeds the same dialect. TypeScript names are
lookup aids, not nominal runtime identities. A model or resolver is emitted
runtime code; it is distinct from the static analyzer and may deliberately
normalize values.

Object models are generated for executable shape uses and preserve additional
attributes. Union resolvers return a stable `{ kind, value }` envelope using
runtime families. Object branches use a literal discriminator or a unique
property where available. Ambiguous object branches must not be represented as
a proven selection of one model. Property membership includes falsey values;
truthiness is not evidence that a named property exists.

A shape default does not coerce every incoming value. Destructuring defaults
apply to `undefined`, including missing properties, but not to `null` or `NaN`.
The adapter's presence-union target defaults and explicit model normalization
must be distinguished from runtime validation. An unguarded `any` or `unknown`
boundary remains required unless a supported guard, fallback, or configured
resolver supplies the missing target evidence.

Lowering must account for required versus optional arguments, overload and
callback boundaries, evaluation order, function receiver behavior, identity,
effects, and failure paths. An intentional normalization must be visible in
the executable boundary. A passing lint result is not proof of behavioral
equivalence, and current lowering is experimental rather than compiler parity.
Unsupported lowering diagnostics and conservative unknown boundaries are
specified in [typescript.md](typescript.md); neither is an ESLint exception.
