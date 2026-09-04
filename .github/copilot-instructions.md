# Coding Instructions

Before changing code, read:

- [docs/reference/semantics.md](../docs/reference/semantics.md)
- [docs/ai/CODING_STANDARDS.md](../docs/ai/CODING_STANDARDS.md)
- [AGENTS.md](../AGENTS.md)

Those files define the dialect, operational examples, and agent workflow. Do
not create a competing set of coding rules here.

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
meaningful sequential loops. For collection loops, `await` and direct
`break`/`continue`/`return`/`throw` are native exceptions; other retained loops
need `// resilient-allow-loop: reason`. Use the supported rule options or
exception comments rather than inventing a new suppression form.

## Before completing a change

```bash
npm test
npm run fixtures:check
npx eslint . --ignore-pattern tests/fixtures
```

The intentionally invalid [bad.js](../tests/fixtures/bad.js) fixture contains
one labeled example for every public rule. Use it to inspect diagnostics; do
not make it pass.

When reporting completion, separate known facts, unknowns, changes, and
verification results.
