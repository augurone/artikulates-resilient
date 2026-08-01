# eslint-plugin-resilient

Resilient is an opinionated, ECMAScript-native standard for functional-first, data-driven JavaScript. It uses explicit contracts, predictable shapes, declarative transformations, and graceful runtime degradation while reserving hard failures for the build.

The standard is organized into three enforceable buckets:

- **Contracts** — destructured signatures, safe defaults, and no fallback
  destructuring.
- **Values** — returned values preserve their expected type, including stable
  falsey shapes for flexible or missing data.
- **Intent** — early returns, shallow control flow, and prototype methods make
  transformations and decisions visible.

* Data flow: Inspired by Flux and functional approaches, with clear movement from input to transformation to output.
* Contracts: Destructured signatures declare required data, defaults handle absence, and malformed shapes remain visible contract violations.
* Runtime behavior: Missing content degrades pragmatically into stable empty values instead of taking down the site.
* Control flow: No classes, nested conditionals, else branches, or imperative loops; native functions and prototype methods state intent directly.
* Enforcement: ESLint turns the model into build-time rules so invalid code fails before publication while valid runtime variation remains survivable.

**These rules are based on:** docs/CODING_STANDARDS.md

## Install

```bash
npm install --save-dev eslint-plugin-resilient
```

## Configure

For ESLint flat config, add the recommended configuration:

```javascript
import resilient from 'eslint-plugin-resilient';

export default [
    resilient.configs.recommended
];
```

The recommended configuration enables the nine custom resilient rules plus
the native ESLint rules used by the standard.

Resilient uses ESLint flat config and supports ESLint 9 or later. Node.js
18.18 or later is supported.

## IDE integration

Resilient does not require an editor-specific plugin. Editors use the local
ESLint installation and the project's `eslint.config.js`.

### VS Code

Install the [ESLint extension](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
and open the project folder. If workspace settings define `eslint.validate`,
include JavaScript:

```json
{
    "eslint.validate": ["javascript"],
    "eslint.useFlatConfig": true,
    "editor.codeActionsOnSave": {
        "source.fixAll.eslint": "explicit"
    }
}
```

ESLint 9 uses flat config by default. The extension resolves ESLint from the
opened workspace, so install ESLint and Resilient locally rather than relying
on a global installation.

### JetBrains IDEs

In WebStorm or another JetBrains IDE, open **Settings | Languages & Frameworks
| JavaScript | Code Quality Tools | ESLint** and select **Automatic ESLint
configuration**. The IDE will use the local ESLint package and
`eslint.config.js`. For monorepos, set the working directory to the package
that contains the relevant configuration.

The Resilient rules currently report problems but do not automatically rewrite
code. Editor highlighting works immediately; save-time fixes apply only to
other ESLint rules that provide fixes.

## Custom rules

- `resilient/prefer-signature-destructuring`
- `resilient/no-destructuring-fallback`
- `resilient/no-else`
- `resilient/no-length-comparison`
- `resilient/no-nested-if`
- `resilient/no-undefined-assignment`
- `resilient/prefer-falsey-returns`
- `resilient/prefer-prototype-methods`
- `resilient/prefer-safe-destructuring-defaults`

To enable rules selectively:

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

Rule details and examples are in [docs/rules](docs/rules/). The complete
standard, including rationale and exceptions, is in
[docs/CODING_STANDARDS.md](docs/CODING_STANDARDS.md).

## Development

```bash
npm test
npm run lint
```

## License

MIT
