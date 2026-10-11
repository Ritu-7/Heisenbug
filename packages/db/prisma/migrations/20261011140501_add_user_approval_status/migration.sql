-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approval_status" "ApprovalStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "requested_role" "Role",
ALTER COLUMN "role" SET DEFAULT 'CANDIDATE';
