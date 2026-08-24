# prefer-async-await

Warn when a promise `.then(...)` callback chain is used where `async` and
`await` usually make sequencing and failure flow easier to inspect.

## Smell

A callback chain can scatter sequencing and failure flow across nested
functions, making the actual operation order harder to inspect. The warning
encourages the native sequential form where it improves the contract without
pretending that every promise chain has equivalent timing or ownership.

```javascript
// Warning
const getName = () => fetchUser().then(({ name = '' } = {}) => name);

// Preferred
const getName = async () => {
    const { name = '' } = await fetchUser();
    return name;
};
```

This is a warning, not an error, and it has no autofix. Converting a chain can
change timing, returned values, `this`, or error behavior. Promise APIs remain
valid: use `Promise.all` for independent work, sequential `await` for ordered
work, and `Promise.allSettled` when every outcome matters.

`.catch(...)` and `.finally(...)` are not themselves discouraged. If a chain is
required by an API, a stream-like interface, or a deliberate contract, explain
the exception immediately before the `.then` member:

```javascript
// resilient-allow-promise-chain: required by the stream adapter
stream.then(handleChunk).catch(reportError);
```
