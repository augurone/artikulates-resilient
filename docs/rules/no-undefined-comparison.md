# no-undefined-comparison

Disallows explicit comparisons against `undefined`. Undefined is a falsey
state, not a value to model in application flow.

```javascript
// Incorrect
const isMissing = value => value === undefined;
const isPresent = value => typeof value !== 'undefined';

// Correct
const isMissing = value => !value;
const isPresent = value => !!value;
```

Explicit assignment is handled by `no-undefined-assignment`.
