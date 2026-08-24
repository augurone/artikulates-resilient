# signature-contract-operation

Reports known native operations that contradict an inferred value contract.

## Smell

Calling a string operation on a collection, or a collection operation on a
string, is a contract contradiction hidden behind otherwise valid JavaScript
syntax. The rule reports the incompatible operation where the evidence makes
the mistake knowable.

```javascript
const inspect = ({
    items = []
} = {}) => items.toUpperCase(); // reported
```

Known string operations include `trim`, `toLowerCase`, `toUpperCase`, and
`replaceAll`. Known collection operations include `map`, `filter`, `some`,
`find`, `reduce`, and `forEach`.

Unknown values and methods outside the known operation table are left alone.
This rule detects contradictions; it does not validate data at runtime.
