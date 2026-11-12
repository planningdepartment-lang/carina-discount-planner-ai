import { CARINA_ONTOLOGY } from './compiledOntology';
import {
  AnswerabilityResult,
  OntologySqlAttribute,
  OntologyTableSpec,
  OntologyTerm,
  RetrievedOntologyContext
} from './types';

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQueryTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s%/-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2);
}

/**
 * Mirrors Auto-Ontology's check_answerable gate:
 * Blocks unguided external metrics in Strict SSOT mode and identifies matched certified terms.
 */
export function checkAnswerable(
  userQuery: string,
  allowUnguidedMetrics: boolean = false
): AnswerabilityResult {
  const lower = userQuery.toLowerCase();
  const blockedMetricLabels: string[] = [];

  for (const rule of CARINA_ONTOLOGY.unguidedMetrics) {
    const regex = new RegExp(`\\b(${rule.pattern})\\b`, 'i');
    if (regex.test(lower)) {
      blockedMetricLabels.push(rule.label);
    }
  }

  const context = retrieveOntologyContext(userQuery, 6);
  const matchedTermIds = context.matchedTerms.map(t => t.id);

  if (blockedMetricLabels.length > 0 && !allowUnguidedMetrics) {
    return {
      answerable: false,
      reason: `Requested metric(s) [${blockedMetricLabels.join(', ')}] fall outside CARINA's certified SSOT retail ontology.`,
      blockedMetricLabels,
      matchedTermIds,
      exploratoryMode: false
    };
  }

  return {
    answerable: true,
    blockedMetricLabels,
    matchedTermIds,
    exploratoryMode: allowUnguidedMetrics
  };
}

/**
 * Retrieves only the certified ontology terms, SQL attributes, and table schemas
 * relevant to the user's question to maximize LLM SQL accuracy and minimize prompt bloat.
 */
