# operator-linebreak

This rule is implemented in [the current package](../../analysis/eslint/operator-linebreak.js).
Its implementation uses syntax and lexical ownership.

The current supported behavior and boundary cases are verified by:

- [control-layout.test.js](../../tests/control-layout.test.js)
- [native-absence.test.js](../../tests/native-absence.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
