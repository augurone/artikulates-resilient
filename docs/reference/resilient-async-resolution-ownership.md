# Async resolution ownership

Promise forwarding and local resolution are distinct ownership choices under
[Semantics](semantics.md#s-09-async-and-failure-contracts) and
[Policy](policy.md). Both are valid ECMAScript. The examples below explain their
execution boundary; they do not introduce an unconditional `return await` rule.

## Fulfillment and execution scope

An async function always returns a promise. Returning another promise causes
the async result to adopt its eventual state. Consequently a caller awaiting
either form can ordinarily receive the same eventual successful value:

```javascript
return operation();
```

```javascript
return await operation();
```

The first form forwards settlement through async promise adoption. The second
awaits settlement within the function's execution scope, then returns the
fulfilled value or receives the rejection as a throw at the await expression.
It is incorrect to justify the second form by claiming the first leaves the
caller with an unresolved inner promise as its final awaited value.

Same eventual fulfillment is not general behavioral equivalence. Rejection
handling, finalization, observable scheduling, thenable effects and identity
claims require the actual boundary to be examined.

## Local catch ownership

```javascript
const forward = async (operation) => {
    try {
        return operation();
    } catch (error) {
        return handleFailure(error);
    }
};

const resolveLocally = async (operation) => {
    try {
        return await operation();
    } catch (error) {
        return handleFailure(error);
    }
};
```

Both catches can handle a synchronous throw while calling `operation`. If it
returns a promise that later rejects, the first function has already returned
from its `try`; the local catch does not handle that rejection. Its returned
async promise adopts the rejection. In the second function the rejection is
thrown at `await` inside the try and can be handled locally.

The semantic ownership principle is: when a function owns the outcome of an
async operation, it resolves that operation in the scope responsible for the
outcome. When it deliberately delegates settlement, direct promise return can
express that forwarding boundary. A rewrite cannot infer local ownership merely
from the presence of an async function or a catch elsewhere in the body.

## Cleanup and completion

`finally` has its ordinary ECMAScript effect on the pending completion. In a
direct promise return, local cleanup can run before that returned promise settles.
An awaited return reaches the finalizer after the awaited operation settles.
A return or throw in the finalizer can replace an earlier return or failure.
Mutating a returned object during finalization also differs from changing an
already captured primitive result.

Promise `.finally()` is a separate protocol: successful cleanup normally forwards
the prior outcome, while a thrown or rejected cleanup can replace it. Converting
chains to async/await must preserve callback arguments, receiver/callable identity,
effects, outcome replacement and failure order. A lower count of chain syntax is
not evidence of preservation.

## Visible ownership is not installed handling

Returning a promise forwards it. Awaiting joins its settlement to the current
scope. A callable rejection handler can handle or translate a rejection, with
any new failure belonging to the resulting promise. Assignment and `void` can
make retention or deliberate detachment visible, but neither installs a rejection
handler. The mere spelling `.then`, `.catch` or `.finally` does not establish
native Promise identity, callable handlers or eventual successful handling.

An async return-family agreement concerns fulfillment. Rejection remains a
separate possible completion; lack of a normal fulfilled result is distinct from
an unknown fulfilled value or a fulfilled undefined value. Unknown external work
must not become a proved native promise or a fabricated successful outcome.

## Current support and verification

The JavaScript analyzer's supported completion owner and promise ownership rules
share source evidence. [Async completion tests](../../tests/async-completion.test.js)
compare the supported catch/finally behavior with native execution;
[ownership tests](../../tests/promise-ownership.test.js) exercise rule behavior and
retained failure boundaries. These establish their covered forms, not arbitrary
async program equivalence.

The TypeScript compiler acquisition bridge has its own bounded execution surface;
it does not acquire general async execution merely because the JavaScript owner
supports a form. The [TypeScript guide](../engineering/typescript.md) separates
that boundary from emission support. Any conversion must follow the
[preservation procedure](resilient-proofs.md#7-transformation-proof-procedure)
and retain an exact supported boundary or diagnostic when proof is missing.
