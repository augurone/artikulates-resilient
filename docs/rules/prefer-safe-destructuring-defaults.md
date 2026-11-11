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

The destructuring contract rule consumes this same absence decision as an
optional-field requirement. Its evidence still records an absent property;
receiver mismatches and unsafe invocations retain their own diagnostics.

The current supported behavior and boundary cases are verified by:

- [absence-signatures.test.js](../../tests/absence-signatures.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
