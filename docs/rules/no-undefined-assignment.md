# no-undefined-assignment

Disallows explicitly assigning `undefined` as a generic application value.
Flexible data may naturally produce `undefined` while being read, but
value-producing functions should normalize it to the type-safe falsey value
specified by their contract.

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
`{}`, `0`, `false`, or whether the assignment should not exist. The rule reports
explicit `undefined` identifiers even when they occur at an external boundary;
use a local rule override when `undefined` is part of that boundary's contract.
Explicit `null` assignment is handled by `no-null-assignment`.
