-- Run once against your TiDB Cloud database.
-- (The server also auto-creates these on first start, so this file is optional.)

CREATE TABLE IF NOT EXISTS users (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  email          VARCHAR(190) NOT NULL UNIQUE,
  kdf_salt       VARCHAR(64)  NOT NULL,
  kdf_iterations INT          NOT NULL DEFAULT 600000,
  auth_hash      VARCHAR(255) NOT NULL,
  created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vaults (
  user_id    BIGINT PRIMARY KEY,
  `blob`     LONGTEXT    NOT NULL,   -- AES-GCM ciphertext (base64), server cannot read it
  iv         VARCHAR(32) NOT NULL,   -- AES-GCM nonce (base64)
  version    INT         NOT NULL DEFAULT 1,
  updated_at DATETIME    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
