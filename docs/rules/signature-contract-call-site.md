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

Function values retain the same treatment when they are returned or stored on
known objects:

```javascript
const makeReader = () => (title = '') => title.trim();
const api = { read: makeReader() };

api.read(42); // reported at the member call
```

A known function-valued property may use a rest parameter; the fixed
parameters remain checked while additional arguments pass through the rest
element.

When a local higher-order function invokes a callback parameter, the callback's
known signature is carried through that call stack as well. This includes
callback arity, inline callback values, and function-valued properties. Unknown
callback values and spread arguments remain unknown.

The rule does not report missing defaulted properties or values whose runtime
contents cannot be inferred statically. It also checks known local function
arity: calls with too few non-defaulted parameters or too many parameters
without a rest parameter are reported. Spread arguments remain unknown.

Direct object literals are checked for excess properties when the expected
object contract is closed. An object rest element is an explicit passthrough
boundary: `{ title = '', ...rest }` leaves the residual object open, so extra
direct-literal properties are accepted and remain available through `rest`.
Missing properties are not treated as errors here: Resilient defaults are the
normal absence contract, and intentionally absent function-valued fields may
use `undefined` to mean “not provided.” Variables and object spreads remain
open because their complete runtime shape is not established by this rule.
