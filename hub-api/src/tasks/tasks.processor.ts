import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  WorkerDispatchCandidate,
  WorkerRegistry,
} from '../workers/worker-registry.service';
import { TASK_DISPATCH_QUEUE, TASK_WATCHDOG_JOB, TasksService } from './tasks.service';

@Processor(TASK_DISPATCH_QUEUE)
export class TasksProcessor extends WorkerHost {
  private readonly logger = new Logger(TasksProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workerRegistry: WorkerRegistry,
    private readonly tasksService: TasksService,
  ) {
    super();
  }

  async process(job: Job<{ taskId?: string }>): Promise<void> {
    if (job.name === TASK_WATCHDOG_JOB) {
      await this.scanStuckTasksOnce();
      return;
    }

    if (!job.data.taskId) {
      this.logger.warn(`Dispatch job ${job.id} is missing taskId, skipping.`);
      return;
    }

    const task = await this.prisma.task.findUnique({ where: { id: job.data.taskId } });
    if (!task) {
      this.logger.warn(`Task ${job.data.taskId} not found, skipping dispatch.`);
      return;
    }
    if (task.status !== 'QUEUED') {
      this.logger.debug(`Task ${task.id} is ${task.status}, skipping dispatch.`);
      return;
    }

    const excludedServerIds = await this.timedOutServerIds(task.id);
    const candidates = await this.workerRegistry.getDispatchCandidates(
      task.workerType,
      task.serverId,
      excludedServerIds,
    );
    if (candidates.length === 0) {
      throw new Error(`No online ${task.workerType} worker candidates for task ${task.id}.`);
    }

    const failures: string[] = [];
    for (const candidate of candidates) {
      const attempt = await this.prisma.taskAttempt.create({
        data: {
          taskId: task.id,
          serverId: candidate.serverId,
          status: 'DISPATCHING',
        },
      });
      try {
        await this.dispatchToCandidate(task.id, task.input, candidate);
        await this.prisma.task.update({
          where: { id: task.id },
          data: { serverId: candidate.serverId, status: 'RUNNING' },
        });
        await this.prisma.taskAttempt.update({
          where: { id: attempt.id },
          data: { status: 'RUNNING', lastSeenAt: new Date() },
        });
        if (candidate.serverId !== task.serverId) {
          this.logger.warn(
            `Task ${task.id} failed over from ${task.serverId} to ${candidate.serverId}.`,
          );
        }
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${candidate.serverName}/${candidate.profileName}: ${message}`);
        await this.prisma.taskAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            failureReason: message,
            finishedAt: new Date(),
            lastSeenAt: new Date(),
          },
        });
        this.logger.warn(`Task ${task.id} dispatch failed on ${candidate.serverId}: ${message}`);
      }
    }

    await this.prisma.task.update({
      where: { id: task.id },
      data: {
        logs: `${task.logs}${this.formatFailoverLog(failures)}`,
      },
    });

    throw new Error(`Task ${task.id} dispatch failed on all candidates: ${failures.join(' | ')}`);
  }

  async scanStuckTasksOnce(): Promise<number> {
    const staleBefore = new Date(Date.now() - this.tasksService.watchdogTimeoutMs());
    const runningTasks = await this.prisma.task.findMany({
      where: {
        status: 'RUNNING',
        updatedAt: { lt: staleBefore },
      },
      include: {
        attempts: {
          orderBy: { startedAt: 'desc' },
          take: 1,
        },
      },
    });

    let handled = 0;
    for (const task of runningTasks) {
      const attempt = task.attempts[0];
      if (!attempt || !['DISPATCHING', 'RUNNING'].includes(attempt.status)) continue;
      if (attempt.lastSeenAt >= staleBefore) continue;

      const timedOutCount = await this.prisma.taskAttempt.count({
        where: { taskId: task.id, status: 'TIMED_OUT' },
      });
      const reason = `No daemon update for ${this.tasksService.watchdogTimeoutMs()}ms.`;
      await this.prisma.taskAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'TIMED_OUT',
          failureReason: reason,
          finishedAt: new Date(),
        },
      });

      if (timedOutCount >= this.tasksService.watchdogMaxRequeues()) {
        const updated = await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'FAILED',
            logs: `${task.logs}\n[hub] Watchdog failed task after repeated stale RUNNING attempts: ${reason}\n`,
          },
        });
        this.logger.warn(`Task ${updated.id} failed after watchdog requeue limit.`);
      } else {
        await this.prisma.task.update({
          where: { id: task.id },
          data: {
            status: 'QUEUED',
            logs: `${task.logs}\n[hub] Watchdog requeued stale RUNNING task from server ${attempt.serverId}: ${reason}\n`,
          },
        });
        await this.tasksService.requeueTask(task.id);
        this.logger.warn(`Task ${task.id} requeued by watchdog.`);
      }
      handled += 1;
    }

    return handled;
  }

  private async dispatchToCandidate(
    taskId: string,
    input: unknown,
    candidate: WorkerDispatchCandidate,
  ): Promise<void> {
    const task = await this.prisma.task.findUniqueOrThrow({
      where: { id: taskId },
      select: { id: true, workerType: true },
    });
    await this.workerRegistry.get(task.workerType).submitTask({
      taskId: task.id,
      serverId: candidate.serverId,
      input,
    });
  }

  private async timedOutServerIds(taskId: string): Promise<string[]> {
    const attempts = await this.prisma.taskAttempt.findMany({
      where: { taskId, status: 'TIMED_OUT' },
      select: { serverId: true },
      distinct: ['serverId'],
    });
    return attempts.map((attempt) => attempt.serverId);
  }

  private formatFailoverLog(failures: string[]): string {
    const lines = failures.map((failure) => `- ${failure}`).join('\n');
    return `\n[hub] Dispatch failover exhausted:\n${lines}\n`;
  }
}
