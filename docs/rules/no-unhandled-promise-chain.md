# no-unhandled-promise-chain

Report an expression-statement promise chain that uses `.then` or `.finally`
without a `.catch`. A rejection from a chain written this way has no visible
local handling or ownership.

## Smell

An expression-statement promise chain has no visible owner for rejection. The
failure can disappear from the local control-flow contract even though the
operation is still active; the rule requires handling or explicit propagation.

```javascript
// Incorrect
loadUser().then(renderUser);

// Correct: handle the rejection
loadUser()
    .then(renderUser)
    .catch(reportError);
```

The rule permits expressions that are returned, assigned, awaited, or
explicitly `void`-ed. Those forms make propagation or fire-and-forget
ownership visible to the caller or reviewer:

```javascript
return loadUser().then(renderUser);
const request = loadUser().then(renderUser);
await loadUser().then(renderUser);
void loadUser().then(renderUser);
```

This is a syntactic check. It cannot prove that an arbitrary object is a
Promise or thenable, and it does not replace runtime behavior tests. For a
required third-party or platform chain, keep rejection ownership explicit
with `.catch`, `return`, assignment, `await`, or `void`. If the chain is
handled but must remain a chain, the warning-level `prefer-async-await`
exception comment can suppress the style warning when it includes a reason.
