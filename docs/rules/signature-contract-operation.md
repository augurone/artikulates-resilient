# signature-contract-operation

This rule is implemented in [the current package](../../analysis/eslint/signature-contract-operation.js).
Its implementation uses the shared analyzer and source-owned evidence.

The current supported behavior and boundary cases are verified by:

- [structured-selection.test.js](../../tests/structured-selection.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
