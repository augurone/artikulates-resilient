# signature-contract-call-site

This rule is implemented in [the current package](../../analysis/eslint/signature-contract-call-site.js).
Its implementation uses the shared analyzer and source-owned evidence.

Known noncallable contributions are contradictions at an invocation, including
natural absence carried through a returned value, record field or array slot.
Native collection callback positions also require callable values, even for an
empty collection. The finding belongs to the consuming call or callback argument.
An unknown value stays unknown; a guard must establish callability before the
invocation. The rule uses the existing reached execution and argument completion
evidence, so a throwing argument or an unreached call cannot supply a new
invocation proof. Existing native receiver contradictions remain owned by the
operation rule.

Native `forEach` additionally requires synchronous callbacks. Known async
functions retain that obligation through callable aliases, even for an empty
array; known promise results from executed callbacks are also rejected.
`forEach` ignores those results rather than owning their completion. Rejection
handling inside the callback does not waive the contract. Ordered asynchronous
work may use a loop with an exact-rule, concrete-reason exception; loops are not
automatically exempted. `filter(Boolean)` remains valid: native filtering coerces
callback results, rather than requiring Boolean-valued results. Use the public
`standard/object` `hasContent` utility when the intended predicate is object
content instead of object truthiness.

The current supported behavior and boundary cases are verified by:

- [calls-completions.test.js](../../tests/calls-completions.test.js)
- [callback-revisions.test.js](../../tests/callback-revisions.test.js)
- [predicate-modules.test.js](../../tests/predicate-modules.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)
- [natural-absence-values.test.js](../../tests/natural-absence-values.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
