# Async Resolution Ownership

## Notes for *Style Is Grammar*

Another example of style becoming grammar appears in `async` functions.

Both forms are valid ECMAScript:

``` js
return response.json();
```

``` js
return await response.json();
```

Because an `async` function adopts a returned promise, the caller can
ordinarily observe the same eventual value from either form.

But they do not express the same local responsibility.

`return response.json();` forwards an unresolved asynchronous operation
and relies on the surrounding async machinery to adopt its result.

`return await response.json();` resolves that operation inside the
function before returning its result.

This creates a useful grammatical distinction:

``` text
promise forwarding
        versus
resolution ownership
```

If the function owns the outcome of an asynchronous operation, `await`
keeps that resolution visible within the function's scope:

``` text
operation → resolution → established value → return
```

If the function deliberately delegates resolution, returning the promise
can express that instead.

The distinction becomes observable around local failure handling: an
awaited rejection remains within the surrounding `try`/`catch`; a
returned, un-awaited promise can reject after that scope has been
exited.

The Resilient rule therefore should not simply be "always use
`return await`."

The stronger semantic principle is:

> **An async function that owns the outcome of an asynchronous operation
> should resolve that operation within its own execution scope before
> returning it.**

The syntax then exposes ownership rather than leaving promise adoption
to imply it.

------------------------------------------------------------------------

# Technical Reference: `return await` and Async Resolution Ownership

Consider:

``` js
const saveArticle = async ({ article = {} } = {}) => {
    const response = await save(article);

    return response.json();
};
```

and:

``` js
const saveArticle = async ({ article = {} } = {}) => {
    const response = await save(article);

    return await response.json();
};
```

## Ordinary Fulfillment

An `async` function always returns a promise. When it returns another
promise, its returned promise adopts the eventual state of that promise.
Consequently, a caller such as:

``` js
const article = await saveArticle({ article });
```

ordinarily receives the parsed value in either implementation.

Therefore, `return await` should not be justified by claiming that the
caller otherwise receives the inner promise as its final value.

## Execution-Scope Distinction

With `return response.json();`, `response.json()` is invoked and its
promise is returned. The async function delegates settlement through
promise adoption.

With `return await response.json();`, the async function suspends until
the operation settles. On fulfillment, the resulting value becomes the
value of the `await` expression and is then returned.

``` text
return promise

operation
   ↓
Promise
   ↓
return
   ↓
async promise adoption
   ↓
eventual result
```

versus:

``` text
return await promise

operation
   ↓
Promise
   ↓
await
   ↓
settled result
   ↓
return
```

## Observable Failure-Handling Difference

The distinction becomes behaviorally significant inside `try`/`catch`.

### Promise Forwarding

``` js
const saveArticle = async ({ article = {} } = {}) => {
    try {
        const response = await save(article);

        return response.json();
    } catch (error) {
        return handleError(error);
    }
};
```

If `save(article)` rejects, the rejection occurs at the first `await`
and can be handled by the local `catch`.

If `response.json()` returns a promise that later rejects, that promise
has already been returned from the `try` block. Its rejection is adopted
by the promise returned from `saveArticle`, but the local `catch` does
not handle that asynchronous rejection.

### Local Resolution

``` js
const saveArticle = async ({ article = {} } = {}) => {
    try {
        const response = await save(article);

        return await response.json();
    } catch (error) {
        return handleError(error);
    }
};
```

Here `response.json()` settles while execution remains associated with
the `await` inside the `try`. A rejection is therefore thrown at the
`await` expression and can be handled by the surrounding `catch`.

This makes resolution ownership observable rather than purely stylistic.

## Resilient Interpretation

Resilient can distinguish two legitimate agreements.

### Forwarding

``` js
return operation();
```

The function intentionally delegates settlement of the returned promise.

``` text
function
   ↓
operation
   ↓
unresolved promise
   ↓
return / adoption
```

### Resolution Ownership

``` js
return await operation();
```

The function owns settlement of the operation before completing its
return.

``` text
function
   ↓
operation
   ↓
await
   ↓
fulfilled value / local rejection
   ↓
return
```

The relevant grammar principle is therefore not:

> Always use `return await`.

It is:

> **An async function that owns the outcome of an asynchronous operation
> should resolve that operation within its own execution scope before
> returning it.**

Conversely, direct promise return remains meaningful when forwarding is
intentional.

This distinction gives static analysis an executable indication of
ownership rather than requiring intent to be inferred from implicit
promise adoption.
