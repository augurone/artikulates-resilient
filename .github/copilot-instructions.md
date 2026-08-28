# Coding Instructions

Before changing code, read:

- [docs/semantics.md](../docs/semantics.md)
- [docs/CODING_STANDARDS.md](../docs/CODING_STANDARDS.md)
- [AGENTS.md](../AGENTS.md)

Those files define the dialect, operational examples, and agent workflow. Do
not create a competing set of coding rules here.

## Non-negotiable checks

- Do not use optional chaining; use the documented defensive boundary pattern.
- Do not use `||` as a destructuring fallback.
- Do not compare collection length to zero for presence checks.
- Do not use `else`, `else if`, or nested `if` statements in one function.
- Prefer destructured application-owned boundaries with explicit defaults.
- Prefer returned transformations over in-place object or array mutation.
- Use collection methods for collection transformations.
- Use `Promise.all` for independent work and sequential `await` when ordering,
  rate limits, retries, polling, or early termination require it.
- Give every promise chain visible rejection ownership.
- Keep `try`, `catch`, `finally`, and `throw` available for real error paths;
  do not leave catch blocks empty.

Legitimate boundaries remain valid: external callback signatures, full-object
forwarding, dynamic APIs, DOM objects, refs, caches, draft reducers, and
meaningful sequential loops. Use the supported rule options or exception
comments rather than inventing a new suppression form.

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
