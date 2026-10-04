import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve as resolvePath, dirname, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

// Native Node 22.15+ test loader using the already installed compiler. It does
// not replace authentication, mock OS calls, install packages or change tsc.
// Original source URLs are preserved for import.meta.url and test fixtures.
const root = fileURLToPath(new URL('../', import.meta.url));
const config = ts.readConfigFile(resolvePath(root, 'tsconfig.json'), ts.sys.readFile);
if (config.error) throw new Error('Test TypeScript configuration unavailable');
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, root).options;
const require = createRequire(import.meta.url);
export async function resolve(specifier, context, nextResolve) {
    const source = specifier.startsWith('@/') ? resolvePath(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') && context.parentURL?.startsWith('file:') ? resolvePath(dirname(fileURLToPath(context.parentURL)), specifier) : null;
    if (source) {
      const found = [source, `${source}.ts`, `${source}.tsx`, `${source}.js`, resolvePath(source, 'index.ts'), resolvePath(source, 'index.tsx')]
        .find((file) => existsSync(file) && statSync(file).isFile());
      if (found) return nextResolve(pathToFileURL(found).href, context);
    }
    try { return await nextResolve(specifier, context); }
    catch (error) {
      // Next publishes extensionless CommonJS subpaths. Resolve its actual
      // package files without replacing or mocking the implementation.
      if (specifier.startsWith('next/') && error.code === 'ERR_MODULE_NOT_FOUND') return nextResolve(pathToFileURL(require.resolve(specifier)).href, context);
      throw error;
    }
}
export async function load(url, context, nextLoad) {
    if (url.startsWith('file:') && /\.tsx?$/.test(extname(fileURLToPath(url)))) {
      const file = fileURLToPath(url);
      const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
        fileName: file, reportDiagnostics: true,
        compilerOptions: { ...options, module: ts.ModuleKind.ESNext, noEmit: false, jsx: ts.JsxEmit.ReactJSX },
      });
      if (compiled.diagnostics?.some((item) => item.category === ts.DiagnosticCategory.Error)) throw new Error('Test TypeScript syntax invalid: ' + file);
      return { format: 'module', source: compiled.outputText, shortCircuit: true };
    }
    return nextLoad(url, context);
}
