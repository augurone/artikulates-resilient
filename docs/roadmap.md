# Resilient roadmap

This is the only document for proposed or unimplemented product work. The
README, semantics, coding standards, contract documentation, and rule pages
describe the current package only.

Roadmap items are proposals, not shipped capabilities or release promises.

## Adapter and tooling work

- [ ] Add an editor or language-server adapter for the contract document API.
- [ ] Add project resolution for package aliases, dynamic imports, and
  filesystem-wide discovery.
- [ ] Add parser-backed project loading and machine-readable inspector output.
- [ ] Add a first-run configuration command such as `npx resilient init`.

## Evaluation and adoption work

- [ ] Add a benchmark of real bugs and intentional non-findings.
- [ ] Add a GitHub Action and review-oriented diagnostic output.
- [ ] Publish an AI coding guide, evaluation corpus, and reusable constitution
  examples.
- [ ] Document migration paths and maintain a small example repository.

## Evidence adapters

- [ ] Evaluate integrations that add evidence from existing runtime schema
  validators without introducing a schema language into Resilient.
- [ ] Revisit mutation false positives and boundary-exception ergonomics using
  real consumer feedback.
