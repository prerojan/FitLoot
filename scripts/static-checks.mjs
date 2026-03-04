#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const errors = [];
const warnings = [];

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const IMPORT_RE = /(?:import\s+(?:type\s+)?(?:[\s\w{},*]+\s+from\s+)?|export\s+(?:type\s+)?(?:[\s\w{},*]+\s+from\s+)|import\s*\()\s*['"]([^'"\n]+)['"]/g;

function exists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    errors.push(`[JSON] package.json inválido: ${err.message}`);
    return null;
  }
}

function assertPathExists(relativePath) {
  const fullPath = path.join(ROOT, relativePath);
  if (!exists(fullPath)) {
    errors.push(`[PATH] Caminho obrigatório não existe: ${relativePath}`);
  }
}

function collectFiles(startDir, bucket = []) {
  if (!exists(startDir) || !isDirectory(startDir)) return bucket;
  for (const entry of fs.readdirSync(startDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
    const full = path.join(startDir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, bucket);
      continue;
    }
    if (TEXT_EXTENSIONS.has(path.extname(entry.name))) bucket.push(full);
  }
  return bucket;
}

function resolveRelativeImport(fromFile, specifier) {
  const fromDir = path.dirname(fromFile);
  const base = path.resolve(fromDir, specifier);
  const candidates = [base];

  for (const ext of TEXT_EXTENSIONS) candidates.push(`${base}${ext}`);
  for (const ext of TEXT_EXTENSIONS) candidates.push(path.join(base, `index${ext}`));

  for (const c of candidates) {
    if (exists(c) && !isDirectory(c)) return c;
  }
  return null;
}

function stripNonCode(source) {
  let out = '';
  let i = 0;
  let state = 'code';

  while (i < source.length) {
    const c = source[i];
    const n = source[i + 1] || '';
    const p = source[i - 1] || '';

    if (state === 'code') {
      if (c === '/' && n === '/') {
        state = 'line-comment';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && n === '*') {
        state = 'block-comment';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'") {
        state = 'single';
        out += ' ';
        i++;
        continue;
      }
      if (c === '"') {
        state = 'double';
        out += ' ';
        i++;
        continue;
      }
      if (c === '`') {
        state = 'template';
        out += ' ';
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    if (state === 'line-comment') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      } else {
        out += ' ';
      }
      i++;
      continue;
    }

    if (state === 'block-comment') {
      if (p === '*' && c === '/') state = 'code';
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (state === 'single') {
      if (c === "'" && p !== '\\') state = 'code';
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (state === 'double') {
      if (c === '"' && p !== '\\') state = 'code';
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }

    if (state === 'template') {
      if (c === '`' && p !== '\\') state = 'code';
      out += c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
  }

  return out;
}

function checkImportTargets(filePath, raw) {
  IMPORT_RE.lastIndex = 0;
  let match;
  while ((match = IMPORT_RE.exec(raw)) !== null) {
    const specifier = match[1];
    if (!specifier.startsWith('.')) continue;

    const resolved = resolveRelativeImport(filePath, specifier);
    if (!resolved) {
      const rel = path.relative(ROOT, filePath);
      errors.push(`[IMPORT] Import relativo quebrado em ${rel}: "${specifier}"`);
    }
  }
}

function checkBracketBalance(filePath, raw) {
  const rel = path.relative(ROOT, filePath);
  const ext = path.extname(filePath);
  if (ext === '.mjs') return;
  const code = stripNonCode(raw);
  const stack = [];
  const expectedClose = { '{': '}', '[': ']', '(': ')' };
  const isOpen = (c) => c === '{' || c === '[' || c === '(';
  const isClose = (c) => c === '}' || c === ']' || c === ')';

  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (isOpen(c)) {
      stack.push(c);
      continue;
    }
    if (isClose(c)) {
      const top = stack.pop();
      if (!top) {
        errors.push(`[SYNTAX] Fechamento "${c}" sem abertura em ${rel}`);
        continue;
      }
      if (expectedClose[top] !== c) {
        errors.push(`[SYNTAX] Delimitador incorreto em ${rel}: esperado "${expectedClose[top]}", encontrado "${c}"`);
      }
    }
  }

  for (const op of stack) {
    errors.push(`[SYNTAX] Delimitador aberto sem fechamento em ${rel}: "${op}"`);
  }
}

function checkTryCatch(filePath, raw) {
  const rel = path.relative(ROOT, filePath);
  const code = stripNonCode(raw);
  const tryCount = (code.match(/\btry\b/g) || []).length;
  const handlerCount = (code.match(/\b(catch|finally)\b/g) || []).length;
  if (tryCount > handlerCount) {
    errors.push(`[CONTROL] Possível bloco try sem catch/finally em ${rel} (try=${tryCount}, handlers=${handlerCount})`);
  }
}

function checkAnyUsage(filePath, raw) {
  const rel = path.relative(ROOT, filePath);
  const ext = path.extname(filePath);
  if (ext !== '.ts' && ext !== '.tsx') return;
  const anyMatches = raw.match(/\bany\b/g) || [];
  if (anyMatches.length > 0) warnings.push(`[TYPE] Uso de 'any' em ${rel} (${anyMatches.length} ocorrência(s)).`);
}

function run() {
  console.log('[static-checks] Iniciando validações estáticas sem dependências...');

  readJson(path.join(ROOT, 'package.json'));
  assertPathExists('src');
  assertPathExists('scripts');
  assertPathExists('scripts/setup-test-env.sh');

  const files = [];
  for (const root of ['src', 'scripts']) collectFiles(path.join(ROOT, root), files);

  if (files.length === 0) warnings.push('[SCAN] Nenhum arquivo de código encontrado para análise.');

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    checkBracketBalance(file, raw);
    checkTryCatch(file, raw);
    checkImportTargets(file, raw);
    checkAnyUsage(file, raw);
  }

  for (const w of warnings) console.warn(w);

  if (errors.length > 0) {
    console.error('\n[static-checks] Foram encontrados problemas:');
    for (const err of errors) console.error(`- ${err}`);
    process.exit(1);
  }

  console.log(`[static-checks] OK: ${files.length} arquivo(s) verificado(s), sem erros estruturais detectados.`);
}

run();
