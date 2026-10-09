import { getBindingReason } from './binding-reason.js';
import { getBindingAgreement, getBindingContract, getBindingDecision } from './defaults.js';
import { getObject } from '../../../rules/support/object.js';

const compilePlacementDecisions = ({ typescript = {}, evidence = {} } = {}) => {
    const { facts = new Map() } = evidence;
    const { SyntaxKind: { PropertyAccessExpression = -1 } = {} } = typescript;
    const completed = new Map([...facts].map(([node = {}, fact = {}] = []) => {
        const { contract = {} } = fact;
        const { kind = '', canonical = '', optional = false } = contract;
        const { kind: nodeKind = 0, name: { text = '' } = {} } = node;
        const cardinality = nodeKind === PropertyAccessExpression && ['length', 'size'].includes(text) && kind === 'number';
        const binding = getBindingAgreement(cardinality
            ? { state: 'known', canonical: '0', kind: 'number', owner: 'typed-producer', evidence: ['collection cardinality'] }
            : getBindingContract({ checkerContract: contract }));

        return [node, Object.freeze({ ...fact, binding: Object.freeze(getBindingDecision({ agreement: binding })),
            residualCanonical: optional && kind !== 'function' && nodeKind === PropertyAccessExpression ? '' : canonical })];
    }));

    return Object.freeze({ ...evidence, facts: completed });
};

const getSourcePlacementNode = ({ typescript = {}, node = {} } = {}) => {
    const { getOriginalNode = false } = typescript;

    return typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
};

const getPlacementFact = ({ typescript = {}, node = {}, placement = {} } = {}) => {
    const { facts = new Map() } = placement;

    return getObject(facts.get(getSourcePlacementNode({ typescript, node })));
};

const getPlacementContract = options => getObject(getPlacementFact(options).contract);
const unknownBindingDecision = Object.freeze(getBindingDecision({ agreement: getBindingAgreement({ state: 'unknown' }) }));
const getPlacementBindingDecision = options => getPlacementFact(options).binding || unknownBindingDecision;
const getExactUndefinedReason = ({ typescript = {}, node = {}, placement = {} } = {}) => {
    const { exactUndefined = new Set() } = placement;

    return exactUndefined.has(getSourcePlacementNode({ typescript, node }))
        ? 'Declared absence distinguishes undefined from supplied falsey values.' : '';
};
const getPlacementTypeInfo = ({ typescript = {}, node = {}, placement = {} } = {}) => {
    const { typeInfos = new Map() } = placement;

    return getObject(typeInfos.get(getSourcePlacementNode({ typescript, node })));
};
const getPlacementReason = (options = {}) => {
    const { kind = '' } = options;
    const { opaque = false, union = false } = getPlacementFact(options);

    return getBindingReason({ kind, union, opaque });
};
const hasPlacementAbsence = ({ typescript = {}, parameter = {}, placement = {} } = {}) => {
    const { absence = new Map() } = placement;

    return Boolean(absence.get(getSourcePlacementNode({ typescript, node: parameter })));
};
const isPlacementTuple = options => Boolean(getPlacementFact(options).tuple);
const isPlacementArray = options => Boolean(getPlacementFact(options).arrayLike);
const getPlacementSymbol = options => getPlacementFact(options).symbol;
const getPlacementBinding = ({ typescript = {}, element = {}, placement = {} } = {}) => {
    const { bindings = new Map(), namedBindings = new Map() } = placement;

    const binding = bindings.get(getSourcePlacementNode({ typescript, node: element }));

    if (binding) return binding;

    // Grammar can retain an original declaration name inside a new binding.
    // Its source identity owns the same canonical/guard/reason fact. A fresh
    // alias cannot borrow that evidence by spelling or range.
    const { name = {} } = getObject(element);

    return namedBindings.get(getSourcePlacementNode({ typescript, node: name })) ||
        { canonical: '', guardKind: '', reason: getBindingReason({ kind: 'unknown' }) };
};
const getBindingElementCanonical = options => getPlacementBinding(options).canonical || '';
const getBindingAgreementReason = options => getPlacementBinding(options).reason || '';
const getBindingRuntimeGuardKind = options => getPlacementBinding(options).guardKind || '';
const getPlacementPredicate = ({ typescript = {}, expression = {}, placement = {} } = {}) => {
    const { predicates = new Map() } = placement;
    const predicate = getObject(predicates.get(getSourcePlacementNode({ typescript, node: expression })));
    const { predicate: admitted = false } = predicate;
    const { arguments: [receiver = {}] = [] } = getObject(expression);
    const { kind = 0, text = '' } = getObject(receiver);
    const { SyntaxKind: { Identifier = -1 } = {} } = typescript;

    return admitted && kind === Identifier && text
        ? { ...predicate, receiver, receiverName: text, expression } : {};
};

export { getPlacementFact, getPlacementContract, getPlacementTypeInfo, getPlacementReason,
    hasPlacementAbsence, isPlacementTuple, isPlacementArray, getPlacementSymbol, getPlacementPredicate,
    getBindingElementCanonical, getBindingAgreementReason, getBindingRuntimeGuardKind,
    compilePlacementDecisions, getPlacementBindingDecision, getExactUndefinedReason };
