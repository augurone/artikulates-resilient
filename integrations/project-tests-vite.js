import { createProjectTestRouting } from './project-tests-routing.js';

export const projectTestRoutingPlugin = (configuration = {}) => {
    const routing = createProjectTestRouting(configuration);

    return {
        name: 'resilient-project-test-routing', enforce: 'pre',
        async resolveId(specifier, importer) {
            // eslint-disable-next-line resilient/prefer-falsey-returns -- Vite's null result delegates resolution to the next plugin; false would mark an external module.
            if (!importer || importer.startsWith('\0')) return null;

            const destination = routing.route(specifier, importer);

            if (destination) return destination;

            const original = routing.original(importer);

            if (original !== importer) return this.resolve(specifier, original, { skipSelf: true });

            // eslint-disable-next-line resilient/prefer-falsey-returns -- Vite's null result delegates unresolved imports to its remaining plugins.
            return null;
        },
        load(id) {
            if (!id.startsWith('\0')) routing.loaded(id);

            // eslint-disable-next-line resilient/prefer-falsey-returns -- The guard observes physical loading; Vite's null result retains the existing loader.
            return null;
        },
        transform(code, id) {
            if (!id.startsWith('\0')) routing.guard(id);

            // eslint-disable-next-line resilient/prefer-falsey-returns -- The guard preserves test and artifact bytes; Vite's null result retains its existing transforms.
            return null;
        }
    };
};
