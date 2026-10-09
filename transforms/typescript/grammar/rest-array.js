import { getMemberAlias } from './member-access.js';
import { getObject } from '../../../rules/support/object.js';

// The completed agreement owns the argument sequence. Object binding reads
// numeric properties without acquiring an iterator, unlike array binding.
// `void 0` records the exact absent-position result without a shadowable
// `undefined` identifier or a newly invented container.
const createRestArrayFixedSelection = ({ typescript = {}, node = {}, contract = {}, occupied = new Set() } = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {} } = typescript;
    const { expression: call = {} } = getObject(node);
    const { expression: callee = {}, typeArguments = undefined, arguments: args = [] } = getObject(call);
    const { restName = '', positions = [] } = getObject(contract);
    const { getOriginalNode = false } = typescript;
    const stillOwnsSourceReads = positions.every(({ sourceRange = '' } = {}, index) => {
        const [argument = {}] = args.slice(index, index + 1);
        const original = typeof getOriginalNode === 'function' ? getOriginalNode(argument) : argument;
        const { pos = -1, end = -1 } = getObject(original);

        return `${pos}:${end}` === sourceRange;
    });

    if (!restName || !positions.length || positions.length !== args.length || !stillOwnsSourceReads) return node;

    let used = new Set(occupied);
    const selections = positions.map(({ index = -1 } = {}) => {
        const alias = getMemberAlias({ objectName: restName, propertyName: String(index), occupied: used });

        used = new Set([...used, alias]);

        return { index, alias };
    });
    const binding = factory.createObjectBindingPattern(selections.map(({ index = -1, alias = '' } = {}) => {
        return factory.createBindingElement(
            undefined,
            factory.createNumericLiteral(index),
            factory.createIdentifier(alias),
            factory.createVoidExpression(factory.createNumericLiteral(0))
        );
    }));
    const declaration = factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(binding, undefined, undefined, factory.createIdentifier(restName))
        ], ConstKind)
    );
    const nextCall = factory.updateCallExpression(
        call,
        callee,
        typeArguments,
        selections.map(({ alias = '' } = {}) => factory.createIdentifier(alias))
    );

    return factory.createBlock([declaration, factory.updateReturnStatement(node, nextCall)], true);
};

// The curried callee is produced before its argument is read. A source-derived
// staging binding preserves that order, then numeric object binding performs
// the exact property Get without acquiring the rest array's iterator.
const createRestArrayStagedSelection = ({ typescript = {}, node = {}, contract = {}, occupied = new Set() } = {}) => {
    const { factory = {}, NodeFlags: { Const: ConstKind = 0 } = {} } = typescript;
    const { getOriginalNode = false } = typescript;
    const original = typeof getOriginalNode === 'function' ? getOriginalNode(node) : node;
    const { pos = -1, end = -1 } = getObject(original);
    const { callbackRange = '', sourceRange = '', restName = '', index = -1 } = getObject(contract);
    const { body: call = {}, parameters = [], modifiers = [], typeParameters = [], type = undefined } = getObject(node);
    const { expression: precedingCall = {}, arguments: args = [], typeArguments = undefined } = getObject(call);
    const [read = {}] = args;
    const originalRead = typeof getOriginalNode === 'function' ? getOriginalNode(read) : read;
    const { pos: readPos = -1, end: readEnd = -1 } = getObject(originalRead);

    if (`${pos}:${end}` !== callbackRange || `${readPos}:${readEnd}` !== sourceRange ||
        !restName || !Number.isInteger(index) || index < 0 || index >= 32 || args.length !== 1) return node;

    const calleeName = getMemberAlias({ objectName: restName, propertyName: 'callee', occupied });
    const valueName = getMemberAlias({ objectName: restName, propertyName: String(index),
        occupied: new Set([...occupied, calleeName]) });
    const declaration = (name = {}, initializer = {}) => factory.createVariableStatement(
        undefined,
        factory.createVariableDeclarationList([
            factory.createVariableDeclaration(name, undefined, undefined, initializer)
        ], ConstKind)
    );
    const stagedCallee = declaration(factory.createIdentifier(calleeName), precedingCall);
    const selectedValue = declaration(factory.createObjectBindingPattern([
        factory.createBindingElement(
            undefined,
            factory.createNumericLiteral(index),
            factory.createIdentifier(valueName),
            factory.createVoidExpression(factory.createNumericLiteral(0))
        )
    ]), factory.createIdentifier(restName));
    const nextCall = factory.updateCallExpression(call, factory.createIdentifier(calleeName),
        typeArguments, [factory.createIdentifier(valueName)]);

    return factory.updateArrowFunction(node, modifiers, typeParameters, parameters, type,
        getObject(node).equalsGreaterThanToken,
        factory.createBlock([stagedCallee, selectedValue, factory.createReturnStatement(nextCall)], true));
};

export { createRestArrayFixedSelection, createRestArrayStagedSelection };
