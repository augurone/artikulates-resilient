# no-silent-catch

This rule is implemented in [the current package](../../analysis/eslint/no-silent-catch.js).
Its implementation uses syntax and lexical ownership.

Catch clauses and visible inline `.catch(handler)` and `.then(onFulfilled,
onRejected)` block bodies share the same emptiness check. Comments, empty
statements and empty nested blocks do not handle a failure. Meaningful statements
and explicit returns retain their existing treatment; forbidden return expressions
remain the responsibility of `prefer-falsey-returns`.

Static member spelling selects the handler position without proving promise
identity or callback execution. Named or dynamic handlers and positions preceded
by a spread supply no body evidence. This rule does not rewrite a handler or
invent a fallback value.

The current supported behavior and boundary cases are verified by:

- [rule-contracts.test.js](../../tests/rule-contracts.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
