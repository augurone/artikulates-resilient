# prefer-destructured-member-access

This rule is implemented in [the current package](../../analysis/eslint/prefer-destructured-member-access.js).
Its implementation uses syntax and lexical ownership.

The rule applies to consumed data, not assignment, update, delete or assignment-
pattern member targets. A target retains its writable reference. Mutation policy
still applies independently, including when a concrete mutation exception is
required. Receiver objects, computed keys, right-hand values and pattern defaults
keep their read obligations.

Existing local resolution and receiver/cardinality handling run without native
prototype discovery. Any generic prototype fallback is limited to a remaining
explicit known `Map.prototype.member` or `Set.prototype.member` path after local
resolution fails; this repair needs none. It adds no instance inference or native
catalog expansion.

The current supported behavior and boundary cases are verified by:

- [rule-contracts.test.js](../../tests/rule-contracts.test.js)
- [signature-policy.test.js](../../tests/signature-policy.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
