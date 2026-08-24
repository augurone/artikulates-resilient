# no-undefined-comparison

Disallows equality comparisons that use `undefined` explicitly. Use a truthiness
check when the contract is testing presence or absence.

## Smell

Comparing directly with `undefined` encodes a presence decision as an
identity check instead of using the contract's falsey semantics. The rule
keeps missing-value checks aligned with the value strategy used by the rest of
the code.

```javascript
// Incorrect
const isMissing = value => value === undefined;
const isPresent = value => typeof value !== 'undefined';

// Correct
const isMissing = value => !value;
const isPresent = value => !!value;
```

Explicit assignment is handled by `no-undefined-assignment`.
