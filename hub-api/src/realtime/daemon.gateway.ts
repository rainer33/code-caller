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
  onTaskStatusUpdate(@MessageBody() payload: DaemonTaskStatusPayload) {
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_TASK_STATUS, payload);
  }

  @SubscribeMessage(DAEMON_INBOUND.TASK_LOG)
  onTaskLog(@MessageBody() payload: DaemonTaskLogPayload) {
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_TASK_LOG, payload);
  }

  @SubscribeMessage(DAEMON_INBOUND.TASK_RESULT)
  onTaskResult(@MessageBody() payload: DaemonTaskResultPayload) {
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_TASK_RESULT, payload);
  }

  @SubscribeMessage(DAEMON_INBOUND.APPROVAL_REQUEST)
  onApprovalRequest(@MessageBody() payload: DaemonApprovalRequestPayload) {
    this.eventEmitter.emit(INTERNAL_EVENTS.DAEMON_APPROVAL_REQUEST, payload);
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
