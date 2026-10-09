# no-null-assignment

This rule is implemented in [the current package](../../analysis/eslint/no-null-assignment.js).
Its implementation uses syntax and lexical ownership.

The current supported behavior and boundary cases are verified by:

- [absence-signatures.test.js](../../tests/absence-signatures.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
