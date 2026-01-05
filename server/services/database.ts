/**
 * Database Service
 *
 * Manages SQL Server connection pool and provides query utilities.
 */

import sql from 'mssql';
import { dbConfig } from '../config/database.js';

let pool: sql.ConnectionPool | null = null;
let poolPromise: Promise<sql.ConnectionPool> | null = null;

/**
 * Get or create the database connection pool.
 */
export async function getPool(): Promise<sql.ConnectionPool> {
  if (pool?.connected) {
    return pool;
  }

  if (poolPromise) {
    return poolPromise;
  }

  poolPromise = new sql.ConnectionPool(dbConfig)
    .connect()
    .then((p) => {
      pool = p;
      console.log('Connected to SQL Server');

      pool.on('error', (err) => {
        console.error('SQL Server pool error:', err);
        pool = null;
        poolPromise = null;
      });

      return pool;
    })
    .catch((err) => {
      console.error('Failed to connect to SQL Server:', err);
      poolPromise = null;
      throw err;
    });

  return poolPromise;
}

/**
 * Close the database connection pool.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.close();
    pool = null;
    poolPromise = null;
    console.log('SQL Server connection closed');
  }
}

/**
 * Execute a query and return results.
 */
export async function query<T>(
  queryString: string,
  params?: Record<string, unknown>
): Promise<sql.IResult<T>> {
  const p = await getPool();
  const request = p.request();

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      request.input(key, value);
    }
  }

  return request.query<T>(queryString);
}

/**
 * Execute a query and return the first row.
 */
export async function queryOne<T>(
  queryString: string,
  params?: Record<string, unknown>
): Promise<T | undefined> {
  const result = await query<T>(queryString, params);
  return result.recordset[0];
}

/**
 * Execute a query and return all rows.
 */
export async function queryAll<T>(
  queryString: string,
  params?: Record<string, unknown>
): Promise<T[]> {
  const result = await query<T>(queryString, params);
  return result.recordset;
}

/**
 * Execute an insert and return the inserted ID.
 */
export async function insert(
  table: string,
  data: Record<string, unknown>
): Promise<number> {
  const columns = Object.keys(data);
  const values = columns.map((col) => `@${col}`);

  const result = await query<{ id: number }>(
    `INSERT INTO ${table} (${columns.join(', ')})
     OUTPUT INSERTED.id
     VALUES (${values.join(', ')})`,
    data
  );

  return result.recordset[0]?.id;
}

/**
 * Execute an update.
 */
export async function update(
  table: string,
  data: Record<string, unknown>,
  where: string,
  whereParams?: Record<string, unknown>
): Promise<number> {
  const sets = Object.keys(data).map((col) => `${col} = @${col}`);
  const params = { ...data, ...whereParams };

  const result = await query(
    `UPDATE ${table} SET ${sets.join(', ')} WHERE ${where}`,
    params
  );

  return result.rowsAffected[0];
}

/**
 * Execute a delete.
 */
export async function remove(
  table: string,
  where: string,
  params?: Record<string, unknown>
): Promise<number> {
  const result = await query(`DELETE FROM ${table} WHERE ${where}`, params);
  return result.rowsAffected[0];
}

// Database types matching the schema
export interface CriteriaRow {
  id: number;
  key_value: string;
  key_type: 'domain' | 'subdomain' | 'email';
  default_action: 'delete' | 'delete_1d' | 'keep' | null;
  parent_id: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface PatternRow {
  id: number;
  criteria_id: number;
  action: 'keep' | 'delete' | 'delete_1d';
  pattern: string;
  created_at: Date;
}

export interface EmailPatternRow {
  id: number;
  criteria_id: number;
  direction: 'from' | 'to';
  action: 'keep' | 'delete';
  email: string;
  created_at: Date;
}

export interface UserRow {
  id: number;
  email: string;
  display_name: string | null;
  first_login: Date;
  last_login: Date;
  settings: string | null;
}

/**
 * Migrate user data from one user to another.
 * Used when a user first logs in to claim default data.
 */
export async function migrateUserData(
  fromUserEmail: string,
  toUserEmail: string
): Promise<{ criteriaMigrated: number; emailsMigrated: number }> {
  const result = await query<{ CriteriaMigrated: number; EmailsMigrated: number }>(
    `EXEC dbo.MigrateUserData @FromUserEmail = @fromUser, @ToUserEmail = @toUser`,
    { fromUser: fromUserEmail, toUser: toUserEmail }
  );

  return {
    criteriaMigrated: result.recordset[0]?.CriteriaMigrated || 0,
    emailsMigrated: result.recordset[0]?.EmailsMigrated || 0
  };
}

/**
 * Create or update user record on login.
 */
export async function upsertUser(email: string, displayName?: string): Promise<void> {
  await query(
    `IF NOT EXISTS (SELECT 1 FROM users WHERE email = @email)
     BEGIN
       INSERT INTO users (email, display_name, first_login, last_login)
       VALUES (@email, @displayName, GETDATE(), GETDATE())
     END
     ELSE
     BEGIN
       UPDATE users SET last_login = GETDATE(), display_name = COALESCE(@displayName, display_name)
       WHERE email = @email
     END`,
    { email, displayName: displayName || null }
  );
}

/**
 * Get user by email.
 */
export async function getUser(email: string): Promise<UserRow | undefined> {
  return queryOne<UserRow>(
    `SELECT id, email, display_name, first_login, last_login, settings
     FROM users WHERE email = @email`,
    { email }
  );
}

/**
 * Log an action to the audit_log table.
 * This provides a permanent record of all database changes.
 */
export async function logAudit(
  userEmail: string,
  actionType: 'INSERT' | 'UPDATE' | 'DELETE',
  tableName: string,
  recordId: number | null,
  domain: string,
  details: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_log (user_email, action_type, table_name, record_id, domain, details)
       VALUES (@userEmail, @actionType, @tableName, @recordId, @domain, @details)`,
      {
        userEmail,
        actionType,
        tableName,
        recordId,
        domain,
        details: JSON.stringify(details)
      }
    );
  } catch (error) {
    // Don't fail the main operation if audit logging fails
    console.error('Failed to write audit log:', error);
  }
}
