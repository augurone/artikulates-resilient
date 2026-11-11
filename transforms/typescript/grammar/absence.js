import { getObject } from '../../../analysis/host/object.js';
import { copyBindingAnnotations } from '../../utils/ast-boundary.js';
import { createAuthoredRuleScope } from '../policy/exceptions.js';

// Generated exact-absence defaults belong to their binding, never to an
// authored neighbor. Trivia can cover a declaration only after every explicit
// absence in that declaration is proved to be a generated default.
const annotateGeneratedAbsence = ({ typescript = {}, sourceFile = {}, context = {}, add } = {}) => {
    if (typeof add !== 'function') throw new TypeError('Expected the compiler exception annotator');

    const { factory = {}, SyntaxKind: { SingleLineCommentTrivia = -1 } = {} } = typescript;
    const authoredRules = createAuthoredRuleScope({ typescript, sourceFile, lineDirectives: true });
    const absenceRule = 'resilient/no-undefined-assignment';
    const wholeReason = 'Generated field extraction retains exact undefined and native extraction failures.';
    const fieldReason = 'Source field extraction retains exact undefined; a family fallback changes its value.';
    const ownsAbsenceDefault = (element) => {
        const { initializer = false } = getObject(element);

        if (!typescript.isBindingElement(element) || !initializer ||
            !typescript.isVoidExpression(initializer)) return false;

        const { expression = {} } = getObject(initializer);
        const { pos = -1 } = getObject(typescript.getOriginalNode(initializer));

        return pos < 0 && typescript.isNumericLiteral(expression) && getObject(expression).text === '0' && !authoredRules(element, [absenceRule]).has(absenceRule);
    };
    const finishBoundary = (node) => {
        const comments = typescript.getSyntheticTrailingComments(node) || [];
        const reason = ' Source absence boundary.';

        return comments.some(({ text = '' } = {}) => text === reason) ? node
            : typescript.addSyntheticTrailingComment(node, SingleLineCommentTrivia, reason, true);
    };
    const { text: authoredText = '' } = getObject(typescript.getOriginalNode(sourceFile));
    const completeAbsence = new WeakMap();
    const whollyGeneratedAbsence = (node) => {
        if (completeAbsence.has(node)) return completeAbsence.get(node);

        const { initializer = false } = getObject(node);
        const leaf = typescript.isVoidExpression(node) || typescript.isIdentifier(node) && getObject(node).text === 'undefined';
        const owned = ownsAbsenceDefault(node);
        const rejected = leaf || Boolean(typescript.forEachChild(node, child => child !== initializer || !owned ? !whollyGeneratedAbsence(child) : false));

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Private syntax facts share whole-unit absence checks without retaining a second source traversal.
        completeAbsence.set(node, !rejected);

        return !rejected;
    };
    const inlinePatterns = new WeakMap();
    const inlinePattern = (node) => {
        if (inlinePatterns.has(node)) return inlinePatterns.get(node);

        const { pos = -1 } = getObject(typescript.getOriginalNode(node));
        const comments = (typescript.getSyntheticLeadingComments(node) || []).length ||
            (typescript.getSyntheticTrailingComments(node) || []).length ||
            pos >= 0 && (typescript.getLeadingCommentRanges(authoredText, pos) || []).length;
        const separated = comments || Boolean(typescript.forEachChild(node, child => !inlinePattern(child)));

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Binding trivia is inspected once per syntax node; declaration RHS layout cannot split its preceding defaults.
        inlinePatterns.set(node, !separated);

        return !separated;
    };
    const coveredDefaults = new WeakSet();
    const annotateAbsenceDefaults = (node) => {
        const { declarationList = {} } = getObject(node);
        const { declarations = [] } = getObject(declarationList);
        const candidates = typescript.isVariableStatement(node) ? declarations.flatMap(({ name = {} } = {}) => getObject(name).elements || []) : [];
        const [{ name: pattern = {} } = {}] = declarations;
        const whole = declarations.length === 1 && candidates.some(ownsAbsenceDefault) && whollyGeneratedAbsence(node) && inlinePattern(pattern);

        // eslint-disable-next-line resilient/prefer-safe-transformations -- Only a declaration with no unrelated explicit absence owns its generated defaults' line exception.
        if (whole) candidates.filter(ownsAbsenceDefault).forEach(element => coveredDefaults.add(getObject(element).initializer));

        const visited = typescript.visitEachChild(node, annotateAbsenceDefaults, context);

        if (whole) return add(visited, absenceRule, wholeReason);

        if (!typescript.isObjectBindingPattern(visited) && !typescript.isArrayBindingPattern(visited)) return visited;

        const { elements = [] } = getObject(visited);
        const owned = elements.map(element => ownsAbsenceDefault(element) && !coveredDefaults.has(getObject(element).initializer));

        if (!owned.some(Boolean)) return visited;

        const placed = elements.map((element, index) => {
            if (!owned.at(index) && !(index > 0 && owned.at(index - 1)) && index !== elements.length - 1) return element;

            const changed = typescript.setStartsOnNewLine(copyBindingAnnotations(element, factory.cloneNode(element)), true);

            if (!owned.at(index)) return index === elements.length - 1 ? finishBoundary(changed) : changed;

            // Compiler binding updates retain absent tokens and source nodes; invented nodes change emitted syntax.
            const { initializer, dotDotDotToken, propertyName, name } = getObject(changed);

            const { pos = -1 } = getObject(typescript.getOriginalNode(element));
            const authoredComments = pos >= 0 && (typescript.getLeadingCommentRanges(authoredText, pos) || []).length;
            const syntheticComments = (typescript.getSyntheticLeadingComments(element) || []).some(({ text = '' } = {}) => text.trim() !== `eslint-disable-next-line ${absenceRule} -- ${fieldReason}`);

            if (typescript.isIdentifier(name) && !authoredComments && !syntheticComments) {
                const annotated = add(changed, absenceRule, fieldReason);

                return finishBoundary(annotated);
            }

            // Only the generated initializer owns this line. Nested authored
            // defaults precede it; later parameters follow its closing line.
            const fallback = finishBoundary(add(factory.cloneNode(initializer), absenceRule, fieldReason));

            return copyBindingAnnotations(element, factory.updateBindingElement(changed, dotDotDotToken, propertyName, name, fallback));
        });
        const list = factory.createNodeArray(placed, owned.at(-1) ? false : getObject(elements).hasTrailingComma);

        const updated = typescript.isObjectBindingPattern(visited)
            ? factory.updateObjectBindingPattern(visited, list) : factory.updateArrayBindingPattern(visited, list);

        return copyBindingAnnotations(visited, updated);
    };

    return typescript.visitNode(sourceFile, annotateAbsenceDefaults);
};

export { annotateGeneratedAbsence };
