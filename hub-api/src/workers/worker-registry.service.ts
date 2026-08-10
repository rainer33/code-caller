import { BadRequestException, Injectable } from '@nestjs/common';
import { ServerStatus, WorkerProvider, WorkerType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AIWorkerAdapter } from './interfaces/ai-worker-adapter.interface';
import { CodexAdapter } from './adapters/codex.adapter';

export interface WorkerDispatchCandidate {
  serverId: string;
  serverName: string;
  provider: WorkerProvider;
  profileName: string;
}

@Injectable()
export class WorkerRegistry {
  private readonly adapters: Map<WorkerType, AIWorkerAdapter>;

  constructor(
    private readonly prisma: PrismaService,
    codexAdapter: CodexAdapter,
  ) {
    this.adapters = new Map([[codexAdapter.workerType, codexAdapter]]);
  }

  get(workerType: WorkerType): AIWorkerAdapter {
    const adapter = this.adapters.get(workerType);
    if (!adapter) {
      throw new BadRequestException(`지원하지 않는 워커 타입입니다: ${workerType}`);
    }
    return adapter;
  }

  async getDispatchCandidates(
    workerType: WorkerType,
    preferredServerId: string,
  ): Promise<WorkerDispatchCandidate[]> {
    this.get(workerType);
    const provider = this.providerForWorkerType(workerType);
    const preferredServer = await this.prisma.server.findUnique({
      where: { id: preferredServerId },
      select: { ownerId: true },
    });
    if (!preferredServer) {
      throw new BadRequestException(`서버(${preferredServerId})를 찾을 수 없습니다.`);
    }

    const profiles = await this.prisma.workerProfile.findMany({
      where: {
        enabled: true,
        provider,
        server: {
          ownerId: preferredServer.ownerId,
          status: ServerStatus.ONLINE,
        },
      },
      include: { server: { select: { id: true, name: true } } },
      orderBy: [{ serverId: 'asc' }, { profileName: 'asc' }],
    });

    return profiles
      .map((profile) => ({
        serverId: profile.server.id,
        serverName: profile.server.name,
        provider: profile.provider,
        profileName: profile.profileName,
      }))
      .sort((left, right) => {
        if (left.serverId === preferredServerId) return -1;
        if (right.serverId === preferredServerId) return 1;
        return left.serverName.localeCompare(right.serverName);
      });
  }

  private providerForWorkerType(workerType: WorkerType): WorkerProvider {
    switch (workerType) {
      case WorkerType.CODEX:
        return WorkerProvider.CODEX;
      case WorkerType.CLAUDE:
        return WorkerProvider.CLAUDE_CODE;
      case WorkerType.GEMINI:
        return WorkerProvider.GEMINI;
      default:
        throw new BadRequestException(`지원하지 않는 워커 타입입니다: ${workerType}`);
    }
  }
}
