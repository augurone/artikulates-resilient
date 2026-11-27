import { put } from '../collections.js';
import { traverse } from '../traversal.js';

// Store one callable per template and creation frame. Frame lookups share
// their results across captures without copying ancestor bindings.
export const createEnvironments = (lexicalExecutions = new Set()) => {
    const closures = new WeakMap();
    const templates = new WeakMap();
    const ancestors = new WeakMap();
    const templateFor = model => templates.get(model) || model;
    const entriesFor = context => ancestors.get(context) || put(ancestors, context, new Map());
    const contextFor = (context, execution) => {
        if (!execution) return false;

        traverse(context, { enter: (current) => {
            const { model: { execution: owner = false } = {}, lexical = false } = current;

            return entriesFor(current).has(execution) || owner === execution || !lexical ? [] : [lexical];
        }, leave: (current) => {
            const entries = entriesFor(current);

            if (entries.has(execution)) return;

            const { model: { execution: owner = false } = {}, lexical = false } = current;

            put(entries, execution, owner === execution ? current : lexical && entriesFor(lexical).get(execution));
        } });

        return entriesFor(context).get(execution);
    };
    const close = (model, context) => {
        const { execution = false, parentExecution = false, lexical = false } = model;

        if (lexical || !lexicalExecutions.has(execution)) return model;

        const parent = contextFor(context, parentExecution);

        if (!parent) return model;

        const entries = closures.get(model) || put(closures, model, new WeakMap());

        if (entries.has(parent)) return entries.get(parent);

        const closed = Object.freeze({ ...model, lexical: parent });

        put(templates, closed, model);

        return put(entries, parent, closed);
    };

    return { close, contextFor, templateFor };
};
