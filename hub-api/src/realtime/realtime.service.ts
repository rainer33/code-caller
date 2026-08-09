import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppGateway } from './app.gateway';
import { DaemonGateway } from './daemon.gateway';

@Injectable()
export class RealtimeService {
  constructor(
    private readonly daemonGateway: DaemonGateway,
    private readonly appGateway: AppGateway,
  ) {}

  async dispatchToServer(serverId: string, event: string, payload: unknown): Promise<void> {
    const online = await this.daemonGateway.isServerOnline(serverId);
    if (!online) {
      throw new ServiceUnavailableException(`서버(${serverId})의 Agent Daemon이 연결되어 있지 않습니다.`);
    }
    this.daemonGateway.dispatchToServer(serverId, event, payload);
  }

  notifyUser(userId: string, event: string, payload: unknown): void {
    this.appGateway.emitToUser(userId, event, payload);
  }
}
