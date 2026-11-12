import { CARINA_ONTOLOGY } from './compiledOntology';
import { SqlGuardResult } from './types';

const FORBIDDEN_KEYWORDS = new RegExp(
  '\\b(INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|ATTACH|DETACH|PRAGMA|VACUUM|REINDEX|TRIGGER|GRANT|REVOKE|SAVEPOINT|ROLLBACK|COMMIT|BEGIN)\\b',
  'i'
);

/**
 * Extracts a SQL query and optional metadata from LLM JSON or markdown output.
 */
export function extractSqlFromModelOutput(rawText: string): {
  sql?: string;
  title?: string;
  formulaUsed?: string;
} {
  if (!rawText || typeof rawText !== 'string') return {};
  const trimmed = rawText.trim();

  // 1. Try direct JSON or embedded JSON object
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed.sql === 'string') {
        return {
          sql: parsed.sql.trim(),
          title: typeof parsed.summaryTitle === 'string' ? parsed.summaryTitle.trim() : undefined,
          formulaUsed: typeof parsed.formulaUsed === 'string' ? parsed.formulaUsed.trim() : undefined
        };
      }
    } catch {
      // Fall through to SQL fence extraction
    }
  }

  // 2. Try fenced ```sql ... ```
  const sqlFence = trimmed.match(/```sql\s*([\s\S]*?)```/i);
  if (sqlFence && sqlFence[1]) {
    return { sql: sqlFence[1].trim() };
  }

  // 3. Raw SELECT/WITH statement
  if (/^\s*(SELECT|WITH)\b/i.test(trimmed)) {
    return { sql: trimmed };
  }

  return {};
}

/**
 * Extracts CTE alias names declared in WITH clauses so they are not flagged as unknown tables.
 */
function extractCteNames(sql: string): Set<string> {
  const cteNames = new Set<string>();
  const withMatch = sql.match(/^\s*WITH\s+([\s\S]+?)\bSELECT\b/i);
  if (!withMatch) return cteNames;
  const header = withMatch[1];
  const aliasMatches = header.matchAll(/(?:^|,)\s*([a-zA-Z_][a-zA-Z0-9_]*)\s+AS\s*\(/gi);
  for (const m of aliasMatches) {
    if (m[1]) cteNames.add(m[1].toLowerCase());
  }
  return cteNames;
}

/**
 * Extracts table identifiers after FROM or JOIN.
 */
function extractReferencedTables(sql: string): string[] {
  const tables: string[] = [];
  const regex = /\b(?:FROM|JOIN)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql)) !== null) {
    if (match[1]) {
      tables.push(match[1].toLowerCase());
    }
  }
  return Array.from(new Set(tables));
}

/**
 * Validates and hardens LLM-generated SQL before it is allowed to run against Cloudflare D1.
 */
export function validateReadOnlySql(rawSql: string): SqlGuardResult {
  if (!rawSql || typeof rawSql !== 'string') {
    return { valid: false, reason: 'Empty SQL statement.', referencedTables: [] };
  }

  // Strip a single trailing semicolon
  const sql = rawSql.trim().replace(/;\s*$/, '').trim();
  if (!sql) {
    return { valid: false, reason: 'Empty SQL statement.', referencedTables: [] };
  }

  // Block stacked statements & SQL comments
  if (sql.includes(';')) {
    return { valid: false, reason: 'Multiple SQL statements are prohibited.', referencedTables: [] };
  }
  if (sql.includes('--') || sql.includes('/*') || sql.includes('*/')) {
    return { valid: false, reason: 'SQL comments are prohibited.', referencedTables: [] };
  }

  // Read-only entry point check
  if (!/^(SELECT|WITH)\b/i.test(sql)) {
    return { valid: false, reason: 'Only SELECT (or WITH ... SELECT) queries are permitted.', referencedTables: [] };
  }

  // Reject any mutation / DDL / pragma keywords
  const forbiddenMatch = sql.match(FORBIDDEN_KEYWORDS);
  if (forbiddenMatch) {
    return {
      valid: false,
      reason: `Forbidden SQL keyword detected: ${forbiddenMatch[1].toUpperCase()}.`,
      referencedTables: []
    };
  }

  // Blocked sensitive/system tables check anywhere in statement
  const lowerSql = sql.toLowerCase();
  for (const blocked of CARINA_ONTOLOGY.governance.blockedTables) {
    const blockedRegex = new RegExp(`\\b${blocked.toLowerCase()}\\b`);
    if (blockedRegex.test(lowerSql)) {
      return {
        valid: false,
        reason: `Access to restricted table '${blocked}' is prohibited.`,
        referencedTables: []
      };
    }
  }

  const cteNames = extractCteNames(sql);
  const referencedTables = extractReferencedTables(sql);
  if (referencedTables.length === 0) {
    return { valid: false, reason: 'Query must reference at least one authorized table.', referencedTables: [] };
  }

  const allowedTables = new Set(CARINA_ONTOLOGY.tables.map(t => t.name.toLowerCase()));
  for (const tbl of referencedTables) {
    if (!allowedTables.has(tbl) && !cteNames.has(tbl)) {
      return {
        valid: false,
        reason: `Table '${tbl}' is not in CARINA's certified read-only ontology allowlist.`,
        referencedTables
      };
    }
  }

  // Enforce LIMIT <= maxQueryRows (default 25 if absent)
  const maxRows = CARINA_ONTOLOGY.governance.maxQueryRows || 50;
  let sanitizedSql = sql;
  const limitMatch = sanitizedSql.match(/\bLIMIT\s+(\d+)(\s+OFFSET\s+\d+)?\s*$/i);
  if (limitMatch) {
    const requestedLimit = parseInt(limitMatch[1], 10);
    const offsetPart = limitMatch[2] || '';
    if (requestedLimit > maxRows || requestedLimit <= 0) {
      sanitizedSql = sanitizedSql.replace(/\bLIMIT\s+\d+(\s+OFFSET\s+\d+)?\s*$/i, `LIMIT ${maxRows}${offsetPart}`);
    }
  } else if (!/\bLIMIT\s+\d+/i.test(sanitizedSql)) {
    sanitizedSql = `${sanitizedSql} LIMIT 25`;
  }

  return {
    valid: true,
    sanitizedSql,
    referencedTables
  };
}
