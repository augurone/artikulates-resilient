# prefer-safe-destructuring-defaults

This rule is implemented in [the current package](../../analysis/eslint/prefer-safe-destructuring-defaults.js).
Its implementation uses the shared analyzer and source-owned evidence.

A local leaf extracted from a proved object with an open field contract may
preserve natural absence. For example, when the shared engine proves the
normalizer's passthrough contract, this is valid:

```js
const { typeArguments } = getObject(child);
```

There is no helper-name exemption. The receiver must have complete object-family
evidence and the field must have an unknown contribution without a known absent
alternative. The field remains unknown; no value, default or family is invented.
Nested patterns still need their own receiver and absence contracts. Unknown
receivers and known missing fields retain their separate diagnostics. An
explicit `= undefined` remains subject to `no-undefined-assignment`.

An empty object default on an identifier value field (for example,
`const { child = {} } = input`) declares an open field boundary under S-05.
Explicitly supplied empty records, root parameter defaults and nested named
patterns keep their separate evidence. Native-operation contradictions on the
actual empty fallback remain visible.

A field whose every source alternative is present and callable needs no
synthetic default under S-04. Known missing or noncallable alternatives do not
qualify, and the call still has its own invocation requirements.

Optional callables may use natural absence with `isFunction(onDone)` at their
use. A recognized callable predicate can also be the entire consumer, such
as `return isFunction(onDone)`. A guard-only consumer does not need a fabricated
callback or a `false` default. If the value is also invoked or forwarded, the
existing use proof remains required; a later guard cannot excuse an earlier
unsafe use. The sibling field has its own contract.
The existing local admission for unresolved `isFunction` syntax remains local;
forwarded consumer proof still requires executable source evidence.

Stable object fields may also preserve natural absence when every reference tests
presence or consumes the value in a branch selected by its presence test:

```js
const props = ({ thing }) => ({
    ...(thing && { thing })
});
```

The guard excludes missing, `undefined`, `null`, and other falsey inputs from
the forwarded property. No replacement value is needed. The same decision
applies to JSX spreads, `if` and conditional branches, `while` and `for` bodies
selected by their tests, negated tests, and composed `&&`/`||` conditions.
Stable aliases share binding identity.
A guard inside a callback belongs to that callback; an outer guard is not
borrowed across a function boundary. Written bindings and dynamic binding
lookup do not receive this admission. Every unguarded reference retains its
absence obligation, even beside a guarded use.

A logical operand can also become the logical expression's result. The absence
decision follows that result to its consumer: Boolean tests, discarded values,
and object/JSX spreads can consume absence. Array and argument spreads require
an iterable; ordinary forwarding, storage, and returns can expose absence. For
example, `const { items } = {}; const out = [...(items && [])];` still needs an
absence contract. An intervening `||` or `??` fallback handles the absent left
result before its consumer.

Local exports are value escapes. In `const { value } = {}; export { value };
!!value;`, the Boolean test cannot discharge the exported value's obligation.
Export declarations and stable aliases retain the same boundary. Re-export
names and the public name of a renamed export do not consume a same-spelled
local binding.

Parameter defaults participate in the same use summary as the body. An
unguarded initializer such as `const run = ({ value }, next = value.length)
=> !!value;` retains the default obligation; its body test occurs too late.
Initializer-local Boolean tests, conditional branches and object spreads keep
their own absence handling. Each invocation and data read needs its own
evidence, including calls in initializers.

Data forwarding and callbacks retain different consumer requirements. A
presence-guarded `if (func) external(func)` can forward a noncallable payload,
even beside `if (isFunction(func)) func()`. A collection callback such as
`[1].map(func)` needs callable evidence in both direct and captured executions;
`if (func)` cannot supply it. A statically named collection method and a
conditional argument that passes the original callback preserve that requirement.
An argument that could become the first value after spreading also needs
callable evidence. Resolved calls and constructor arguments carry that
requirement through fixed parameters. When a spread obscures the receiving
position, a possible callable use or unresolved consumer retains the
requirement. The canonical callable guard is
`if (isFunction(func))`. A downstream
consumer checks its data reads and invocations at their own uses. Observed data
reads such as `func.length` share the same local loop branch proof as an
invocation under that guard.

Returned and selected values keep the requirement of their eventual consumer
through `await`, stable local aliases and further arguments. A downstream executable callable guard
can discharge that requirement through resolved async calls, `.call`/`.apply`, rest
relays and ambiguous positions. Discarding a return removes only the result's
requirement; calls and other effects performed by its producer still need their
own evidence. A receiver write followed by a proved loop exit does not invalidate
an earlier lookup in that iteration.
An executable guard before returning a callable can also establish its later
invocation requirement. A choice between a guarded callback consumer and a
data-only consumer preserves those distinct requirements. Ordinary rest parameters
retain their array family without changing the requirements of their elements.

This is an absence decision, not validation of a runtime family, properties,
or callability. Callback invocation still needs a callable guard; tuple
cardinality and result obligations retain their own contracts. An incoming
`null` can be guarded; an authored `= null` default retains its independent
`no-null-assignment` diagnostic. No autofix or fabricated default is involved.

The destructuring contract rule consumes this same absence decision as an
optional-field requirement. Its evidence still records an absent property;
receiver mismatches and unsafe invocations retain their own diagnostics.

The current supported behavior and boundary cases are verified by:

- [absence-signatures.test.js](../../tests/absence-signatures.test.js)
- [absence-consumers.test.js](../../tests/absence-consumers.test.js)
- [absence-initialization.test.js](../../tests/absence-initialization.test.js)
- [guarded-values.test.js](../../tests/guarded-values.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)
- [use-role-contracts.test.js](../../tests/use-role-contracts.test.js)
- [forwarding-audit.test.js](../../tests/forwarding-audit.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
