import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '../src');
const tokensFile = path.resolve(srcDir, 'styles/tokens.css');

if (!fs.existsSync(tokensFile)) {
  console.error(`Error: Tokens file not found at ${tokensFile}`);
  process.exit(1);
}

const tokensContent = fs.readFileSync(tokensFile, 'utf8');

// Parse defined variables in :root and [data-theme="dark"]
function extractVarsFromBlock(css, selectorRegex) {
  const match = css.match(selectorRegex);
  if (!match) return new Set();
  const block = match[1];
  const varMatches = block.matchAll(/--([a-zA-Z0-9_-]+)\s*:/g);
  const vars = new Set();
  for (const m of varMatches) {
    vars.add(`--${m[1]}`);
  }
  return vars;
}

const rootVars = extractVarsFromBlock(tokensContent, /:root\s*\{([^}]+)\}/);
const darkVars = extractVarsFromBlock(tokensContent, /\[data-theme=["']dark["']\]\s*\{([^}]+)\}/);

let hasError = false;

// Check symmetry between light and dark definitions
for (const v of rootVars) {
  if (!darkVars.has(v)) {
    console.error(`Token Error: Variable ${v} is defined in :root but missing in [data-theme="dark"]`);
    hasError = true;
  }
}
for (const v of darkVars) {
  if (!rootVars.has(v)) {
    console.error(`Token Error: Variable ${v} is defined in [data-theme="dark"] but missing in :root`);
    hasError = true;
  }
}

// Recursively find all files in src
function getAllFiles(dir, exts = ['.tsx', '.ts', '.css', '.html']) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const fullPath = path.resolve(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(fullPath, exts));
    } else {
      if (exts.some((ext) => file.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  }
  return results;
}

const allFiles = getAllFiles(srcDir);
const usedVars = new Map(); // varName -> Set of files

for (const file of allFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const matches = content.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g);
  for (const m of matches) {
    const varName = m[1];
    if (!usedVars.has(varName)) {
      usedVars.set(varName, new Set());
    }
    usedVars.get(varName).add(path.relative(srcDir, file));
  }
}

// Check every used variable is defined
for (const [v, files] of usedVars.entries()) {
  if (!rootVars.has(v)) {
    console.error(`Token Error: CSS variable "${v}" is used but NOT defined in styles/tokens.css!`);
    console.error(`  Used in: ${Array.from(files).join(', ')}`);
    hasError = true;
  }
}

if (hasError) {
  console.error('\n❌ Token check FAILED. All CSS variables must be declared in styles/tokens.css for both light & dark themes.');
  process.exit(1);
} else {
  console.log(`✓ All ${usedVars.size} CSS variables used in codebase are strictly defined in tokens.css for both light and dark themes!`);
  console.log(`✓ Verified ${rootVars.size} tokens in :root and ${darkVars.size} tokens in [data-theme="dark"].`);
}
