# signature-contract-return-consistency

This rule is implemented in [the current package](../../analysis/eslint/signature-contract-return-consistency.js).
Its implementation uses the shared analyzer and source-owned evidence.

The current supported behavior and boundary cases are verified by:

- [calls-completions.test.js](../../tests/calls-completions.test.js)
- [callback-revisions.test.js](../../tests/callback-revisions.test.js)
- [predicate-modules.test.js](../../tests/predicate-modules.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
