import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ServerStatus, WorkerProvider } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { generateApiKey, hashApiKey } from '../common/crypto.util';
import { CreateServerDto } from './dto/create-server.dto';

@Injectable()
export class ServersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(ownerId: string, dto: CreateServerDto) {
    const apiKey = generateApiKey();
    const server = await this.prisma.server.create({
      data: {
        ownerId,
        name: dto.name,
        osType: dto.osType,
        tailscaleIp: dto.tailscaleIp,
        apiKeyHash: hashApiKey(apiKey),
        workerProfiles: {
          create: this.defaultWorkerProfiles(),
        },
      },
    });
    // apiKey is only ever returned here — it cannot be recovered later, only rotated.
    return { ...this.toPublic(server), apiKey };
  }

  async findAllForOwner(ownerId: string) {
    const servers = await this.prisma.server.findMany({ where: { ownerId } });
    return servers.map((server) => this.toPublic(server));
  }

  async findOneForOwner(ownerId: string, serverId: string) {
    const server = await this.getOwnedServer(ownerId, serverId);
    return this.toPublic(server);
  }

  async getHealth(ownerId: string, serverId: string) {
    const server = await this.getOwnedServer(ownerId, serverId);
    return {
      status: server.status,
      lastHeartbeatAt: server.lastHeartbeatAt,
    };
  }

  async remove(ownerId: string, serverId: string) {
    await this.getOwnedServer(ownerId, serverId);
    await this.prisma.server.delete({ where: { id: serverId } });
  }

  async markHeartbeat(serverId: string) {
    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: ServerStatus.ONLINE, lastHeartbeatAt: new Date() },
    });
  }

  async markOffline(serverId: string) {
    await this.prisma.server.update({
      where: { id: serverId },
      data: { status: ServerStatus.OFFLINE },
    });
  }

  async findByApiKey(apiKey: string) {
    const apiKeyHash = hashApiKey(apiKey);
    return this.prisma.server.findFirst({ where: { apiKeyHash } });
  }

  private async getOwnedServer(ownerId: string, serverId: string) {
    const server = await this.prisma.server.findUnique({ where: { id: serverId } });
    if (!server) {
      throw new NotFoundException('서버를 찾을 수 없습니다.');
    }
    if (server.ownerId !== ownerId) {
      throw new ForbiddenException('해당 서버에 접근할 권한이 없습니다.');
    }
    return server;
  }

  private toPublic(server: {
    id: string;
    name: string;
    osType: string;
    tailscaleIp: string;
    status: string;
    lastHeartbeatAt: Date | null;
    createdAt: Date;
  }) {
    const { id, name, osType, tailscaleIp, status, lastHeartbeatAt, createdAt } = server;
    return { id, name, osType, tailscaleIp, status, lastHeartbeatAt, createdAt };
  }

  private defaultWorkerProfiles() {
    return [
      {
        provider: WorkerProvider.CODEX,
        profileName: 'default',
        enabled: true,
        capabilities: {
          taskExecution: true,
          approvals: true,
          shell: true,
          codeEditing: true,
        },
      },
    ];
  }
}
