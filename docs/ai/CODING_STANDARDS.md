# Applying the Resilient dialect

The normative specification has three parts: [Grammar](../reference/grammar.md),
[Policy](../reference/policy.md), and [Semantics](../reference/semantics.md).
This is their AI-facing practical presentation, not an independent rule set.
Individual rule behavior and smells remain in [`rules/`](../rules/).
The project documentation is authoritative. Use `rules/contracts` as the senior
dialect reference and the Artikulates provider tree as the team composition
reference; do not invent a parallel interpretation from local convenience.

For a first implementation in the dialect, read
[Writing Resilient from first principles](writing-resilient.md) for boundary
decisions, complete examples, and a path through the blogs and reference code.

## Decision procedure for agents

0. Return to the normative documents before making a design decision. Read the
   applicable Grammar, Policy, Semantics, and adapter reference sections, then
   inspect the closest proven implementation pattern in `rules/contracts`.
   Documentation and those implementations are the language training set;
   intuition, convenience, and lower lint counts are not substitutes.
1. Classify the source form using Grammar G-A (atoms), G-S (structures), and
   G-T (TypeScript input versus JavaScript target).
2. Establish meaning using Semantics S-02 through S-06: separate known,
   unknown, and contradictory evidence; distinguish defaults from validation.
3. Identify the applicable rule and preset using Policy P-01 and P-02.
4. Check built-in exceptions, then the narrow boundary mechanism in P-03.
   An exception never supplies missing evidence or relaxes another rule.
5. For lowering, inspect S-07 through S-11 and P-04: preserve evaluation order,
   required arguments, receivers, identity, effects, and failure ownership.
   Keep unsupported-lowering diagnostics separate from policy findings.
6. Verify under P-05. Report unknowns, retained exceptions, warnings, and
   failures; a passing lint result alone does not prove equivalent behavior.

Adapters must speak the dialect themselves: use destructured boundaries,
direct object construction, explicit agreement states, correct defaults,
guard-owned absence, and local exceptions. Never add a project-wide or
file-wide disable, generate suppression comments from lint output, or use
`--fix` as evidence that a semantic lowering is correct.

These IDs are shared documentation references, not an annotation language.

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

Loops with `await` or direct `break`/`continue`/`return`/`throw` may have a
semantic reason to remain native, but these are not automatic lint exceptions.
Unless a completed analyzer-backed retained boundary applies, every retained
loop requires `// eslint-disable-next-line resilient/prefer-prototype-methods -- reason`
with a file-local explanation.

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
`Object.assign`, including on local working values. Use the owning rule’s supported boundary exceptions for draft reducers, caches,
DOM objects, and refs. Repository source requires local, explained exceptions
under [P-03](../reference/policy.md#p-03-exceptions-and-precedence).

## Async and failure

Use `Promise.all` for independent operations, sequential `await` for ordered or
rate-limited work, and `Promise.allSettled` when every outcome matters.

Promise chains need visible ownership through `.catch`, `return`, assignment,
`await`, or `void`. Prefer `async`/`await` for ordinary sequential chains, but
keep required chains with `// eslint-disable-next-line resilient/prefer-async-await -- reason`.

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
  reason visible in the adjacent ESLint exception?
- Are independent async operations grouped with `Promise.all`?
- Does every promise chain have an owner for rejection?
- Does every catch handler handle, translate, rethrow, log with context, or
  return an explicit fallback?
- Are mutable boundaries explicitly configured?
- Are unknown external values left for runtime validation?

## What Resilient does not own

React, JSX, framework routing, import policy, accessibility, product naming,
and application architecture belong in consuming-project rules.
