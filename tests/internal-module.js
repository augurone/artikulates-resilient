import fs from 'node:fs';

// Proof access only: the production module keeps its private owners private.
// Rebase imports and expose proof capabilities; do not replace owner bodies.
const loadInternalModule = ({
    file = '', exports: names = [], returnProbe: { fields = '', names: returnedNames = [] } = {}
} = {}) => {
    const moduleURL = new URL(file, new URL('../', import.meta.url));
    const source = fs.readFileSync(moduleURL, 'utf8');
    const rebased = source.replace(/from '([^']+)'/gu, (match, relative) => (
        `from ${JSON.stringify(relative.startsWith('.') ? new URL(relative, moduleURL).href : import.meta.resolve(relative))}`
    ));
    const accessible = fields ? rebased.replace(
        `return { ${fields} };`, `return { ${fields}, ${returnedNames.join(', ')} };`
    ) : rebased;
    const instrumented = `${accessible}\nexport { ${names.join(', ')} };\n`;

    return import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);
};

export { loadInternalModule };
