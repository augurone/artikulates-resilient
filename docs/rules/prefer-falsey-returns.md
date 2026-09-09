# prefer-falsey-returns

Disallows `null` or `undefined` values in returns from value-producing functions.
The surrounding contract determines whether the replacement is `''`, `[]`,
`{}`, `0`, or `false`; this rule does not infer that replacement. Bare
`return;` statements are allowed for side effects and logical exits.

## What this finding means

Returning `null` or `undefined` from a value-producing path creates an
unstated union between absence and the function's ordinary value family. The
rule keeps the return contract stable while preserving bare returns for
control-flow exits and side-effect functions.

```javascript
// Incorrect
const getValue = () => null;
const getItems = (found) => found ? items : undefined;
const getUser = (id) => users[id] || null;

// Correct
const getValue = () => '';
const getItems = (found) => found ? items : [];
const getUser = (id) => users[id] || {};

// Correct control flow
const send = (payload) => {
    if (!payload) return;
    sendPayload(payload);
};
```

The rule checks direct return values and return-producing conditional or
logical expressions. It does not reject `null` nested inside a returned object,
such as `{ error: null }`.

## Boundaries and non-goals

Bare returns remain valid for control flow and effects. The rule does not pick
the value family a value-producing boundary must return.

## Repair recipes

Return the contract's empty value consistently, then use the
[return-consistency rule](signature-contract-return-consistency.md) to verify
known paths agree.
