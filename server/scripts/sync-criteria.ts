/**
 * Sync Criteria Script
 *
 * Utilities to sync criteria between JSON file and SQL Server.
 *
 * Usage:
 *   npx tsx server/scripts/sync-criteria.ts export   # Export SQL to JSON
 *   npx tsx server/scripts/sync-criteria.ts import   # Import JSON to SQL
 *   npx tsx server/scripts/sync-criteria.ts compare  # Compare both sources
 */

import fs from 'fs';
import path from 'path';
import { getPool, closePool, queryAll, query, type CriteriaRow, type PatternRow, type EmailPatternRow } from '../services/database.js';

const PROJECT_ROOT = path.resolve(process.cwd(), '..');
const UNIFIED_CRITERIA_FILE = path.join(PROJECT_ROOT, 'criteria_unified.json');

interface DomainRules {
  default?: 'delete' | 'delete_1d' | 'keep' | null;
  excludeSubjects?: string[];
  keep?: string[];
  delete?: string[];
  delete_1d?: string[];
  fromEmails?: { keep?: string[]; delete?: string[] };
  toEmails?: { keep?: string[]; delete?: string[] };
  subdomains?: { [key: string]: DomainRules };
}

interface UnifiedCriteria {
  [key: string]: DomainRules;
}

/**
 * Load criteria from JSON file.
 */
function loadFromJSON(): UnifiedCriteria {
  if (!fs.existsSync(UNIFIED_CRITERIA_FILE)) {
    console.error(`JSON file not found: ${UNIFIED_CRITERIA_FILE}`);
    return {};
  }
  const content = fs.readFileSync(UNIFIED_CRITERIA_FILE, 'utf-8');
  return JSON.parse(content) as UnifiedCriteria;
}

/**
 * Save criteria to JSON file.
 */
function saveToJSON(criteria: UnifiedCriteria): void {
  const sorted: UnifiedCriteria = {};
  for (const key of Object.keys(criteria).sort()) {
    sorted[key] = criteria[key];
  }
  fs.writeFileSync(UNIFIED_CRITERIA_FILE, JSON.stringify(sorted, null, 2), 'utf-8');
  console.log(`Saved to ${UNIFIED_CRITERIA_FILE}`);
}

/**
 * Load criteria from SQL Server.
 */
async function loadFromSQL(): Promise<UnifiedCriteria> {
  const criteria: UnifiedCriteria = {};

  const rows = await queryAll<CriteriaRow>(`
    SELECT id, key_value, key_type, default_action, parent_id
    FROM criteria
    ORDER BY key_type, key_value
  `);

  const patterns = await queryAll<PatternRow>(`
    SELECT criteria_id, action, pattern FROM patterns
  `);

  const emailPatterns = await queryAll<EmailPatternRow>(`
    SELECT criteria_id, direction, action, email FROM email_patterns
  `);

  // Create lookup maps
  const patternsByParent = new Map<number, PatternRow[]>();
  for (const p of patterns) {
    if (!patternsByParent.has(p.criteria_id)) {
      patternsByParent.set(p.criteria_id, []);
    }
    patternsByParent.get(p.criteria_id)!.push(p);
  }

  const emailPatternsByParent = new Map<number, EmailPatternRow[]>();
  for (const ep of emailPatterns) {
    if (!emailPatternsByParent.has(ep.criteria_id)) {
      emailPatternsByParent.set(ep.criteria_id, []);
    }
    emailPatternsByParent.get(ep.criteria_id)!.push(ep);
  }

  const rowById = new Map<number, CriteriaRow>();
  for (const row of rows) {
    rowById.set(row.id, row);
  }

  function buildRules(row: CriteriaRow): DomainRules {
    const rules: DomainRules = {};

    if (row.default_action) {
      rules.default = row.default_action;
    }

    const rowPatterns = patternsByParent.get(row.id) || [];
    for (const p of rowPatterns) {
      const key = p.action as 'keep' | 'delete' | 'delete_1d';
      if (!rules[key]) {
        rules[key] = [];
      }
      rules[key]!.push(p.pattern);
    }

    const rowEmailPatterns = emailPatternsByParent.get(row.id) || [];
    for (const ep of rowEmailPatterns) {
      const key = ep.direction === 'from' ? 'fromEmails' : 'toEmails';
      if (!rules[key]) {
        rules[key] = {};
      }
      const action = ep.action as 'keep' | 'delete';
      if (!rules[key]![action]) {
        rules[key]![action] = [];
      }
      rules[key]![action]!.push(ep.email);
    }

    return rules;
  }

  // First pass: domains and emails
  for (const row of rows) {
    if (row.key_type === 'domain' || row.key_type === 'email') {
      criteria[row.key_value] = buildRules(row);
    }
  }

  // Second pass: subdomains
  for (const row of rows) {
    if (row.key_type === 'subdomain' && row.parent_id) {
      const parent = rowById.get(row.parent_id);
      if (parent && criteria[parent.key_value]) {
        if (!criteria[parent.key_value].subdomains) {
          criteria[parent.key_value].subdomains = {};
        }
        criteria[parent.key_value].subdomains![row.key_value] = buildRules(row);
      }
    }
  }

  return criteria;
}

