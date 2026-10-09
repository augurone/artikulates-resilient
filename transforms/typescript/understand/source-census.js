import { isFunction } from '../../../analysis/host/function.js';
import { getObject } from '../../../analysis/host/object.js';
import { getSyntaxKinds } from '../../utils/ast-boundary.js';

// One original semantic tree per analysis. Tokens and JSDoc are deliberately
// outside this census; token-sensitive consumers retain their compiler walk.
const createSourceCensus = ({ typescript = {}, sourceFile = {} } = {}) => {
    const records = [];
    const visit = (node, parent = false) => {
        const { kind = 0 } = getObject(node);
        const record = { node, kind, parent, order: records.length };

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private preorder ledger retains compiler node identity and linear construction before publication.
        records.push(record);
        typescript.forEachChild(node, (child) => { visit(child, record); });
    };
    visit(sourceFile);
    const byKind = Map.groupBy(records, ({ kind = 0 } = {}) => kind);
    const byNode = new Map(records.map((record) => {
        const { node = {} } = record;

        return [node, record];
    }));
    const byParent = Map.groupBy(records, ({ parent = false } = {}) => parent);
    const children = node => (byParent.get(byNode.get(node)) || []).map(({ node = {} } = {}) => node);
    const select = (...kinds) => kinds.flatMap(kind => byKind.get(kind) || [])
        .toSorted(({ order: left = 0 } = {}, { order: right = 0 } = {}) => left - right)
        .map(({ node = {} } = {}) => node);
    const ancestors = (node = {}) => {
        const { parent = false } = getObject(byNode.get(node));
        const ascend = ({ node: ancestor = {}, parent: next = false } = {}) => {
            return [ancestor, ...(next ? ascend(getObject(next)) : [])];
        };

        return parent ? ascend(getObject(parent)) : [];
    };

    return { sourceFile, select, ancestors, children };
};

const collectBindingReferences = ({
    typescript = {}, sourceFile = {}, checker = {},
    census = createSourceCensus({ typescript, sourceFile })
} = {}) => {
    const { Identifier = -1, ShorthandPropertyAssignment = -1 } = getSyntaxKinds(typescript);
    const { getSymbolAtLocation, getShorthandAssignmentValueSymbol } = getObject(checker);

    if (!isFunction(getSymbolAtLocation)) return new Map();

    const symbolOf = (node = {}) => {
        const { parent = {} } = getObject(node);

        return getObject(parent).kind === ShorthandPropertyAssignment &&
            isFunction(getShorthandAssignmentValueSymbol)
            ? getShorthandAssignmentValueSymbol.call(checker, parent)
            : getSymbolAtLocation.call(checker, node);
    };

    return Map.groupBy(census.select(Identifier), symbolOf);
};

export { createSourceCensus, collectBindingReferences };
