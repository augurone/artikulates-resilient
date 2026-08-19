# Resilient coding standards

Resilient treats executable JavaScript as the contract. A function boundary
should make its expected data visible, transformations should state their
intent, and missing data should degrade into the falsey value appropriate to
the surrounding contract.

These are ECMAScript rules. React, Next.js, imports, framework conventions, and
application architecture belong in the consuming project.

## 1. Function boundaries

Use function expressions and prefer `const`:

```javascript
const getTitle = ({ title = '' } = {}) => title;
```

Destructure input at the signature when the shape is part of the function's
contract. Give every destructured value an explicit, type-shaped default:

```javascript
const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

Use `let` when one local value intentionally evolves, such as a reducer or a
state machine. An external `let` is not automatically wrong, but a mutable
value shared across function boundaries deserves review: it may be state that
should be passed explicitly or reduced locally.

Do not force signature destructuring onto callbacks with an external API,
functions that forward the complete object, or genuinely dynamic access.

## 2. Stable value shapes

Choose a predictable falsey value for each return contract:

| Contract | Empty value |
| --- | --- |
| text | `''` |
| collection | `[]` |
| object | `{}` |
| number | `0` |
| boolean | `false` |

Do not assign `null` or `undefined` as application values. Do not return them
from value-producing functions. A bare `return;` remains valid for a side
effect or an intentional control-flow exit.

This is a contract for the value being produced, not a claim that external data
is already clean. Normalize external data at the boundary where its expected
shape becomes known.

## 3. Conditions and control flow

Use truthiness for presence and emptiness:

```javascript
if (!items.length) return [];
if (!!items.length) return items;
```

Use exact comparisons for exact values, such as `items.length === 1`.
Avoid explicit `undefined` comparisons and `length === 0` checks.

Prefer guard clauses and early returns. Do not use `else`, `else if`, or nested
`if` statements in one function:

```javascript
const render = (value) => {
    if (!value) return '';
    if (!value.enabled) return '';
    return value.label;
};
```

An `if` inside a separate callback or nested function is a new function
boundary. Keep conditionals readable; the standard does not reward flattening
that makes a real domain decision harder to understand.

## 4. Transformations and loops

Use prototype methods when a collection is being transformed:

```javascript
const enabled = items.filter(item => item.enabled);
const labels = enabled.map(item => item.label);
```

Use `map`, `filter`, `reduce`, `some`, `find`, and `forEach` to make the
operation visible. Avoid loop state and collection mutation when a method
expresses the operation directly.

An imperative loop is appropriate when it is not a collection transformation,
when it must stop or continue with detailed control flow, or when it represents
sequential asynchronous work. In particular, an awaited polling or request
loop is not treated as a collection transformation.

`reduce` is also an intentional exception to “no evolving value”: its
accumulator is local state with a declared transformation boundary.

## 5. Member access and dynamic data

Destructure static application data before use:

```javascript
const getName = ({ name = '' } = {}) => name;
```

Static member reads from function parameters should be handled by the
signature or by body destructuring. Collection `.length` and `.size`, chained
native methods, computed properties, and dynamic platform APIs remain explicit
exceptions because destructuring would hide their intent.

Do not destructure data merely to satisfy a rule when the full object is being
forwarded, a callback signature is externally defined, or the property name is
dynamic.

## 6. Contract diagnostics

The contract analyzer and its opt-in ESLint rules report known contradictions
in signatures, call sites, and native operations. They do not invent facts for
unknown values:

```javascript
const render = ({ title = '' } = {}) => title.trim();

render({ title: 42 }); // known contradiction
render({ title: externalValue }); // unknown; validate at runtime if needed
```

Use runtime validation and tests for external data, side effects, and behavior
that static syntax cannot prove.

## 7. What Resilient does not own

The consuming project should add its own rules for:

- React hooks, JSX, and component conventions;
- Next.js routing, images, links, and server/client boundaries;
- import ordering, dependency policy, and module graph policy;
- product-specific naming, accessibility, and test conventions.

Resilient supplies the ECMAScript contract layer beneath those project rules.

## Enforcement map

| Standard | Rule |
| --- | --- |
| signature destructuring | `prefer-signature-destructuring` |
| explicit destructuring defaults | `prefer-safe-destructuring-defaults` |
| no fallback destructuring with `\|\|` | `no-destructuring-fallback` |
| stable falsey returns | `prefer-falsey-returns` |
| no explicit nullish assignment | `no-null-assignment`, `no-undefined-assignment` |
| falsey presence checks | `no-undefined-comparison`, `no-length-comparison` |
| early-return control flow | `no-else`, `no-nested-if` |
| static member access | `prefer-destructured-member-access` |
| collection transformations | `prefer-prototype-methods` |
| known contract contradictions | `signature-contract-call-site`, `signature-contract-destructuring`, `signature-contract-operation` |

## Review checklist

- Is the function boundary's data shape visible?
- Does every destructured value have the correct falsey default?
- Does each return path preserve one intentional value shape?
- Are missing values normalized where the contract becomes known?
- Can guard clauses replace `else` or nested conditionals?
- Is a collection operation expressed with a prototype method?
- If `let` or a loop remains, is the evolving state or sequential control flow
  intentional?
- Is a rule exception tied to an actual boundary rather than used to silence
  an inconvenient diagnostic?
