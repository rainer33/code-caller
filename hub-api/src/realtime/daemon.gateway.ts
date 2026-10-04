import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';
import { ServersService } from '../servers/servers.service';
import {
  DAEMON_INBOUND,
  DaemonApprovalRequestPayload,
  DaemonTaskLogPayload,
  DaemonTaskResultPayload,
  DaemonTaskStatusPayload,
  INTERNAL_EVENTS,
} from './events';

function serverRoom(serverId: string): string {
  return `server:${serverId}`;
}

@WebSocketGateway({ namespace: '/daemon', cors: true })
export class DaemonGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(DaemonGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly serversService: ServersService,
    private readonly eventEmitter: EventEmitter2,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    const apiKey = socket.handshake.auth?.apiKey as string | undefined;
    if (!apiKey) {
      socket.disconnect(true);
      return;
    }
    const server = await this.serversService.findByApiKey(apiKey);
    if (!server) {
      socket.disconnect(true);
      return;
    }
    socket.data.serverId = server.id;
    socket.data.ownerId = server.ownerId;
    await socket.join(serverRoom(server.id));
    await this.serversService.markHeartbeat(server.id);
    this.logger.log(`Daemon connected: server=${server.id}`);
  }

  async handleDisconnect(socket: Socket) {
    const serverId = socket.data?.serverId as string | undefined;
    if (serverId) {
      await this.serversService.markOffline(serverId);
      this.logger.log(`Daemon disconnected: server=${serverId}`);
    }
  }

  @SubscribeMessage(DAEMON_INBOUND.HEARTBEAT)
  async onHeartbeat(@ConnectedSocket() socket: Socket) {
    const serverId = socket.data?.serverId as string | undefined;
    if (serverId) {
      await this.serversService.markHeartbeat(serverId);
    }
  }

  @SubscribeMessage(DAEMON_INBOUND.TASK_STATUS_UPDATE)
  async onTaskStatusUpdate(
    @MessageBody() payload: DaemonTaskStatusPayload,
    @ConnectedSocket() socket: Socket,
  ) {
    if (!(await this.assertOwnsTask(socket, payload.taskId))) return;
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_TASK_STATUS, payload);
  }

  @SubscribeMessage(DAEMON_INBOUND.TASK_LOG)
  async onTaskLog(@MessageBody() payload: DaemonTaskLogPayload, @ConnectedSocket() socket: Socket) {
    if (!(await this.assertOwnsTask(socket, payload.taskId))) return;
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_TASK_LOG, payload);
  }

  @SubscribeMessage(DAEMON_INBOUND.TASK_RESULT)
  async onTaskResult(@MessageBody() payload: DaemonTaskResultPayload, @ConnectedSocket() socket: Socket) {
    if (!(await this.assertOwnsTask(socket, payload.taskId))) return;
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_TASK_RESULT, payload);
  }

  @SubscribeMessage(DAEMON_INBOUND.APPROVAL_REQUEST)
  async onApprovalRequest(
    @MessageBody() payload: DaemonApprovalRequestPayload,
    @ConnectedSocket() socket: Socket,
  ) {
    if (!(await this.assertOwnsTask(socket, payload.taskId))) return;
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_APPROVAL_REQUEST, payload);
  }

  /**
   * [AI-reviewed fix — Claude] Every inbound daemon event names a taskId in
   * its own payload, but handleConnection only authenticates the socket to a
   * serverId — nothing previously checked that the taskId actually belonged
   * to that server. Any daemon with a valid API key for its own server could
   * therefore report status/log/result/approval events for a taskId owned by
   * a completely different tenant, corrupting that tenant's task state and
   * triggering bogus approval-required push notifications for them. This
   * check closes that gap by rejecting events for tasks the calling socket
   * doesn't own. Found and fixed by Claude (Anthropic) during a security
   * review requested by the repo owner; see PR description for details.
   */
  private async assertOwnsTask(socket: Socket, taskId: string): Promise<boolean> {
    const serverId = socket.data?.serverId as string | undefined;
    if (!serverId) return false;
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { serverId: true } });
    if (!task || task.serverId !== serverId) {
      this.logger.warn(
        `Rejected daemon event for foreign task ${taskId}: socket belongs to server=${serverId}`,
      );
      return false;
    }
    return true;
  }

  /** Returns true if the target server currently has a connected daemon socket. */
  async isServerOnline(serverId: string): Promise<boolean> {
    const sockets = await this.server.in(serverRoom(serverId)).fetchSockets();
    return sockets.length > 0;
  }

  dispatchToServer(serverId: string, event: string, payload: unknown) {
    this.server.to(serverRoom(serverId)).emit(event, payload);
  }
}
