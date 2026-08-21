-- throtto: MySQL schema for rate limit store
-- Usage: mysql -u user -p database < mysql.sql
-- Or use: npx throtto schema --store mysql

CREATE TABLE IF NOT EXISTS `throtto_rate_limits` (
  `key` VARCHAR(512) NOT NULL PRIMARY KEY,
  `state` JSON NOT NULL,
  `expires_at` BIGINT NOT NULL,
  `created_at` BIGINT NOT NULL,
  INDEX idx_expires_at (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional: periodic cleanup via MySQL EVENT:
-- CREATE EVENT throtto_cleanup ON SCHEDULE EVERY 1 MINUTE
-- DO DELETE FROM `throtto_rate_limits` WHERE expires_at < UNIX_TIMESTAMP() * 1000;
