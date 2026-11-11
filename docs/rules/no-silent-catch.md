# no-silent-catch

This rule is implemented in [the current package](../../analysis/eslint/no-silent-catch.js).
Its implementation uses syntax and lexical ownership.

The current supported behavior and boundary cases are verified by:

- [error-handling-policy.test.js](../../tests/error-handling-policy.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
