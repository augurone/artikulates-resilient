# prefer-destructured-member-access

Require static data from function parameters to be destructured before use.
Signature placement is enforced separately by `prefer-signature-destructuring`.

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
receiver. Computed access remains an explicit dynamic-data exception.
