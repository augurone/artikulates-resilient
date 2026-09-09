# prefer-signature-destructuring

Require object destructuring to happen in the function signature instead of
the function body when that signature is part of the function's contract.

## What this finding means

Extracting a parameter's shape only after entering the body hides the contract
at the boundary and makes bookkeeping look like business logic. Signature
destructuring puts the expected shape and defaults where callers and reviewers
first encounter the function.

## Why

This rule expresses Resilient's boundary-first discipline: function boundaries
should carry meaningful information.

Benefits:

- the reader sees the expected shape immediately
- defaults can be applied at the boundary
- the body contains less extraction and bookkeeping
- review can focus on the boundary and its intent

## Rule Details

This rule reports cases where a function receives a simple identifier parameter and then destructures that parameter inside the function body.

When the original parameter is not referenced elsewhere, the destructuring is
the first statement in the function body, and the declaration has a single
declarator, the rule provides a suggestion to move it into the signature. The
suggestion is never applied automatically because moving a binding can change
evaluation order or scope.

### Incorrect

```javascript
const processUser = (user) => {
    const { name, age } = user;
    return `${name} (${age})`;
};

const getItems = (response) => {
    const {
        data: {
            items = []
        } = {}
    } = response;

    return items;
};
```

### Correct

```javascript
const processUser = ({
    name = '',
    age = 0
} = {}) => `${name} (${age})`;

const getItems = ({
    data: {
        items = []
    } = {}
} = {}) => items;
```

## When Not To Use

This rule is not a good fit for every function.

Examples where you may want to disable or avoid it:

- callbacks that must match an external signature
- functions that intentionally pass the full object through unchanged
- cases where dynamic property access is the real contract
- cases where the original parameter is forwarded to another function later in the same scope; local body destructuring is allowed for this forwarding pattern

## Relationship To The Discipline

This rule works best as part of the broader Resilient discipline, which also
prefers:

- predictable return types
- defensive defaults
- truthy/falsey emptiness checks
- early returns
- functional transformations over imperative loops

## Boundaries and non-goals

External callback signatures, full-object forwarding, and dynamic access are
real boundaries. Do not move destructuring when that would alter the contract.

## Repair recipes

Move the first owned object destructuring into the parameter and add defaults
there. Review the suggestion rather than applying it blindly.

Parameter use is resolved by lexical binding. The finding and its suggestion
share one reference result, so nested shadowing cannot add properties to the
outer signature or claim whole-value forwarding. A whole-value read after
extraction still retains body placement. A captured whole-value use in a nested
function also retains body placement, including a later destructuring
initializer. It keeps the original object available at the callback's own
execution time; declaration order cannot prove when that callback runs.
Same-function destructuring initializers are still candidates for signature
placement. Guarded provider extraction remains
a separate timing boundary: moving it would advance the provider's getter.
Existing suggestions retain their ranges and replacement text; they remain
manual suggestions, never autofixes.

Deferred capture and shadowed-parameter counterexamples are recorded in
`tests/fixtures/rule-evidence/signature.valid.js` and `signature.invalid.js`;
`tests/rule-evidence.test.js` also verifies getter count, current values and
deferred getter failure.
