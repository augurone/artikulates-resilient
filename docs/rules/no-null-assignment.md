# no-null-assignment

Disallows explicitly assigning `null`. Nullish values are states, not
contractual return or assignment values. Normalize flexible data to the
expected falsey type instead.

```javascript
// Incorrect
const value = null;
value = null;

// Correct
const getValue = ({ value = '' } = {}) => value;
const hasValue = !!value;
```

The rule does not provide an automatic fix or suggestion because only the
surrounding contract can determine whether the correct value is `''`, `[]`,
`{}`, `0`, `false`, or whether the assignment should not exist.
