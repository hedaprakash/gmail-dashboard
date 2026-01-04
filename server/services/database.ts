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
