# no-unguarded-callback-invocation

This rule is implemented in [the current package](../../analysis/eslint/no-unguarded-callback-invocation.js).
Its implementation uses the shared analyzer and source-owned evidence.

Natural absence from an ordinary unassigned `let` remains absent. A callable
guard admits its supported invocation; no no-op callback or explicit undefined
default is required. Known noncallable values reached through properties, results
and native collection callback positions also receive call-site findings.

The current supported behavior and boundary cases are verified by:

- [calls-completions.test.js](../../tests/calls-completions.test.js)
- [callback-revisions.test.js](../../tests/callback-revisions.test.js)
- [predicate-modules.test.js](../../tests/predicate-modules.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
