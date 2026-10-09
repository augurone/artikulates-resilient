# Coding Instructions

Before changing code, read:

- [docs/reference/grammar.md](../docs/reference/grammar.md)
- [docs/reference/policy.md](../docs/reference/policy.md)
- [docs/reference/semantics.md](../docs/reference/semantics.md)
- [docs/ai/writing-resilient.md](../docs/ai/writing-resilient.md)
- [docs/ai/CODING_STANDARDS.md](../docs/ai/CODING_STANDARDS.md)
- [AGENTS.md](../AGENTS.md)

Those files define the dialect, operational examples, and agent workflow. Do
not create a competing set of coding rules here. Before your first Resilient
implementation or review, use the first-principles guide to establish input
ownership, result agreement, absence behavior, and failure ownership. Follow
its blog and code references where the dialect differs from your familiar
JavaScript or TypeScript assumptions.

For lowering recovery, follow the bounded-packet, protected-evidence and
independent-review requirements in the
[recovery execution contract](../docs/engineering/LOWERING_RECOVERY_EXECUTION_CONTRACT_2026-10-05.md). The
[recovery plan](../docs/engineering/LOWERING_RECOVERY_PLAN_2026-10-05.md)
is a queue, not authorization to execute every packet. Work only within the
selected phase's file/owner and behavior contract; minor fixes and failed gates
do not expand it. The first phase produces read-only reconciliation and an
unapplied patch proposal, then stops before implementation or corpus execution.
Delegates inherit that same boundary. Independent review must inspect the
actual diff and evidence before implementation acceptance.
Use the plan's evidence checklist: a successful process or `--verify` result
alone does not establish acceptance. The final integrated snapshot, complete
file/test sets, exact raw runtime bytes and report contents must satisfy it.
Do not execute archived measurement wrappers against their original evidence.

## Non-negotiable checks

- Do not use optional chaining; use the documented defensive boundary pattern.
- Do not use `||` as a destructuring fallback.
- Do not compare collection length to zero for presence checks.
- Do not use `else`, `else if`, or nested `if` statements in one function.
- Prefer destructured application-owned boundaries with explicit defaults.
- Put the fields a function needs in its destructured signature whenever the
  boundary is known; do not postpone contract definition inside the body.
- Prefer returned transformations over in-place object or array mutation.
- Use collection methods for collection transformations.
- Use `Promise.all` for independent work and sequential `await` when ordering,
  rate limits, retries, polling, or early termination require it.
- Give every promise chain visible rejection ownership.
- Keep `try`, `catch`, `finally`, and `throw` available for real error paths;
  do not leave catch blocks empty.

All repository code is subject to these rules, including analyzer and support
implementation code. A highlighted error that does not fail the CLI is a
diagnostic/configuration defect, not permission to continue. Exceptions must
be local and explicit: use a narrow disable comment beside the exact statement
and explain the concrete boundary or identity requirement. Never add a
file-wide or config-wide disable to make a build pass. First repair the code
with a complete destructured signature and the shared `isObject`, `getObject`,
or `hasObjectValue` utilities.

Legitimate boundaries remain valid: external callback signatures, full-object
forwarding, dynamic APIs, DOM objects, refs, caches, draft reducers, and
meaningful sequential loops. A loop's `await` or direct control flow does not
relax the rule. Use the narrow forms and concrete semantic reasons defined in
[Policy P-03](../docs/reference/policy.md#p-03-exceptions-and-precedence).
Legacy `resilient-allow` markers are not accepted.

## Before completing a change

Follow [AGENTS.md](../AGENTS.md) and the current
[acceptance record](../docs/engineering/REARCHITECTURE.md). Develop focused
proofs first; run the complete gate for a material packet, repair failures and
restart it before corpus measurement only within the authorized scope. Preserve
and report an out-of-scope blocker before attempting its repair. Release checks
are a separate workflow. A selected read-only phase ends at its stated boundary;
these commands do not authorize advancing to implementation.

```bash
set -e
set -o pipefail
npm test
npm run fixtures:check
npx eslint . --ignore-pattern tests/fixtures
git diff --check
```

The intentionally invalid [bad.js](../tests/fixtures/bad.js) fixture contains
one labeled example for every public rule. Use it to inspect diagnostics; do
not make it pass.

When reporting completion, separate known facts, unknowns, changes, and
verification results.
