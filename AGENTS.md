# Resilient Agent Instructions

These instructions apply to work inside `artikulates-resilient/`.

## Source of truth

Read the documents in this order when the task concerns project behavior:

1. [`docs/semantics.md`](docs/semantics.md) — the normative dialect;
2. [`docs/CODING_STANDARDS.md`](docs/CODING_STANDARDS.md) — the quick reference;
3. [`docs/contracts.md`](docs/contracts.md) — analyzer evidence and limits;
4. [`README.md`](README.md) — public configuration and product surface;
5. [`docs/scaling.md`](docs/scaling.md) — strategy, audience, schemas, and AI.

`.github/copilot-instructions.md` is a short adapter for Copilot-style tools.
Individual rule pages in `docs/rules/` own rule-specific behavior, exceptions,
and smell explanations.

When implementation and documentation disagree, inspect the implementation and
tests first. Update documentation only when the behavior is intentional.

## Working principles

- Use existing ECMAScript syntax as the project’s value and behavior language.
- Treat executable signatures, defaults, operations, control flow, and returns
  as contract evidence.
- Report known contradictions; preserve unknown values as unknown.
- Keep runtime validation and normalization at external boundaries.
- Keep transformation policy separate from analyzer inference: understanding a
  rejected update does not approve it.
- Respect external callback signatures, full-object forwarding, dynamic APIs,
  platform objects, draft boundaries, and meaningful sequential async work.
- Do not add a parallel annotation language, runtime schema system, or required
  dependency on `eslint-plugin-functional`.

## Rule development

For every new or changed rule:

1. identify the semantic invariant and boundary;
2. document the rule's smell, behavior, and exceptions;
3. add valid, invalid, and boundary tests;
4. add or update one representative `tests/fixtures/bad.js` example;
5. verify the rule does not duplicate an existing diagnostic;
6. run the complete test and lint commands.

The rule page should explain why the barrier exists without turning the rule
into a general mission statement.

## `tests/fixtures/bad.js` is an agent fixture

`tests/fixtures/bad.js` is intentionally invalid. It contains one labeled
highlight case for each public Resilient rule and is excluded from aggregate
linting. Its local provider fixture lives beside it at
`tests/fixtures/bad-import-provider.js`.

Use it to inspect diagnostics and local-import contract propagation:

```bash
npx eslint tests/fixtures/bad.js --no-warn-ignored
npm run inspect:stack -- tests/fixtures/bad.js --find "getItems({}).toUpperCase" --diagnostics
```

Do not make it pass. If an example becomes ambiguous, update its label,
corresponding test, and rule documentation together.

The machine-checkable fixture contract is [`tests/fixtures/manifest.json`](tests/fixtures/manifest.json).
It must list every public rule and its `bad.js` highlight; `npm run
fixtures:check` also executes the fixture and requires a matching diagnostic
inside each labeled section. Integration fixtures in
`tests/fixtures/integration/` model real engine structures such as caches, API
responses, refs, reducers, accumulators, and boundary-owned mutable objects. Their
tests must prove both that explicit boundary exceptions remain valid and that input,
external-data, and ordinary-loop violations still report without duplicate findings.
Run `npm run fixtures:check` after changing rules or fixtures.

## AI-facing behavior

When changing code:

1. inspect the relevant boundary and existing evidence;
2. separate known facts from unknowns;
3. identify the smallest semantic contradiction or smell barrier involved;
4. make the smallest change that preserves the contract;
5. run diagnostics and tests;
6. report changes, remaining unknowns, and verification results.

Do not invent types, normalize external data silently, or mechanically replace
sequential work with `Promise.all`.

## Verification

From this directory:

```bash
npm test
npm run fixtures:check
npx eslint . --ignore-pattern tests/fixtures
```

The package requires Node.js `>=18.18.0` and ESLint `>=9.0.0`.

## Completion checklist

- [ ] The change follows [`docs/semantics.md`](docs/semantics.md).
- [ ] Known contradictions are distinguished from unknown values.
- [ ] Boundary exceptions are explicit and narrow.
- [ ] Tests cover valid, invalid, and exception cases.
- [ ] `tests/fixtures/manifest.json` and `tests/fixtures/bad.js` coverage remain complete.
- [ ] `npm test` passes.
- [ ] `npm run fixtures:check` passes.
- [ ] `npx eslint . --ignore-pattern tests/fixtures` passes.
- [ ] No unrelated files or user changes were overwritten.

`RESILIENT.md` is a human-facing pointer to this file and the product
semantics.
