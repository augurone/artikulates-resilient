# eslint-plugin-resilient

ESLint rules for explicit, runtime-resilient JavaScript.

Resilient is part of the Artikulates brand of opinionated JavaScript tooling.

This package turns a team style guide into enforceable rules. It is designed for two audiences:

- People who need a readable, review-friendly coding standard
- AI assistants that produce better code when the rules are explicit

Today, the package ships one custom rule and a broader standards document that the rule set will continue to grow toward.

## Project Structure

```
index.js                          # Plugin entry point
eslint.config.js                  # Reference ESLint config (used by this project and as a base)
rules/
    prefer-signature-destructuring.js   # Custom rule implementation
docs/
    CODING_STANDARDS.md           # Full coding standards (source of truth)
    rules/
        prefer-signature-destructuring.md   # Rule documentation
```

The [coding standards](docs/CODING_STANDARDS.md) document is the authoritative reference. Here is how the pieces connect:

| Layer | File | Purpose |
|---|---|---|
| Standards | [docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md) | Source of truth — full rules with rationale |
| Lint enforcement | [eslint.config.js](eslint.config.js) | Shows the opinionated style this project uses internally |
| Custom rules | [rules/](rules/) | Patterns ESLint cannot enforce natively |
| AI guidance | [.github/copilot-instructions.md](.github/copilot-instructions.md) | Quick-reference version for AI assistants |

## TL;DR

This plugin currently favors:

- explicit function contracts
- predictable return shapes
- defensive destructuring
- transformation-oriented code
- readable guard-clause control flow

## Philosophy

The core idea is simple: code should make its assumptions visible.

In practice, that usually means:

- function signatures show what data they expect
- missing data is handled deliberately
- callers receive predictable types
- transformations are expressed with array methods that reveal intent

This is not about being clever or minimal. It is about making code easier to review, safer to change, and easier for both humans and tools to follow consistently.

## Installation

```bash
npm install --save-dev eslint-plugin-resilient
```

## Usage

### Flat config

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended
];
```

This enables the currently shipped custom rule:

- `resilient/prefer-signature-destructuring`

### Manual configuration

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    {
        plugins: {
            resilient
        },
        rules: {
            'resilient/prefer-signature-destructuring': 'error'
        }
    }
];
```

## Current Rules

### `prefer-signature-destructuring`

Encourages destructuring object parameters in the function signature instead of inside the function body.

```javascript
// Avoid
const processUser = (user) => {
    const { name, age } = user;
    return `${name} (${age})`;
};

// Prefer
const processUser = ({
    name = '',
    age = 0
} = {}) => `${name} (${age})`;
```

Why it helps:

- makes the function contract visible at the boundary
- applies safe defaults earlier
- reduces repeated shape-reading inside the body

Full rule documentation: [docs/rules/prefer-signature-destructuring.md](docs/rules/prefer-signature-destructuring.md)

## Status

This is an early focused release:

- one custom rule is implemented and published
- the style guide documents the larger system it belongs to
- additional rules will be added incrementally instead of bundled all at once

## Roadmap

Planned rules that align with the broader style system:

- `prefer-safe-destructuring-defaults`
- `prefer-truthy-emptiness-checks`
- `prefer-functional-iteration`
- `prefer-early-returns`
- `prefer-predictable-empty-returns`


## License

MIT
