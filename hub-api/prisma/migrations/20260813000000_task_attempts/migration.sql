-- CreateEnum
CREATE TYPE "TaskAttemptStatus" AS ENUM ('DISPATCHING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "task_attempts" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "status" "TaskAttemptStatus" NOT NULL DEFAULT 'DISPATCHING',
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "task_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_status_updatedAt_idx" ON "tasks"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "task_attempts_taskId_status_idx" ON "task_attempts"("taskId", "status");

-- CreateIndex
CREATE INDEX "task_attempts_status_lastSeenAt_idx" ON "task_attempts"("status", "lastSeenAt");

-- AddForeignKey
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_attempts" ADD CONSTRAINT "task_attempts_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
