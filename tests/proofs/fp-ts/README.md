# fp-ts proof target

Copy `tsconfig.resilient.json` and `resilient-proof.config.js` into the root of
an unchanged fp-ts checkout. The TypeScript config deliberately matches the
corpus Program's NodeNext/ESNext/skip-lib-check compiler context. Then run
`npm run lower:ts`: each source file is lowered, fixed while still staged, and
published to `.resilient` only after the complete target succeeds. Run
`resilient-prove --target resilient-proof.config.js --full` from that checkout
for the corpus proof.
