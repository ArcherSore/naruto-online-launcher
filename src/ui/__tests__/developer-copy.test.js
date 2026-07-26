'use strict';

const fs = require('fs');
const path = require('path');
const espree = require('espree');

const SRC_ROOT = path.resolve(__dirname, '..', '..');
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const PORTUGUESE_MARKERS =
  /\b(carregad[oa]s?|configuracoes|regiao|perfil|perfis|arquivo|falh(?:a|ou)?|invalido|padrao|primeir[oa]|jogo|janela|exibid[oa]|detectad[oa]|vinculad[oa]|diretorio|descartando|recuperando|importados?|ignorados?|limite|atingido|removidos?|lancou|nao|possivel|idioma|sistema|salv[oa]|fechad[oa]|abrindo|tela|corrompid[oa]|iniciando|vazio|seguro)\b/i;
const LEGACY_BRAND = /\bOasis\b|Shinobi Launcher/i;
const CJK = /[\u3400-\u9fff]/;

function listProductionJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).reduce((files, entry) => {
    if (entry.name === '__tests__') return files;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return files.concat(listProductionJs(fullPath));
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
    return files;
  }, []);
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  Object.keys(node).forEach(key => {
    const value = node[key];
    if (Array.isArray(value)) value.forEach(child => walk(child, visit));
    else if (value && typeof value.type === 'string') walk(value, visit);
  });
}

function staticFragments(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node.value];
  if (node.type === 'TemplateLiteral') {
    return node.quasis
      .map(part => part.value.cooked || '')
      .concat(
        node.expressions.reduce(
          (parts, expression) => parts.concat(staticFragments(expression)),
          []
        )
      );
  }
  if (node.type === 'BinaryExpression' || node.type === 'LogicalExpression') {
    return staticFragments(node.left).concat(staticFragments(node.right));
  }
  if (node.type === 'ConditionalExpression') {
    return staticFragments(node.consequent).concat(staticFragments(node.alternate));
  }
  return [];
}

function isLoggerCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'logger' &&
    node.callee.property &&
    LOG_LEVELS.has(node.callee.property.name)
  );
}

function isDeveloperDiagnosticCall(node) {
  return (
    node.type === 'CallExpression' &&
    node.callee &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'triggerStall'
  );
}

function propertyName(property) {
  if (!property || property.computed) return null;
  if (property.key.type === 'Identifier') return property.key.name;
  return property.key.value;
}

function collectDeveloperText() {
  const loggerCalls = [];
  const fragments = [];

  listProductionJs(SRC_ROOT).forEach(filePath => {
    const source = fs.readFileSync(filePath, 'utf8');
    const ast = espree.parse(source, {
      ecmaVersion: 2020,
      sourceType: 'script',
      loc: true
    });
    const relativePath = path.relative(SRC_ROOT, filePath).replace(/\\/g, '/');

    walk(ast, node => {
      let kind = null;
      let expression = null;

      if (isLoggerCall(node)) {
        kind = 'logger';
        expression = node.arguments[0];
        loggerCalls.push({ file: relativePath, line: node.loc.start.line });
      } else if (isDeveloperDiagnosticCall(node)) {
        kind = 'developer-diagnostic';
        expression = node.arguments[0];
      } else if (
        node.type === 'NewExpression' &&
        node.callee &&
        (node.callee.name === 'Error' || node.callee.name === 'TypeError')
      ) {
        kind = 'exception';
        expression = node.arguments[0];
      } else if (node.type === 'Property' && propertyName(node) === 'error') {
        kind = 'error-summary';
        expression = node.value;
      }

      if (!kind) return;
      staticFragments(expression).forEach(text => {
        fragments.push({
          kind,
          file: relativePath,
          line: node.loc.start.line,
          text
        });
      });
    });
  });

  return { loggerCalls, fragments };
}

const INVENTORY = collectDeveloperText();

describe('developer-owned production text contract', () => {
  test('keeps the logger call count stable', () => {
    expect(INVENTORY.loggerCalls).toHaveLength(145);
  });

  test('uses ASCII-only static fragments', () => {
    const violations = INVENTORY.fragments.filter(item =>
      Array.from(item.text).some(character => character.charCodeAt(0) > 127)
    );
    expect(violations).toEqual([]);
  });

  test('contains no Portuguese, Chinese, Oasis, or legacy launcher branding', () => {
    const violations = INVENTORY.fragments.filter(
      item =>
        PORTUGUESE_MARKERS.test(item.text) || CJK.test(item.text) || LEGACY_BRAND.test(item.text)
    );
    expect(violations).toEqual([]);
  });

  test('extracts only static text and leaves runtime values outside the language audit', () => {
    const ast = espree.parse("logger.info('Profile: opened name=' + profileName)", {
      ecmaVersion: 2020,
      sourceType: 'script'
    });
    const call = ast.body[0].expression;
    expect(staticFragments(call.arguments[0])).toEqual(['Profile: opened name=']);
  });
});