export function retrieveOntologyContext(
  userQuery: string,
  maxTerms: number = 6
): RetrievedOntologyContext {
  const lower = userQuery.toLowerCase();
  const queryTokens = new Set(normalizeQueryTokens(userQuery));

  const scoredTerms = CARINA_ONTOLOGY.terms
    .map(term => {
      let score = 0;
      const termNameLower = term.name.toLowerCase();
      if (lower.includes(termNameLower)) score += 10;

      for (const syn of term.synonyms) {
        const synLower = syn.toLowerCase();
        const synBoundary = new RegExp(`\\b${escapeRegex(synLower)}\\b`, 'i');
        if (synBoundary.test(lower)) {
          score += synLower.includes(' ') ? 8 : 5;
        } else if (synLower.length >= 4 && lower.includes(synLower)) {
          score += 3;
        }
      }

      for (const col of term.columns) {
        if (lower.includes(col.toLowerCase())) score += 6;
      }

      const defTokens = normalizeQueryTokens(term.definition);
      for (const dt of defTokens) {
        if (dt.length >= 4 && queryTokens.has(dt)) {
          score += 1;
        }
      }

      return { term, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const matchedTerms: OntologyTerm[] = scoredTerms.slice(0, maxTerms).map(s => s.term);

  // Fallback core merchandising terms if query is broad analytical
  if (matchedTerms.length === 0) {
    const coreIds = new Set(['physical_stock', 'store_floor_wos', 'saudi_vat_floor', 'lifecycle_offer_tier']);
    matchedTerms.push(...CARINA_ONTOLOGY.terms.filter(t => coreIds.has(t.id)));
  }

  const matchedSqlAttributes: OntologySqlAttribute[] = CARINA_ONTOLOGY.sqlAttributes.filter(attr => {
    const attrTokens = normalizeQueryTokens(`${attr.id.replace(/_/g, ' ')} ${attr.description}`);
    let hits = 0;
    for (const tok of attrTokens) {
      if (tok.length >= 4 && queryTokens.has(tok)) hits++;
    }
    return hits >= 2;
  });

  const tableNamesNeeded = new Set<string>(['style_plan_snapshots']);
  for (const t of matchedTerms) {
    tableNamesNeeded.add(t.table);
  }
  if (/\b(rule|rules|policy|policies|cap|exclusion)\b/i.test(lower)) {
    tableNamesNeeded.add('business_rules');
  }
  if (/\b(monitoring|post-promo|post promo|lift|stall|sellout)\b/i.test(lower)) {
    tableNamesNeeded.add('post_promo_monitoring');
  }
  if (/\b(campaign mode|active mode|system setting)\b/i.test(lower)) {
    tableNamesNeeded.add('system_settings');
  }

  const relevantTables: OntologyTableSpec[] = CARINA_ONTOLOGY.tables.filter(tbl =>
    tableNamesNeeded.has(tbl.name)
  );

  const lines: string[] = [
    `[CARINA Certified Semantic Ontology v${CARINA_ONTOLOGY.version} — Dialect: SQLite/D1]`,
    `Governance Constraints: Exclude Shofy/Stock & WH-D/Stock; Saudi 15% VAT floor = ROUND(unit_cost * 1.15, 2); Store Areas: Al-Andalus=260m², Al-Yasmeen=193m², Jouri=168m².`,
    '',
    'Authorized Tables & Columns:'
  ];

  for (const tbl of relevantTables) {
    lines.push(`- ${tbl.name} (PK: ${tbl.primaryKey}): ${tbl.columns.join(', ')}`);
    if (tbl.name === 'style_plan_snapshots') {
      lines.push(
        `  Note on category values: Live categories use singular/specific labels (Set, Socks, Top, Bra, Pant, Towel, Night Gown, Panty, Cosmetics, Dress, Robe, Brief 5PCS, Bikini 5PCS). Map 'pyjamas/sleepwear' to (LOWER(category) IN ('set', 'night gown') OR LOWER(product_name) LIKE '%pyjama%' OR LOWER(product_name) LIKE '%pj%').`
      );
    }
  }

  lines.push('', 'Certified Business Terms & Formulas:');
  for (const t of matchedTerms) {
    lines.push(
      `- ${t.name} [${t.id}]: ${t.definition} | Table: ${t.table} | SQL: ${t.sqlExpression} (${t.unit})`
    );
  }

  if (matchedSqlAttributes.length > 0) {
    lines.push('', 'Certified Reference SQL Patterns:');
    for (const a of matchedSqlAttributes) {
      lines.push(`- ${a.id}: ${a.description} => ${a.sql}`);
    }
  }

  return {
    matchedTerms,
    matchedSqlAttributes,
    relevantTables,
    promptBlock: lines.join('\n')
  };
}

/**
 * Determines if a user query (with no single-style match) is an ad-hoc analytical/slicing/ranking
 * data question suitable for Ontology-Grounded Text-to-SQL.
 */
export function isAnalyticalDataQuery(userQuery: string): boolean {
  const q = userQuery.trim().toLowerCase();
  if (q.length < 8) return false;

  // Never treat a singular follow-up about a focused item ("this item", "for it", "instead of 0%")
  // as a multi-style catalog SQL query unless the user explicitly asks across all styles/categories.
  const hasSingularDeictic = /\b(this item|this style|this product|that item|that style|for this|for it|on it|instead of)\b/i.test(q);
  const hasExplicitPluralCatalogScope = /\b(all styles|all items|all products|entire catalog|by category|across stores|top \d+|which styles|which items)\b/i.test(q);
  if (hasSingularDeictic && !hasExplicitPluralCatalogScope) {
    return false;
  }

  const hasAnalyticalVerbOrQuantifier =
    /\b(which|what|list|show|top|bottom|highest|lowest|most|least|how many|count|total|sum|average|avg|compare|comparison|breakdown|group by|filter|find|rank|sort|over|above|under|below|greater|less|between|zero|without|with)\b/i.test(
      q
    );

  const hasOntologyDomainNoun =
    /\b(styles?|skus?|products?|items?|stock|units?|inventory|andalus|yasmeen|jouri|taif|jeddah|warehouse|wh|wos|ros|str|runway|velocity|momentum|capital|cost|cogs|margin|profit|price|ticket|discount|offer|tier|curve|broken|healthy|single size|category|categories|season|aw25|aw26|ss26|pyjamas?|bras?|panties|socks?|cosmetics?|rules?|policies|monitoring|lift|stall|density|u\/m2)\b/i.test(
      q
    );

  // Exclude purely conceptual/how-to questions ("what is wos", "explain zero loss floor")
  const isPureDefinitionQuestion =
    /^(what is|what does|explain|define|how is|how do you calculate|why do we)\s+(the\s+)?(wos|ros|str|imu|vat|zero[- ]loss|sar|curve|payday|bnpl|bundle)\b/i.test(
      q
    );

  return hasAnalyticalVerbOrQuantifier && hasOntologyDomainNoun && !isPureDefinitionQuestion;
}
