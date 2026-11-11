import typescript from 'typescript';

// Syntax assertions ignore boundary-comment layout; raw and fixed lint tests
// separately check the comments' exact effective scopes.
export const emissionSyntax = (code = '') => typescript.createPrinter({ removeComments: true }).printFile(
    typescript.createSourceFile('emitted.js', code, typescript.ScriptTarget.ESNext, true, typescript.ScriptKind.JS)
);
