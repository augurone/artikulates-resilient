# no-undefined-comparison

Disallows equality comparisons that use `undefined` explicitly. Use a truthiness
check when the contract is testing presence or absence.

```javascript
// Incorrect
const isMissing = value => value === undefined;
const isPresent = value => typeof value !== 'undefined';

// Correct
const isMissing = value => !value;
const isPresent = value => !!value;
```

Explicit assignment is handled by `no-undefined-assignment`.
