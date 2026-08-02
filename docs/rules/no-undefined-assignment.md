# no-undefined-assignment

Disallows explicitly assigning `undefined`. Flexible data may naturally
produce `undefined` while being read, but value-returning functions should
normalize it to the expected falsey type.

```javascript
// Incorrect
const value = undefined;
value = undefined;

// Correct
const getValue = ({ value = '' } = {}) => value;
const hasValue = !value;
```

Returned `undefined` is handled by `prefer-falsey-returns`. Bare `return;` is
allowed for side effects and logical exits.

The rule does not provide an automatic fix or suggestion because only the
surrounding contract can determine whether the correct value is `''`, `[]`,
`{}`, `0`, `false`, or whether the assignment should not exist. Explicit
`null` assignment is handled by `no-null-assignment`.
