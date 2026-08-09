import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkerType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DAEMON_OUTBOUND } from '../../realtime/events';
import { RealtimeService } from '../../realtime/realtime.service';
import {
  AIWorkerAdapter,
  TaskHandle,
  TaskRequest,
  TaskResult,
  TaskStatus,
} from '../interfaces/ai-worker-adapter.interface';

@Injectable()
export class CodexAdapter implements AIWorkerAdapter {
  readonly workerType = WorkerType.CODEX;

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async submitTask(task: TaskRequest): Promise<TaskHandle> {
    await this.realtime.dispatchToServer(task.serverId, DAEMON_OUTBOUND.TASK_SUBMIT, {
      taskId: task.taskId,
      input: task.input,
    });
    return { taskId: task.taskId };
  }

  async getStatus(handle: TaskHandle): Promise<TaskStatus> {
    const task = await this.findTaskOrThrow(handle.taskId);
    return { taskId: task.id, status: task.status };
  }

  async getResult(handle: TaskHandle): Promise<TaskResult> {
    const task = await this.findTaskOrThrow(handle.taskId);
    return { taskId: task.id, result: task.result };
  }

  async cancelTask(handle: TaskHandle): Promise<void> {
    const task = await this.findTaskOrThrow(handle.taskId);
    await this.realtime.dispatchToServer(task.serverId, DAEMON_OUTBOUND.TASK_CANCEL, {
      taskId: task.id,
    });
  }

  private async findTaskOrThrow(taskId: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException(`작업(${taskId})을 찾을 수 없습니다.`);
    }
    return task;
  }
}
