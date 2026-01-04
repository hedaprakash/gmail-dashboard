/**
 * Migration script: JSON to SQL Server
 *
 * Migrates criteria_unified.json to SQL Server database
 */

const fs = require('fs');
const { execSync } = require('child_process');

const JSON_FILE = '../../criteria_unified.json';
const SA_PASSWORD = 'MyPass@word123';

function runSQL(sql) {
  // Escape single quotes for SQL
  const escapedSQL = sql.replace(/'/g, "''");
  const cmd = `docker exec gmail-sqlserver /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "${SA_PASSWORD}" -C -d GmailCriteria -Q "${escapedSQL}"`;

  try {
    const result = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
    return { success: true, result };
  } catch (e) {
    return { success: false, error: e.stderr || e.message };
  }
}

function escapeSQL(str) {
  return str.replace(/'/g, "''");
}

async function migrate() {
  console.log('Loading JSON file...');
  const data = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));

  const stats = {
    domains: 0,
    subdomains: 0,
    patterns: 0,
    errors: []
  };

  // Step 1: Insert all primary domains and email addresses
  console.log('\nStep 1: Inserting primary domains and email addresses...');
  for (const [key, rules] of Object.entries(data)) {
    const isEmail = key.includes('@');
    const keyType = isEmail ? 'email' : 'domain';
    const defaultAction = rules.default ? `'${rules.default}'` : 'NULL';

    const sql = `INSERT INTO criteria (key_value, key_type, default_action, parent_id) VALUES ('${escapeSQL(key)}', '${keyType}', ${defaultAction}, NULL)`;
    const result = runSQL(sql);

    if (result.success) {
      stats.domains++;
    } else {
      stats.errors.push({ key, error: result.error });
    }
  }
  console.log(`  Inserted ${stats.domains} primary entries`);

  // Step 2: Insert subdomains
  console.log('\nStep 2: Inserting subdomains...');
  for (const [key, rules] of Object.entries(data)) {
    if (rules.subdomains) {
      for (const [subKey, subRules] of Object.entries(rules.subdomains)) {
        const defaultAction = subRules.default ? `'${subRules.default}'` : 'NULL';

        const sql = `INSERT INTO criteria (key_value, key_type, default_action, parent_id) SELECT '${escapeSQL(subKey)}', 'subdomain', ${defaultAction}, id FROM criteria WHERE key_value = '${escapeSQL(key)}'`;
        const result = runSQL(sql);

        if (result.success) {
          stats.subdomains++;
        } else {
          stats.errors.push({ key: subKey, error: result.error });
        }
      }
    }
  }
  console.log(`  Inserted ${stats.subdomains} subdomains`);

  // Step 3: Insert patterns for primary domains
  console.log('\nStep 3: Inserting patterns...');
  for (const [key, rules] of Object.entries(data)) {
    // Keep patterns
    if (rules.keep) {
      for (const pattern of rules.keep) {
        const sql = `INSERT INTO patterns (criteria_id, action, pattern) SELECT id, 'keep', '${escapeSQL(pattern)}' FROM criteria WHERE key_value = '${escapeSQL(key)}'`;
        if (runSQL(sql).success) stats.patterns++;
      }
    }

    // Delete patterns
    if (rules.delete) {
      for (const pattern of rules.delete) {
        const sql = `INSERT INTO patterns (criteria_id, action, pattern) SELECT id, 'delete', '${escapeSQL(pattern)}' FROM criteria WHERE key_value = '${escapeSQL(key)}'`;
        if (runSQL(sql).success) stats.patterns++;
      }
    }

    // Delete_1d patterns
    if (rules.delete_1d) {
      for (const pattern of rules.delete_1d) {
        const sql = `INSERT INTO patterns (criteria_id, action, pattern) SELECT id, 'delete_1d', '${escapeSQL(pattern)}' FROM criteria WHERE key_value = '${escapeSQL(key)}'`;
        if (runSQL(sql).success) stats.patterns++;
      }
    }

    // Subdomain patterns
    if (rules.subdomains) {
      for (const [subKey, subRules] of Object.entries(rules.subdomains)) {
        if (subRules.keep) {
          for (const pattern of subRules.keep) {
            const sql = `INSERT INTO patterns (criteria_id, action, pattern) SELECT id, 'keep', '${escapeSQL(pattern)}' FROM criteria WHERE key_value = '${escapeSQL(subKey)}'`;
            if (runSQL(sql).success) stats.patterns++;
          }
        }
        if (subRules.delete) {
          for (const pattern of subRules.delete) {
            const sql = `INSERT INTO patterns (criteria_id, action, pattern) SELECT id, 'delete', '${escapeSQL(pattern)}' FROM criteria WHERE key_value = '${escapeSQL(subKey)}'`;
            if (runSQL(sql).success) stats.patterns++;
          }
        }
        if (subRules.delete_1d) {
          for (const pattern of subRules.delete_1d) {
            const sql = `INSERT INTO patterns (criteria_id, action, pattern) SELECT id, 'delete_1d', '${escapeSQL(pattern)}' FROM criteria WHERE key_value = '${escapeSQL(subKey)}'`;
            if (runSQL(sql).success) stats.patterns++;
          }
        }
      }
    }
  }
  console.log(`  Inserted ${stats.patterns} patterns`);

  // Summary
  console.log('\n=== MIGRATION COMPLETE ===');
  console.log(`Primary domains/emails: ${stats.domains}`);
  console.log(`Subdomains: ${stats.subdomains}`);
  console.log(`Patterns: ${stats.patterns}`);
  console.log(`Errors: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    stats.errors.forEach(e => console.log(`  ${e.key}: ${e.error}`));
  }
}

migrate().catch(console.error);
