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

All known function parameters are checked in argument order, including
primitive parameters:

```javascript
const getValue = (title = '', count = 0) => count;

getValue('', 'count'); // reported: argument[1] is string-like, not number-like
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

Known array elements are also checked against inline callback signatures:

```javascript
const inspect = () => {
    const items = [{ title: 42 }];

    return items.map(({ title = '' } = {}) => title.trim());
    // reported: map.callback.title expects string-like, but this call supplies
    // number-like
};
```

The same boundary applies to named callback functions passed to `map`,
`filter`, `some`, `find`, `reduce`, and `forEach` when both the callback
signature and receiver element are known.

The rule does not report missing defaulted properties or values whose runtime
contents cannot be inferred statically.
