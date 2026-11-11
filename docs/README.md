# Resilient documentation

Start with the [package README](../README.md) for the current layout, commands
and public entry points.

| Task | Read |
| --- | --- |
| Understand package ownership and semantic contracts | [Architecture](engineering/architecture.md) |
| Lower an existing TypeScript project | [TypeScript lowering](engineering/typescript.md) |
| Start a consumer lowering workflow | [Project lowering guide](guide/typescript-project-lowering.md) |
| Develop, verify and check package delivery | [Engineering guide](engineering/README.md) |
| Use repository-only lint options and autofixes | [Repository lint commands](engineering/README.md#repository-lint-command-usage) |
| Review capabilities retained or missing from the predecessor | [Feature review](engineering/feature-review.md) |
| Understand the dialect and its exceptions | [Language references](reference/README.md), [rule pages](rules/) |
| Write code within the dialect | [Writing guidance and current owners](ai/README.md), [migration playbook](guide/migration-playbook.md) |
| Understand and repair a finding | [Diagnostic explanations](guide/diagnostic-explanations.md) |
| Measure a consumer project's fluency and inventory exceptions | [Consumer measurement](guide/diagnostic-explanations.md#measure-a-project-and-inventory-exceptions) |
| Enforce consumer policy in CI and retain fluency reports | [Consumer CI](../README.md#consumer-ci-enforce-policy-and-retain-the-measurement) |
| Clarify defaults, unknowns and evidence limits | [Questions about the agreement model](guide/overcoming-objections.md) |
| Locate agreement laws, proof obligations and lowering patterns | [Agreement reference map](reference/AGREEMENT_MAP.md) |
| Read the design rationale | [Essays](blogs/README.md) |
| Read current changes and release history | [Changelog](../CHANGELOG.md) — upcoming changes and earlier releases |

Grammar, Policy, Semantics and the coding standards are the normative language
references. Current guides distinguish implemented behavior from requirements
and known gaps. Essays and archived engineering records do not establish feature
coverage or add verification gates.
