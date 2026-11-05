ALTER TABLE `Room`
  ADD COLUMN `lastActivityAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ADD INDEX `Room_lastActivityAt_idx` (`lastActivityAt`);
