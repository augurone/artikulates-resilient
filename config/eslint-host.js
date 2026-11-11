import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createPackageIdentity } from '../integrations/package-identity.js';

export { ESLint } from 'eslint';

export { auditSource } from '../scripts/audit-eslint-exceptions.js';

const getToolVersions = () => {
    const identity = createPackageIdentity();
    const packageFile = fileURLToPath(new URL('../package.json', import.meta.url));
    const { data: { dependencies = {}, devDependencies = {}, peerDependencies = {} } = {} } = identity.manifest(packageFile);
    const tools = Object.keys({ ...dependencies, ...devDependencies, ...peerDependencies }).toSorted();

    return Object.fromEntries(tools.map((name) => {
        const { data: { version = '' } = {} } = identity.installed(name, packageFile);

        if (!version) throw new Error(`Missing installed verification tool: ${name}`);

        return [name, version];
    }));
};

// Report the installed tools rather than duplicating versions in host metadata.
export const manifest = { ...JSON.parse(readFileSync(new URL('./eslint-host.json', import.meta.url), 'utf8')), toolVersions: getToolVersions() };
