import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ApprovalStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  APP_OUTBOUND,
  DAEMON_OUTBOUND,
  DaemonApprovalRequestPayload,
  INTERNAL_EVENTS,
} from '../realtime/events';
import { RealtimeService } from '../realtime/realtime.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly notifications: NotificationsService,
  ) {}

  async listForOwner(ownerId: string, status?: ApprovalStatus) {
    return this.prisma.approval.findMany({
      where: {
        task: { server: { ownerId } },
        ...(status ? { status } : {}),
      },
      include: { task: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async decide(ownerId: string, approvalId: string, dto: DecideApprovalDto) {
    const approval = await this.prisma.approval.findUnique({
      where: { id: approvalId },
      include: { task: { include: { server: true } } },
    });
    if (!approval) {
      throw new NotFoundException('승인 요청을 찾을 수 없습니다.');
    }
    if (approval.task.server.ownerId !== ownerId) {
      throw new ForbiddenException('해당 승인 요청에 접근할 권한이 없습니다.');
    }
    if (approval.status !== ApprovalStatus.PENDING) {
      throw new BadRequestException('이미 처리된 승인 요청입니다.');
    }

    const decidedStatus = dto.approve ? ApprovalStatus.APPROVED : ApprovalStatus.REJECTED;
    const updatedApproval = await this.prisma.approval.update({
      where: { id: approvalId },
      data: { status: decidedStatus, decidedAt: new Date(), reason: dto.reason },
    });
    await this.prisma.task.update({
      where: { id: approval.taskId },
      data: { status: dto.approve ? 'RUNNING' : 'CANCELLED' },
    });

    try {
      await this.realtime.dispatchToServer(approval.task.serverId, DAEMON_OUTBOUND.APPROVAL_DECISION, {
        taskId: approval.taskId,
        approved: dto.approve,
        reason: dto.reason,
      });
    } catch (error) {
      // Decision is already durable in the DB; the daemon reconciles pending
      // decisions on reconnect (NFR-3.1), so a delivery failure here is not fatal.
      this.logger.warn(`승인 결정을 Daemon에 전달하지 못했습니다: ${(error as Error).message}`);
    }

    this.realtime.notifyUser(ownerId, APP_OUTBOUND.APPROVAL_RESOLVED, updatedApproval);
    return updatedApproval;
  }

  @OnEvent(INTERNAL_EVENTS.DAEMON_APPROVAL_REQUEST)
  async handleDaemonApprovalRequest(payload: DaemonApprovalRequestPayload) {
    const task = await this.prisma.task.findUnique({
      where: { id: payload.taskId },
      include: { server: { select: { ownerId: true } } },
    });
    if (!task) {
      this.logger.warn(`승인 요청 대상 작업(${payload.taskId})을 찾을 수 없습니다.`);
      return;
    }

    const approval = await this.prisma.approval.create({
      data: { taskId: payload.taskId, reason: payload.reason },
    });
    await this.prisma.task.update({
      where: { id: payload.taskId },
      data: { status: 'AWAITING_APPROVAL' },
    });

    this.realtime.notifyUser(task.server.ownerId, APP_OUTBOUND.APPROVAL_PENDING, approval);
    await this.notifications.sendPush(task.server.ownerId, '승인 필요', payload.reason);
  }
}
