import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  database: process.env.TIDB_DATABASE,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, // TiDB Cloud requires TLS
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 5,
  idleTimeout: 60000,
  enableKeepAlive: true,
});

export async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             BIGINT PRIMARY KEY AUTO_INCREMENT,
      email          VARCHAR(190) NOT NULL UNIQUE,
      kdf_salt       VARCHAR(64)  NOT NULL,
      kdf_iterations INT          NOT NULL DEFAULT 600000,
      auth_hash      VARCHAR(255) NOT NULL,
      created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vaults (
      user_id    BIGINT PRIMARY KEY,
      blob       LONGTEXT    NOT NULL,
      iv         VARCHAR(32) NOT NULL,
      version    INT         NOT NULL DEFAULT 1,
      updated_at DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
}
