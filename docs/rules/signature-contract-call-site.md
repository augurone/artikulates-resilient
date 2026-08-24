# signature-contract-call-site

Reports known call-site values that contradict a function's destructured
signature contract.

## Smell

A call site that supplies a known incompatible value breaks the boundary
contract before the function can do useful work. Reporting the contradiction
at the call preserves the source of the error while leaving unknown values for
runtime validation.

```javascript
const render = ({
    title = ''
} = {}) => title.trim();

render({ title: 42 }); // reported
render({ title: value }); // unknown values are left alone
```

Nested defaults are analyzed recursively:

```javascript
const getName = ({
    config: {
        name = ''
    } = {}
} = {}) => name;

getName({ config: { name: null } }); // reported
```

The rule does not report missing defaulted properties or values whose runtime
contents cannot be inferred statically.
