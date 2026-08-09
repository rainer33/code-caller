import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { WorkerRegistry } from '../workers/worker-registry.service';
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
    // Throwing here (e.g. daemon offline) lets BullMQ retry with backoff instead of dropping the task.
    await this.workerRegistry.get(task.workerType).submitTask({
      taskId: task.id,
      serverId: task.serverId,
      input: task.input,
    });
    await this.prisma.task.update({ where: { id: task.id }, data: { status: 'RUNNING' } });
  }
}
