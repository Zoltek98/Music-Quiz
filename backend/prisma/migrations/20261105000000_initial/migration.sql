CREATE TABLE `Room` (
  `id` VARCHAR(191) NOT NULL,
  `code` VARCHAR(8) NOT NULL,
  `adminTokenHash` VARCHAR(128) NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'lobby',
  `activeCategory` INTEGER NULL,
  `activeTrack` INTEGER NULL,
  `currentPlayerId` VARCHAR(191) NULL,
  `buzzLocked` BOOLEAN NOT NULL DEFAULT false,
  `isPlaying` BOOLEAN NOT NULL DEFAULT false,
  `revealed` BOOLEAN NOT NULL DEFAULT false,
  `lastResult` VARCHAR(24) NULL,
  `trackOutcomes` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `Room_code_key`(`code`),
  INDEX `Room_createdAt_idx`(`createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Player` (
  `id` VARCHAR(191) NOT NULL,
  `roomId` VARCHAR(191) NOT NULL,
  `name` VARCHAR(32) NOT NULL,
  `score` INTEGER NOT NULL DEFAULT 0,
  `joinedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `Player_roomId_idx`(`roomId`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Player_roomId_fkey` FOREIGN KEY (`roomId`) REFERENCES `Room`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Category` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(80) NOT NULL,
  UNIQUE INDEX `Category_name_key`(`name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `Track` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `categoryId` INTEGER NOT NULL,
  `slot` INTEGER NOT NULL,
  `title` VARCHAR(160) NOT NULL,
  `artist` VARCHAR(160) NOT NULL,
  `album` VARCHAR(160) NULL,
  `spotifyUri` VARCHAR(128) NULL,
  `previewUrl` VARCHAR(512) NULL,
  `clipStartSecond` INTEGER NOT NULL DEFAULT 0,
  `clipLength` INTEGER NOT NULL DEFAULT 6,
  UNIQUE INDEX `Track_categoryId_slot_key`(`categoryId`, `slot`),
  PRIMARY KEY (`id`),
  CONSTRAINT `Track_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Room` ADD CONSTRAINT `Room_activeCategory_fkey` FOREIGN KEY (`activeCategory`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
