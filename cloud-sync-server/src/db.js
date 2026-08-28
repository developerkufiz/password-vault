import mysql from 'mysql2/promise';

const base = {
  host: process.env.TIDB_HOST,
  port: Number(process.env.TIDB_PORT || 4000),
  user: process.env.TIDB_USER,
  password: process.env.TIDB_PASSWORD,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, // TiDB Cloud requires TLS
};

const DB = (process.env.TIDB_DATABASE || 'passwordvault').replace(/`/g, '');

export const pool = mysql.createPool({
  ...base,
  database: DB,
  waitForConnections: true,
  connectionLimit: 5,
  maxIdle: 5,
  idleTimeout: 60000,
  enableKeepAlive: true,
});

export async function initSchema() {
  // Bootstrap: create the database first (the pool above can't connect until it exists).
  const boot = await mysql.createConnection(base);
  await boot.query('CREATE DATABASE IF NOT EXISTS `' + DB + '`');
  await boot.end();

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
      \`blob\`     LONGTEXT    NOT NULL,
      iv         VARCHAR(32) NOT NULL,
      version    INT         NOT NULL DEFAULT 1,
      updated_at DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
}
