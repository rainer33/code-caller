import { InjectQueue } from '@nestjs/bullmq';
import { ForbiddenException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
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
export const TASK_WATCHDOG_JOB = 'watchdog';
export const TASK_WATCHDOG_REPEAT_JOB_ID = 'task-watchdog';
export const RETRYABLE_CAPACITY_FAILURE_PREFIX = 'CAPACITY_EXHAUSTED';

type TaskWithOwner = Task & { server: { ownerId: string } };

@Injectable()
export class TasksService implements OnModuleInit {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serversService: ServersService,
    private readonly workerRegistry: WorkerRegistry,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
    @InjectQueue(TASK_DISPATCH_QUEUE) private readonly dispatchQueue: Queue,
  ) {}

  async onModuleInit() {
    await this.ensureWatchdogScheduled();
  }

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
    await this.ensureWatchdogScheduled();
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
    await this.touchRunningAttempt(payload.taskId);
    await this.updateStatus(payload.taskId, payload.status as PrismaTaskStatus);
  }

  @OnEvent(INTERNAL_EVENTS.DAEMON_TASK_LOG)
  async handleDaemonTaskLog(payload: DaemonTaskLogPayload) {
    const task = await this.prisma.task.findUnique({
      where: { id: payload.taskId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!task) return;
    await this.touchRunningAttempt(task.id);
    const updated = await this.prisma.task.update({
      where: { id: task.id },
      data: { logs: task.logs + payload.chunk },
    });
    this.realtime.notifyUser(task.server.ownerId, APP_OUTBOUND.TASK_UPDATED, updated);
  }

  @OnEvent(INTERNAL_EVENTS.DAEMON_TASK_RESULT)
  async handleDaemonTaskResult(payload: DaemonTaskResultPayload) {
    if (this.isRetryableCapacityFailure(payload)) {
      await this.handleRetryableCapacityFailure(payload);
      return;
    }

    await this.finishRunningAttempt(
      payload.taskId,
      payload.status === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED',
      payload.status === 'FAILED' ? 'Daemon reported task failure.' : undefined,
    );
    const task = await this.updateStatus(payload.taskId, payload.status as PrismaTaskStatus, payload.result);
    const title = payload.status === 'COMPLETED' ? '작업 완료' : '작업 실패';
    await this.notifications.sendPush(task.server.ownerId, title, `작업(${task.id})이 ${title}되었습니다.`);
  }

  async ensureWatchdogScheduled() {
    await this.dispatchQueue.add(
      TASK_WATCHDOG_JOB,
      {},
      {
        jobId: TASK_WATCHDOG_REPEAT_JOB_ID,
        repeat: { every: this.watchdogIntervalMs() },
        removeOnComplete: true,
        removeOnFail: 10,
      },
    );
  }

  async requeueTask(taskId: string) {
    await this.dispatchQueue.add(
      'dispatch',
      { taskId },
      { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
    );
  }

  watchdogTimeoutMs() {
    return this.positiveIntFromEnv('TASK_WATCHDOG_TIMEOUT_MS', 15 * 60 * 1000);
  }

  watchdogIntervalMs() {
    return this.positiveIntFromEnv('TASK_WATCHDOG_INTERVAL_MS', 60 * 1000);
  }

  watchdogMaxRequeues() {
    return this.positiveIntFromEnv('TASK_WATCHDOG_MAX_REQUEUES', 2);
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

  private async updateTaskAndNotify(
    taskId: string,
    data: {
      status?: PrismaTaskStatus;
      result?: unknown;
      logs?: string;
    },
  ): Promise<TaskWithOwner> {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.result !== undefined ? { result: data.result as object } : {}),
        ...(data.logs !== undefined ? { logs: data.logs } : {}),
      },
      include: { server: { select: { ownerId: true } } },
    });
    const { server, ...publicTask } = task;
    this.realtime.notifyUser(server.ownerId, APP_OUTBOUND.TASK_UPDATED, publicTask);
    return task;
  }

  private isRetryableCapacityFailure(payload: DaemonTaskResultPayload) {
    return (
      payload.status === 'FAILED' &&
      payload.failure?.category === RETRYABLE_CAPACITY_FAILURE_PREFIX &&
      payload.failure.retryable !== false
    );
  }

  private async handleRetryableCapacityFailure(payload: DaemonTaskResultPayload) {
    const task = await this.prisma.task.findUnique({
      where: { id: payload.taskId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!task) return;

    const reason = this.formatStructuredFailureReason(payload);
    await this.finishRunningAttempt(task.id, 'FAILED', reason);

    const excludedServerIds = await this.retryExcludedServerIds(task.id);
    const candidates = await this.workerRegistry.getDispatchCandidates(
      task.workerType,
      task.serverId,
      excludedServerIds,
    );
    const logLine = `\n[hub] Retryable capacity failure from server ${task.serverId}: ${payload.failure?.message ?? 'capacity exhausted'}\n`;

    if (candidates.length === 0) {
      const failed = await this.updateTaskAndNotify(task.id, {
        status: 'FAILED',
        result: payload.result,
        logs: `${task.logs}${logLine}[hub] Capacity failover exhausted: no remaining online compatible worker candidates.\n`,
      });
      this.logger.warn(`Task ${task.id} failed: capacity failover exhausted.`);
      await this.notifications.sendPush(
        failed.server.ownerId,
        '작업 실패',
        `작업(${failed.id})이 작업자 용량 소진 후 실패했습니다.`,
      );
      return;
    }

    await this.updateTaskAndNotify(task.id, {
      status: 'QUEUED',
      logs: `${task.logs}${logLine}[hub] Requeued after capacity failure; next candidate: ${candidates[0].serverName}/${candidates[0].profileName}.\n`,
    });
    await this.requeueTask(task.id);
    this.logger.warn(
      `Task ${task.id} requeued after capacity failure. next=${candidates[0].serverId}`,
    );
  }

  private async retryExcludedServerIds(taskId: string): Promise<string[]> {
    const attempts = await this.prisma.taskAttempt.findMany({
      where: {
        taskId,
        OR: [
          { status: 'TIMED_OUT' },
          {
            status: 'FAILED',
            failureReason: { startsWith: RETRYABLE_CAPACITY_FAILURE_PREFIX },
          },
        ],
      },
      select: { serverId: true },
      distinct: ['serverId'],
    });
    return attempts.map((attempt) => attempt.serverId);
  }

  private formatStructuredFailureReason(payload: DaemonTaskResultPayload) {
    const message = payload.failure?.message ?? 'Retryable worker capacity failure.';
    const detail = payload.failure?.detail ? ` detail=${payload.failure.detail.slice(0, 500)}` : '';
    return `${RETRYABLE_CAPACITY_FAILURE_PREFIX}: ${message}${detail}`;
  }

  private async touchRunningAttempt(taskId: string) {
    const attempt = await this.prisma.taskAttempt.findFirst({
      where: { taskId, status: { in: ['DISPATCHING', 'RUNNING'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!attempt) return;
    await this.prisma.taskAttempt.update({
      where: { id: attempt.id },
      data: { status: 'RUNNING', lastSeenAt: new Date() },
    });
  }

  private async finishRunningAttempt(
    taskId: string,
    status: 'SUCCEEDED' | 'FAILED',
    failureReason?: string,
  ) {
    const attempt = await this.prisma.taskAttempt.findFirst({
      where: { taskId, status: { in: ['DISPATCHING', 'RUNNING'] } },
      orderBy: { startedAt: 'desc' },
      select: { id: true },
    });
    if (!attempt) return;
    await this.prisma.taskAttempt.update({
      where: { id: attempt.id },
      data: {
        status,
        failureReason,
        lastSeenAt: new Date(),
        finishedAt: new Date(),
      },
    });
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

  private positiveIntFromEnv(name: string, fallback: number) {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
