-- CreateTable
CREATE TABLE "postmortem_shares" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postmortem_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "postmortem_shares_session_id_key" ON "postmortem_shares"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "postmortem_shares_token_key" ON "postmortem_shares"("token");

-- AddForeignKey
ALTER TABLE "postmortem_shares" ADD CONSTRAINT "postmortem_shares_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
