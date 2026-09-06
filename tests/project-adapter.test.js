import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

// eslint-disable-next-line import/no-useless-path-segments -- The test imports the package entry point directly.
import resilient, { createProjectAdapter } from '../index.js';

const directory = await mkdtemp(path.join(process.cwd(), '.resilient-project-'));
const appDirectory = path.join(directory, 'src', 'app');
const routeDirectory = path.join(appDirectory, 'dashboard');
const pageFile = path.join(routeDirectory, 'page.js');
const indexFile = path.join(routeDirectory, 'index.js');
const rootLayout = path.join(appDirectory, 'layout.js');
const routeLayout = path.join(routeDirectory, 'layout.js');
const rootNotFound = path.join(appDirectory, 'not-found.js');
const routeError = path.join(routeDirectory, 'error.js');
const utilityFile = path.join(directory, 'src', 'utils', 'index.js');
const componentFile = path.join(directory, 'src', 'components', 'Card.js');
const widgetFile = path.join(directory, 'src', 'components', 'Widget.jsx');

try {
    await mkdir(routeDirectory, { recursive: true });
    await mkdir(path.dirname(utilityFile), { recursive: true });
    await mkdir(path.dirname(componentFile), { recursive: true });
    await writeFile(pageFile, 'export default {};');
    await writeFile(indexFile, 'export default {};');
    await writeFile(rootLayout, 'export default {};');
    await writeFile(routeLayout, 'export default {};');
    await writeFile(rootNotFound, 'export default {};');
    await writeFile(routeError, 'export default {};');
    await writeFile(utilityFile, 'export default {};');
    await writeFile(componentFile, 'export default {};');
    await writeFile(widgetFile, 'export default {};');

    const project = createProjectAdapter({
        cwd: directory,
        aliases: { '@': 'src' },
        root: 'src/app',
        entryFiles: ['page'],
        ancestorFiles: ['layout'],
        inferredFiles: ['not-found', 'error']
    });

    assert.equal(project.resolver({
        from: pageFile,
        source: '@/utils'
    }), utilityFile);
    assert.equal(project.resolver({
        from: pageFile,
        source: '../../components/Card'
    }), componentFile);
    assert.deepEqual(project.roots({ fileName: pageFile }), [
        rootLayout,
        rootNotFound,
        routeLayout,
        routeError
    ]);
    assert.deepEqual(project.roots({ fileName: componentFile }), []);

    const defaultProject = createProjectAdapter({
        cwd: directory,
        root: 'src/app',
        ancestorFiles: ['layout']
    });

    assert.deepEqual(defaultProject.roots({ fileName: indexFile }), [rootLayout, routeLayout]);

    const invalidAliases = createProjectAdapter({
        cwd: directory,
        // eslint-disable-next-line resilient/signature-contract-call-site -- Deliberately tests invalid aliases input.
        aliases: ['@']
    });
    assert.equal(invalidAliases.resolver({
        from: pageFile,
        source: '@/utils'
    }), '');

    const projectConfig = resilient.imports({
        cwd: directory,
        aliases: { '@': 'src' },
        extensions: ['js', 'jsx']
    });
    const {
        settings: {
            'import-x/resolver-next': [importResolver = {}, nodeResolver = {}] = []
        } = {}
    } = projectConfig;

    assert.deepEqual(importResolver.resolve('@/utils', pageFile), {
        found: true,
        path: utilityFile
    });
    assert.deepEqual(nodeResolver.resolve('../../components/Widget', pageFile), {
        found: true,
        path: widgetFile
    });
} finally {
    await rm(directory, { recursive: true, force: true });
}
