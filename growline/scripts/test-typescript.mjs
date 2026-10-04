import { register } from 'node:module';

// Use the installed TypeScript compiler with Node's normal asynchronous loader.
// No OS patches, dependency installations or changes to the strict tsc gate.
register('./test-typescript-hooks.mjs', import.meta.url);
