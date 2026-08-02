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

Collection `.length` checks and prototype method calls remain valid because
they express collection intent. Computed access remains an explicit dynamic
data exception.
