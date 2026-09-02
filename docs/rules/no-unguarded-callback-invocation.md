# no-unguarded-callback-invocation

Requires an explicit function guard before invoking a callback property that
may be omitted from an object parameter.

Function values are a first-class Resilient contract family, but absence is
still `undefined`, not a callable default. The family check establishes what a
value is; this rule establishes that an optional callback is present before it
is invoked.

## Smell

An omitted callback is intentionally `undefined` in Resilient. It is not
silently replaced with an untestable no-op function, so direct invocation must
prove that the callback is present and callable:

```javascript
const run = ({ onDone } = {}) => {
    if (isFunction(onDone)) onDone();
};
```

The rule recognizes `isFunction(callback)` and direct `typeof callback ===
'function'` guards, including logical guards and early-return guards. A
defaulted callback is already normalized and does not require this rule. The
rule only targets direct invocation of properties destructured from an object
parameter; passing a callback onward remains valid.

The application utility used by Artikulates is:

```javascript
const isFunction = func => func && typeof func === 'function';
```