/**
 * Import criteria from JSON to SQL Server.
 */
async function importToSQL(criteria: UnifiedCriteria): Promise<void> {
  // Clear existing data
  await query('DELETE FROM email_patterns');
  await query('DELETE FROM patterns');
  await query('DELETE FROM criteria');
  console.log('Cleared existing SQL data');

  let criteriaCount = 0;
  let patternCount = 0;
  let emailPatternCount = 0;

  // Insert domains and emails first (top-level keys)
  const domainIds = new Map<string, number>();

  for (const [key, rules] of Object.entries(criteria)) {
    const keyType = key.includes('@') ? 'email' : 'domain';

    const result = await query<{ id: number }>(
      `INSERT INTO criteria (key_value, key_type, default_action)
       OUTPUT INSERTED.id
       VALUES (@key, @keyType, @defaultAction)`,
      { key, keyType, defaultAction: rules.default || null }
    );

    const id = result.recordset[0].id;
    domainIds.set(key, id);
    criteriaCount++;

    // Insert patterns
    for (const action of ['keep', 'delete', 'delete_1d'] as const) {
      if (rules[action]?.length) {
        for (const pattern of rules[action]!) {
          await query(
            `INSERT INTO patterns (criteria_id, action, pattern) VALUES (@id, @action, @pattern)`,
            { id, action, pattern }
          );
          patternCount++;
        }
      }
    }

    // Insert email patterns
    for (const direction of ['from', 'to'] as const) {
      const emailRules = direction === 'from' ? rules.fromEmails : rules.toEmails;
      if (emailRules) {
        for (const action of ['keep', 'delete'] as const) {
          if (emailRules[action]?.length) {
            for (const email of emailRules[action]!) {
              await query(
                `INSERT INTO email_patterns (criteria_id, direction, action, email)
                 VALUES (@id, @direction, @action, @email)`,
                { id, direction, action, email }
              );
              emailPatternCount++;
            }
          }
        }
      }
    }

    // Insert subdomains
    if (rules.subdomains) {
      for (const [subKey, subRules] of Object.entries(rules.subdomains)) {
        const subResult = await query<{ id: number }>(
          `INSERT INTO criteria (key_value, key_type, default_action, parent_id)
           OUTPUT INSERTED.id
           VALUES (@subKey, 'subdomain', @defaultAction, @parentId)`,
          { subKey, defaultAction: subRules.default || null, parentId: id }
        );

        const subId = subResult.recordset[0].id;
        criteriaCount++;

        // Insert subdomain patterns
        for (const action of ['keep', 'delete', 'delete_1d'] as const) {
          if (subRules[action]?.length) {
            for (const pattern of subRules[action]!) {
              await query(
                `INSERT INTO patterns (criteria_id, action, pattern) VALUES (@id, @action, @pattern)`,
                { id: subId, action, pattern }
              );
              patternCount++;
            }
          }
        }

        // Insert subdomain email patterns
        for (const direction of ['from', 'to'] as const) {
          const emailRules = direction === 'from' ? subRules.fromEmails : subRules.toEmails;
          if (emailRules) {
            for (const action of ['keep', 'delete'] as const) {
              if (emailRules[action]?.length) {
                for (const email of emailRules[action]!) {
                  await query(
                    `INSERT INTO email_patterns (criteria_id, direction, action, email)
                     VALUES (@id, @direction, @action, @email)`,
                    { id: subId, direction, action, email }
                  );
                  emailPatternCount++;
                }
              }
            }
          }
        }
      }
    }
  }

  console.log(`Imported: ${criteriaCount} criteria, ${patternCount} patterns, ${emailPatternCount} email patterns`);
}

