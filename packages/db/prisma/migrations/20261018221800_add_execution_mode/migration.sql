-- CreateEnum
CREATE TYPE "ExecutionMode" AS ENUM ('DOCKER', 'NATIVE_UNISOLATED');

-- AlterTable
ALTER TABLE "submissions" ADD COLUMN "execution_mode" "ExecutionMode" NOT NULL DEFAULT 'DOCKER';
