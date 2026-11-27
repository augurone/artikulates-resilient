# no-undefined-assignment

This rule is implemented in [the current package](../../analysis/eslint/no-undefined-assignment.js).
Its implementation uses syntax and lexical ownership.

The current supported behavior and boundary cases are verified by:

- [explicit-absence-values.test.js](../../tests/explicit-absence-values.test.js)
- [native-absence.test.js](../../tests/native-absence.test.js)
- [absence-signatures.test.js](../../tests/absence-signatures.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