/**
 * Compare JSON and SQL data.
 */
async function compare(): Promise<void> {
  const jsonData = loadFromJSON();
  const sqlData = await loadFromSQL();

  const jsonKeys = new Set(Object.keys(jsonData));
  const sqlKeys = new Set(Object.keys(sqlData));

  const onlyInJSON = [...jsonKeys].filter(k => !sqlKeys.has(k));
  const onlyInSQL = [...sqlKeys].filter(k => !jsonKeys.has(k));
  const inBoth = [...jsonKeys].filter(k => sqlKeys.has(k));

  console.log('\n=== Comparison ===');
  console.log(`JSON entries: ${jsonKeys.size}`);
  console.log(`SQL entries: ${sqlKeys.size}`);
  console.log(`Common entries: ${inBoth.length}`);

  if (onlyInJSON.length > 0) {
    console.log(`\nOnly in JSON (${onlyInJSON.length}):`);
    onlyInJSON.slice(0, 10).forEach(k => console.log(`  - ${k}`));
    if (onlyInJSON.length > 10) console.log(`  ... and ${onlyInJSON.length - 10} more`);
  }

  if (onlyInSQL.length > 0) {
    console.log(`\nOnly in SQL (${onlyInSQL.length}):`);
    onlyInSQL.slice(0, 10).forEach(k => console.log(`  - ${k}`));
    if (onlyInSQL.length > 10) console.log(`  ... and ${onlyInSQL.length - 10} more`);
  }

  // Check for differences in common entries
  let differences = 0;
  for (const key of inBoth) {
    const jsonRules = jsonData[key];
    const sqlRules = sqlData[key];

    if (JSON.stringify(jsonRules) !== JSON.stringify(sqlRules)) {
      differences++;
      if (differences <= 5) {
        console.log(`\nDifference in ${key}:`);
        console.log(`  JSON: ${JSON.stringify(jsonRules)}`);
        console.log(`  SQL:  ${JSON.stringify(sqlRules)}`);
      }
    }
  }

  if (differences > 5) {
    console.log(`\n... and ${differences - 5} more differences`);
  }

  if (differences === 0 && onlyInJSON.length === 0 && onlyInSQL.length === 0) {
    console.log('\n✓ JSON and SQL are in sync!');
  }
}

// Main
const command = process.argv[2];

async function main() {
  try {
    await getPool();

    switch (command) {
      case 'export':
        console.log('Exporting SQL to JSON...');
        const sqlData = await loadFromSQL();
        saveToJSON(sqlData);
        break;

      case 'import':
        console.log('Importing JSON to SQL...');
        const jsonData = loadFromJSON();
        await importToSQL(jsonData);
        break;

      case 'compare':
        await compare();
        break;

      default:
        console.log('Usage:');
        console.log('  npx tsx server/scripts/sync-criteria.ts export   # Export SQL to JSON');
        console.log('  npx tsx server/scripts/sync-criteria.ts import   # Import JSON to SQL');
        console.log('  npx tsx server/scripts/sync-criteria.ts compare  # Compare both sources');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
