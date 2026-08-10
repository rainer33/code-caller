import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  WorkerDispatchCandidate,
  WorkerRegistry,
} from '../workers/worker-registry.service';
import { TASK_DISPATCH_QUEUE } from './tasks.service';

@Processor(TASK_DISPATCH_QUEUE)
export class TasksProcessor extends WorkerHost {
  private readonly logger = new Logger(TasksProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workerRegistry: WorkerRegistry,
  ) {
    super();
  }

  async process(job: Job<{ taskId: string }>): Promise<void> {
    const task = await this.prisma.task.findUnique({ where: { id: job.data.taskId } });
    if (!task) {
      this.logger.warn(`Task ${job.data.taskId} not found, skipping dispatch.`);
      return;
    }
    if (task.status !== 'QUEUED') {
      this.logger.debug(`Task ${task.id} is ${task.status}, skipping dispatch.`);
      return;
    }

    const candidates = await this.workerRegistry.getDispatchCandidates(
      task.workerType,
      task.serverId,
    );
    if (candidates.length === 0) {
      throw new Error(`No online ${task.workerType} worker candidates for task ${task.id}.`);
    }

    const failures: string[] = [];
    for (const candidate of candidates) {
      try {
        await this.dispatchToCandidate(task.id, task.input, candidate);
        await this.prisma.task.update({
          where: { id: task.id },
          data: { serverId: candidate.serverId, status: 'RUNNING' },
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

  private formatFailoverLog(failures: string[]): string {
    const lines = failures.map((failure) => `- ${failure}`).join('\n');
    return `\n[hub] Dispatch failover exhausted:\n${lines}\n`;
  }
}
