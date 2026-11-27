# no-unhandled-promise-chain

This rule is implemented in [the current package](../../analysis/eslint/no-unhandled-promise-chain.js).
Its implementation uses the shared analyzer and source-owned evidence.

The current supported behavior and boundary cases are verified by:

- [Promise contracts](../../tests/promise-contracts-public.test.js)
- [rule-canary.test.js](../../tests/rule-canary.test.js)

Known dropped call results are checked through conditional and logical arms and
retained array contents. Native map/flatMap results can contain promise work even
though the collection itself is not a promise. Reusing an existing promise in a
discarded transformation does not create another ownership obligation. Known
promise evidence remains visible; the dropped-work judgment selects creations
from that evaluation, including calls inside named callbacks. A fresh promise
created inside the callback still needs an owner. Explicit ownership forms retain
their existing meaning; unknown callees remain handoffs and unavailable
collection contents remain unproved.

[Language policy](../reference/policy.md) remains normative. Unsupported analysis
remains unknown; no legacy analyzer is used to fill gaps.
