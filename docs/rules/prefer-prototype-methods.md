# prefer-prototype-methods

This rule is implemented in [the current package](../../analysis/eslint/prefer-prototype-methods.js).
Its implementation uses syntax and lexical ownership.

Every loop form reports, including awaited iteration and synchronous I/O.
An intentional loop requires an exact-rule exception with a concrete semantic
reason under Policy P-03. There is no automatic async/I/O exemption and no
behavior-changing automatic rewrite. An async `forEach` callback is not an
alternative: the call-site contract rejects its discarded async completion.

The current supported behavior and boundary cases are verified by:

- [mutation-policy.test.js](../../tests/mutation-policy.test.js)
- [syntax-policy.test.js](../../tests/syntax-policy.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
