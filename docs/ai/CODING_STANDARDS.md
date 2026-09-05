# Applying the Resilient dialect

The normative definitions are in [`semantics.md`](../reference/semantics.md). This page is
the practical reference for writing code in that dialect; individual rule
behavior and smells are in [`rules/`](../rules/).

## Function boundaries

Make application-owned shapes visible in signatures and give every
destructured level an explicit contract default:

```javascript
const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

Keep externally defined callback signatures, full-object forwarding, dynamic
access, and platform APIs intact when destructuring would change the boundary.

Use function expressions and `const` by default. Reserve `let` for one
top-level conditional value when no function, prototype method, or conditional
expression states the result more clearly.

## Value contracts

Use the empty value appropriate to the contract:

| Contract | Empty value |
| --- | --- |
| text | `''` |
| collection | `[]` |
| object | `{}` |
| number | `0` |
| boolean | `false` |

Do not use `null` or `undefined` as generic internal application values. They
remain valid when an external boundary explicitly permits absence. A bare
`return;` remains valid for a side effect or control-flow exit.

## Control flow and collections

Use guard clauses and early exits:

```javascript
const render = ({ enabled = false, label = '' } = {}) => {
    if (!enabled) return '';
    return label;
};
```

Do not use `else`, `else if`, or nested `if` statements in one function. Use
`!items.length` or `items.length` for zero/non-zero collection checks; preserve
exact cardinality comparisons such as `items.length === 1`.

Whitespace is part of the recommended configuration. ESLint can autofix
trailing spaces, mixed or repeated horizontal spaces, missing final newlines,
and excess blank lines. Executable statements are separated by blank lines;
function and control-flow braces stay tight; `if` statements are separated
from following work; return statements have top padding; and redundant
returns are rejected. Consecutive guard returns remain valid.

Use prototype methods when they state the collection operation:

```javascript
const enabled = items.filter(({ enabled = false } = {}) => enabled);
const labels = enabled.map(({ label = '' } = {}) => label);
```

Loops with `await` or direct `break`/`continue`/`return`/`throw` are valid
native exceptions: their sequential ordering or control flow is explicit.
Other retained loops, including accumulator or mutation loops without those
native semantics, require `// resilient-allow-loop: reason` with a file-local
explanation.

## Transformations and effects

Return transformed objects and arrays instead of mutating them:

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

The safety rule rejects direct property updates, mutating methods, and
`Object.assign`, including on local working values. Configure narrow exceptions
for draft reducers, caches, DOM objects, refs, and similar mutable boundaries.

## Async and failure

Use `Promise.all` for independent operations, sequential `await` for ordered or
rate-limited work, and `Promise.allSettled` when every outcome matters.

Promise chains need visible ownership through `.catch`, `return`, assignment,
`await`, or `void`. Prefer `async`/`await` for ordinary sequential chains, but
keep required chains with `// resilient-allow-promise-chain: reason`.

Use `try`, `catch`, `finally`, and `throw` for API failure, cancellation,
parsing, cleanup, and error boundaries. Do not leave a catch block empty.

## Evidence and runtime boundaries

Contract diagnostics report known contradictions. Unknown values remain
unknown. Use runtime validation, normalization, and tests for external data,
side effects, and behavior static syntax cannot prove.

## Enforcement map

| Commitment | Rule |
| --- | --- |
| signature destructuring | `prefer-signature-destructuring` |
| function expressions | `func-style` in `configs.recommended` |
| `const` for non-reassigned bindings | `prefer-const` in `configs.recommended` |
| explicit destructuring defaults | `prefer-safe-destructuring-defaults` |
| no fallback destructuring with `\|\|` | `no-destructuring-fallback` |
| contract-specific falsey returns | `prefer-falsey-returns` |
| no explicit nullish application values | `no-null-assignment`, `no-undefined-assignment` |
| falsey presence checks | `no-undefined-comparison`, `no-length-comparison` |
| early-return control flow | `no-else`, `no-nested-if` |
| static member access | `prefer-destructured-member-access` |
| collection transformations | `prefer-prototype-methods` |
| safe object and array transformations | `prefer-safe-transformations` in `configs.safety` |
| empty failure handlers | `no-silent-catch` in `configs.safety` |
| optional callback invocation | `no-unguarded-callback-invocation` in `configs.safety` |
| dropped promise-chain rejection | `no-unhandled-promise-chain` in `configs.safety` |
| promise callback sequencing | `prefer-async-await` warning in `configs.safety` |
| known contract contradictions | `signature-contract-call-site`, `signature-contract-destructuring`, `signature-contract-operation`, `signature-contract-return-consistency` |
| known closed-object property access | `signature-contract-property` |

## Review checklist

- Is each owned function boundary's shape visible?
- Does each destructured level have the correct default?
- Does each value-producing path preserve its intended value family?
- Can a guard clause terminate irrelevant work earlier?
- Is a collection operation expressed with a prototype method?
- If a loop has neither `await` nor direct loop control, is its retained-pattern
  reason visible in `resilient-allow-loop: reason`?
- Are independent async operations grouped with `Promise.all`?
- Does every promise chain have an owner for rejection?
- Does every catch handler handle, translate, rethrow, log with context, or
  return an explicit fallback?
- Are mutable boundaries explicitly configured?
- Are unknown external values left for runtime validation?

## What Resilient does not own

React, JSX, framework routing, import policy, accessibility, product naming,
and application architecture belong in consuming-project rules.
