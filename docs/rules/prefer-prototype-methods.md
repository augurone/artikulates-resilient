# prefer-prototype-methods

This rule is implemented in [the current package](../../analysis/eslint/prefer-prototype-methods.js).
Its implementation uses syntax and lexical ownership.

The current supported behavior and boundary cases are verified by:

- [mutation-policy.test.js](../../tests/mutation-policy.test.js)
- [syntax-policy.test.js](../../tests/syntax-policy.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
