/**
 * Database Configuration
 *
 * SQL Server connection settings for the GmailCriteria database.
 */

import sql from 'mssql';

export const dbConfig: sql.config = {
  server: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '1433'),
  database: process.env.DB_NAME || 'GmailCriteria',
  user: process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD || 'MyPass@word123',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

// Feature flag to toggle between SQL and JSON
export const USE_SQL_DATABASE = process.env.USE_SQL_DATABASE === 'true';
