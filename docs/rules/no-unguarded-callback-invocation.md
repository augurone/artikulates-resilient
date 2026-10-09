# no-unguarded-callback-invocation

Requires an explicit function guard before invoking a callback property that
may be omitted from an object parameter.

Function values are a first-class Resilient contract family, but absence is
still `undefined`, not a callable default. The family check establishes what a
value is; this rule establishes that an optional callback is present before it
is invoked.

## What this finding means

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

## Boundaries and non-goals

Forwarding an optional callback is valid; invoking it requires proof. A default
callback is appropriate only when it is the actual API contract.

## Repair recipes

Guard with `isFunction(callback)` or `typeof callback === 'function'`,
preferably before the invocation with an early return for absence.

Callback ownership follows the lexical parameter binding, including immutable
identifier aliases. A same-spelled local or nested parameter cannot borrow
that ownership or its guard. Calls before a guard or after a write that invalidates its fact remain
findings. A fresh local guard can establish callability again; aliases of a
mutable source cannot borrow each other’s guards. A guard can
protect a nested function created on its selected path only while the captured
binding remains stable; a closure created before that guard cannot borrow it. A resolved
helper must have a demonstrated synchronous predicate body; a shadowed
lookalike that merely returns `true` is insufficient. The documented unresolved
`isFunction` syntax (unbound or imported) remains supported for local guards.
This syntax alone never proves a forwarded consumer safe.

The rule does not supply defaults or take ownership of forwarded promises.
`tests/rule-evidence.test.js` verifies these boundaries together with the
safe-default rule, exact fixture locations, and unchanged source under fixing.
