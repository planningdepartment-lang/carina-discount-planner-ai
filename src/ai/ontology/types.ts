export interface OntologyStoreSpec {
  code: string;
  name: string;
  city: string;
  areaM2: number;
  stockColumn: string;
}

export interface UnguidedMetricRule {
  id: string;
  pattern: string;
  label: string;
}

export interface OntologyTableSpec {
  name: string;
  access: string;
  description: string;
  primaryKey: string;
  columns: string[];
}

export interface OntologyTerm {
  id: string;
  name: string;
  synonyms: string[];
  definition: string;
  table: string;
  columns: string[];
  sqlExpression: string;
  unit: string;
  governanceNote: string;
}

export interface OntologySqlAttribute {
  id: string;
  description: string;
  sql: string;
}

export interface OntologyModel {
  version: string;
  name: string;
  dialect: string;
  description: string;
  governance: {
    excludedLocations: string[];
    blockedTables: string[];
    maxQueryRows: number;
    vatRate: number;
    stores: OntologyStoreSpec[];
  };
  unguidedMetrics: UnguidedMetricRule[];
  tables: OntologyTableSpec[];
  terms: OntologyTerm[];
  sqlAttributes: OntologySqlAttribute[];
}

export interface AnswerabilityResult {
  answerable: boolean;
  reason?: string;
  blockedMetricLabels: string[];
  matchedTermIds: string[];
  exploratoryMode: boolean;
}

export interface RetrievedOntologyContext {
  matchedTerms: OntologyTerm[];
  matchedSqlAttributes: OntologySqlAttribute[];
  relevantTables: OntologyTableSpec[];
  promptBlock: string;
}

export interface SqlGuardResult {
  valid: boolean;
  sanitizedSql?: string;
  reason?: string;
  referencedTables: string[];
}
