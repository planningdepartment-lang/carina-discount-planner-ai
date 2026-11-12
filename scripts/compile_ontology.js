const fs = require('fs');
const path = require('path');

/**
 * Lightweight, strict YAML subset parser for Apache Ossie-compatible ontology files.
 * Supports mappings, scalar values (string/number/boolean), string lists, and object lists.
 */
function parseScalar(raw) {
  const s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s !== '' && !Number.isNaN(Number(s)) && /^-?\d+(?:\.\d+)?$/.test(s)) {
    return Number(s);
  }
  return s;
}

function stripComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseSimpleYaml(yamlText) {
  const rawLines = yamlText.split(/\r?\n/);
  const lines = [];
  for (const raw of rawLines) {
    const cleaned = stripComment(raw).replace(/\s+$/, '');
    if (!cleaned.trim()) continue;
    const indent = cleaned.length - cleaned.trimStart().length;
    lines.push({ indent, text: cleaned.trim() });
  }

  let idx = 0;

  function parseBlock(minIndent) {
    if (idx >= lines.length) return {};
    const first = lines[idx];
    if (first.text.startsWith('- ')) {
      return parseArray(first.indent);
    }
    return parseObject(minIndent);
  }

  function parseArray(arrIndent) {
    const arr = [];
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < arrIndent || !line.text.startsWith('- ')) break;
      if (line.indent > arrIndent) break;

      const afterDash = line.text.slice(2).trim();
      const colonPos = findUnquotedColon(afterDash);

      if (colonPos !== -1) {
        // Object item starting on the same line as `- key: val`
        const obj = {};
        const key = afterDash.slice(0, colonPos).trim();
        const valPart = afterDash.slice(colonPos + 1).trim();
        idx++;

        if (valPart === '') {
          if (idx < lines.length && lines[idx].indent > arrIndent) {
            obj[key] = parseBlock(lines[idx].indent);
          } else {
            obj[key] = {};
          }
        } else {
          obj[key] = parseScalar(valPart);
        }

        // Remaining keys of this object at indent > arrIndent
        while (idx < lines.length && lines[idx].indent > arrIndent && !lines[idx].text.startsWith('- ')) {
          const propLine = lines[idx];
          const propColon = findUnquotedColon(propLine.text);
          if (propColon === -1) break;
          const pKey = propLine.text.slice(0, propColon).trim();
          const pVal = propLine.text.slice(propColon + 1).trim();
          idx++;
          if (pVal === '') {
            if (idx < lines.length && lines[idx].indent > propLine.indent) {
              obj[pKey] = parseBlock(lines[idx].indent);
            } else {
              obj[pKey] = [];
            }
          } else {
            obj[pKey] = parseScalar(pVal);
          }
        }

        arr.push(obj);
      } else {
        idx++;
        arr.push(parseScalar(afterDash));
      }
    }
    return arr;
  }

  function parseObject(objIndent) {
    const obj = {};
    while (idx < lines.length) {
      const line = lines[idx];
      if (line.indent < objIndent) break;
      if (line.text.startsWith('- ')) break;

      const colonPos = findUnquotedColon(line.text);
      if (colonPos === -1) {
        throw new Error(`Invalid YAML line: ${line.text}`);
      }
      const key = line.text.slice(0, colonPos).trim();
      const valPart = line.text.slice(colonPos + 1).trim();
      idx++;

      if (valPart === '') {
        if (idx < lines.length && lines[idx].indent > line.indent) {
          obj[key] = parseBlock(lines[idx].indent);
        } else {
          obj[key] = {};
        }
      } else {
        obj[key] = parseScalar(valPart);
      }
    }
    return obj;
  }

  function findUnquotedColon(str) {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (ch === "'" && !inDouble) inSingle = !inSingle;
      else if (ch === '"' && !inSingle) inDouble = !inDouble;
      else if (ch === ':' && !inSingle && !inDouble && (i === str.length - 1 || str[i + 1] === ' ')) {
        return i;
      }
    }
    return -1;
  }

  return parseObject(0);
}

function compileOntology(
  yamlPath = path.join(__dirname, '../ontology/carina_ossie_seed.yaml'),
  outPath = path.join(__dirname, '../src/ai/ontology/compiledOntology.ts')
) {
  const yamlText = fs.readFileSync(yamlPath, 'utf8');
  const parsed = parseSimpleYaml(yamlText);

  if (!parsed.version || !Array.isArray(parsed.tables) || !Array.isArray(parsed.terms)) {
    throw new Error('Ontology seed missing required top-level fields: version, tables, terms');
  }

  const tsContent =
    `/* AUTO-GENERATED by scripts/compile_ontology.js from ontology/carina_ossie_seed.yaml — DO NOT EDIT MANUALLY */\n` +
    `import { OntologyModel } from './types';\n\n` +
    `export const CARINA_ONTOLOGY: OntologyModel = ${JSON.stringify(parsed, null, 2)};\n`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, tsContent, 'utf8');
  return parsed;
}

if (require.main === module) {
  const model = compileOntology();
  console.log(
    `Compiled CARINA ontology v${model.version}: ${model.tables.length} tables, ${model.terms.length} terms, ${(model.sqlAttributes || []).length} SQL attributes.`
  );
}

module.exports = { parseSimpleYaml, compileOntology };
