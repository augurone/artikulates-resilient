# prefer-destructured-member-access

Require bound data to be destructured before use.
Signature placement is enforced separately by `prefer-signature-destructuring`.

## Smell

Repeated member access leaves the data shape implicit at the point of use and
scatters the boundary contract through the function body. Destructure
application data once so the names, defaults, and selected shape are visible;
platform receivers and prototype operations remain explicit exceptions.

```javascript
// Incorrect
const getName = user => user.name;

// Correct in the body
const getName = (user = {}) => {
    const { name = '' } = user;
    return name;
};

// Preferred at the signature
const getName = ({ name = '' } = {}) => name;
```

Collection `.length` and `.size` checks, plus chained prototype method access,
remain valid because they express platform intent rather than application data
selection. For example, `request.headers.get('origin')` and
`document.content.map(transform)` do not require destructuring the intermediate
receiver. Computed access is not an exception: `value[name]` is still a member
lookup and must be destructured when `value` is a bound application object.
Prototype method calls remain valid because they test the receiver's behavior
rather than selecting application data.
The first parameter of a `.reduce` callback is also exempt because it is the
operation's accumulator, not static input data.
