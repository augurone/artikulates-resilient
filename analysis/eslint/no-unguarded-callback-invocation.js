import { createAnalysisListener } from './support/analysis.js';

export default {
    meta: {
        type: 'problem',
        docs: { description: 'Require callable guards at supported optional callback invocations',
            url: 'https://github.com/augurone/artikulates-resilient/blob/main/docs/rules/no-unguarded-callback-invocation.md' },
        schema: [],
        messages: { unguarded: 'Guard optional callback {{name}} with isFunction(...) or a typeof function check before invoking it.' }
    },
    create(context = {}) {
        return createAnalysisListener(context, (analysis, report) => {
            const { invocations = [] } = analysis;

            invocations.filter(({ optionalCallback = false, direct = false } = {}) => optionalCallback && direct)
                .forEach(({ index = -1, name = '', location = {} } = {}) => {
                    const { status = '' } = analysis.checkInvocation({ index });

                    if (status !== 'contradiction') return;

                    report({ location, messageId: 'unguarded', data: { name } });
                });
        });
    }
};
