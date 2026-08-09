import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Queue } from 'bullmq';
import { Task, TaskStatus as PrismaTaskStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import { APP_OUTBOUND, DaemonTaskLogPayload, DaemonTaskResultPayload, DaemonTaskStatusPayload, INTERNAL_EVENTS } from '../realtime/events';
import { RealtimeService } from '../realtime/realtime.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkerRegistry } from '../workers/worker-registry.service';
import { CreateTaskDto } from './dto/create-task.dto';

export const TASK_DISPATCH_QUEUE = 'task-dispatch';

type TaskWithOwner = Task & { server: { ownerId: string } };

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly serversService: ServersService,
    private readonly workerRegistry: WorkerRegistry,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    @InjectQueue(TASK_DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
  ) {}

  async submit(ownerId: string, dto: CreateTaskDto) {
    await this.serversService.findOneForOwner(ownerId, dto.serverId);
    const task = await this.prisma.task.create({
      data: {
        serverId: dto.serverId,
        workerType: dto.workerType,
        input: dto.input as object,
      },
    });
    await this.dispatchQueue.add(
      'dispatch',
      { taskId: task.id },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    );
    return task;
  }

  async findAllForOwner(ownerId: string) {
    return this.prisma.task.findMany({
      where: { server: { ownerId } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOneForOwner(ownerId: string, taskId: string) {
    const { server, ...publicTask } = await this.getOwnedTask(ownerId, taskId);
    return publicTask;
  }

  async cancel(ownerId: string, taskId: string) {
    const task = await this.getOwnedTask(ownerId, taskId);
    await this.workerRegistry.get(task.workerType).cancelTask({ taskId: task.id });
    const { server, ...publicTask } = await this.updateStatus(task.id, 'CANCELLED');
    return publicTask;
  }

  @OnEvent(INTERNAL_EVENTS.DAEMON_TASK_STATUS)
  async handleDaemonTaskStatus(payload: DaemonTaskStatusPayload) {
    await this.updateStatus(payload.taskId, payload.status as PrismaTaskStatus);
  }

  @OnEvent(INTERNAL_EVENTS.DAEMON_TASK_LOG)
  async handleDaemonTaskLog(payload: DaemonTaskLogPayload) {
    const task = await this.prisma.task.findUnique({
      where: { id: payload.taskId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!task) return;
    const updated = await this.prisma.task.update({
      where: { id: task.id },
      data: { logs: task.logs + payload.chunk },
    });
    this.realtime.notifyUser(task.server.ownerId, APP_OUTBOUND.TASK_UPDATED, updated);
  }

  @OnEvent(INTERNAL_EVENTS.DAEMON_TASK_RESULT)
  async handleDaemonTaskResult(payload: DaemonTaskResultPayload) {
    const task = await this.updateStatus(payload.taskId, payload.status as PrismaTaskStatus, payload.result);
    const title = payload.status === 'COMPLETED' ? '작업 완료' : '작업 실패';
    await this.notifications.sendPush(task.server.ownerId, title, `작업(${task.id})이 ${title}되었습니다.`);
  }

  private async updateStatus(
    taskId: string,
    status: PrismaTaskStatus,
    result?: unknown,
  ): Promise<TaskWithOwner> {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { status, ...(result !== undefined ? { result: result as object } : {}) },
      include: { server: { select: { ownerId: true } } },
    });
    const { server, ...publicTask } = task;
    this.realtime.notifyUser(server.ownerId, APP_OUTBOUND.TASK_UPDATED, publicTask);
    return task;
  }

  private async getOwnedTask(ownerId: string, taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!task) {
      throw new NotFoundException('작업을 찾을 수 없습니다.');
    }
    if (task.server.ownerId !== ownerId) {
      throw new ForbiddenException('해당 작업에 접근할 권한이 없습니다.');
    }
    return task;
  }
}
