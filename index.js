import preferSignatureDestructuring from './rules/prefer-signature-destructuring.js';

const plugin = {
    meta: {
        name: 'eslint-plugin-resilient',
        version: '0.1.0'
    },
    rules: {
        'prefer-signature-destructuring': preferSignatureDestructuring
    },
    configs: {}
};

plugin.configs.recommended = {
    plugins: {
        resilient: plugin
    },
    rules: {
        'resilient/prefer-signature-destructuring': 'error'
    }
};

export default plugin;
