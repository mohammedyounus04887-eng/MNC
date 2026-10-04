import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Focused native-Node tests use the installed TypeScript compiler for transpiling.
// `npm run typecheck` remains the strict type gate. No OS identity mock or tsx
// patch is used; existing full regression commands remain unchanged.
const require = createRequire(import.meta.url);
const cache = new Map();
export function sourceUrl(source) {
  const file = typeof source === 'string' ? resolve(source) : fileURLToPath(source);
  if (cache.has(file)) return cache.get(file);
  let output = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const parsed = ts.createSourceFile(file + '.js', output, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const replacements = [];
  for (const statement of parsed.statements) {
    if ((!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier.startsWith('node:')) continue;
    let url;
    if (specifier.startsWith('.')) {
      const base = resolve(dirname(file), specifier);
      const target = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`].find((candidate) => extname(candidate) && existsSync(candidate));
      if (!target) throw new Error('Focused test dependency not found: ' + specifier);
      url = /\.tsx?$/.test(target) ? sourceUrl(target) : pathToFileURL(target).href;
    } else {
      if (specifier.startsWith('@/')) throw new Error('Explicit focused dependency required: ' + specifier);
      url = pathToFileURL(require.resolve(specifier)).href;
    }
    replacements.push({ start: statement.moduleSpecifier.getStart(parsed), end: statement.moduleSpecifier.end, value: JSON.stringify(url) });
  }
  for (const replacement of replacements.reverse()) output = output.slice(0, replacement.start) + replacement.value + output.slice(replacement.end);
  const url = 'data:text/javascript;base64,' + Buffer.from(output).toString('base64');
  cache.set(file, url);
  return url;
}
export const loadSource = (source) => import(sourceUrl(source));
