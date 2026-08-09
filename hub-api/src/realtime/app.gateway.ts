import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtAccessPayload } from '../auth/strategies/jwt.strategy';

function userRoom(userId: string): string {
  return `user:${userId}`;
}

@WebSocketGateway({ namespace: '/app', cors: true })
export class AppGateway implements OnGatewayConnection {
  private readonly logger = new Logger(AppGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket) {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      socket.disconnect(true);
      return;
    }
    try {
      const payload = this.jwt.verify<JwtAccessPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      socket.data.userId = payload.sub;
      await socket.join(userRoom(payload.sub));
    } catch {
      socket.disconnect(true);
      return;
    }
    this.logger.log(`Mobile client connected: user=${socket.data.userId}`);
  }

  emitToUser(userId: string, event: string, payload: unknown) {
    this.server.to(userRoom(userId)).emit(event, payload);
  }
}
