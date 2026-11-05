ALTER TABLE `Track` CHANGE COLUMN `clipStartSecond` `clipStartMs` INTEGER NOT NULL DEFAULT 0;
UPDATE `Track` SET `clipStartMs` = `clipStartMs` * 1000;
