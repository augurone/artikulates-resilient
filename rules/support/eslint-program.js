import { ESLint } from 'eslint';

const createProgramCapture = ({ languageOptions = {} } = {}) => {
    let program = {};
    const capture = {
        rules: {
            program: {
                create: () => ({
                    Program: (node) => {
                        program = node;
                    }
                })
            }
        }
    };
    const eslint = new ESLint({
        overrideConfigFile: true,
        overrideConfig: [{
            languageOptions,
            plugins: { capture },
            rules: { 'capture/program': 'error' }
        }]
    });

    let active = false;

    return async (code, { fileName = '' } = {}) => {
        if (active) throw new Error('A parser session requires sequential calls; use separate sessions for concurrent inputs.');

        active = true;
        program = {};
        try {
            await eslint.lintText(code, { filePath: fileName });

            return program;
        } finally {
            active = false;
        }
    };
};

const captureProgram = async (code, { fileName = '', languageOptions = {} } = {}) => createProgramCapture({ languageOptions })(code, { fileName });

export { captureProgram, createProgramCapture };
