import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ServerRegistrationRequest,
  ServerRegistrationStatus,
  WorkerProvider,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  decryptForRequestSecret,
  encryptForRequestSecret,
  generateApiKey,
  generateSecret,
  generateVerificationCode,
  hashApiKey,
} from '../common/crypto.util';
import { CreateServerRegistrationRequestDto } from './dto/create-server-registration-request.dto';
import { DecideServerRegistrationRequestDto } from './dto/decide-server-registration-request.dto';

const REQUEST_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class ServerRegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateServerRegistrationRequestDto) {
    const owner = await this.prisma.user.findUnique({
      where: { email: dto.ownerEmail },
    });
    if (!owner) {
      throw new NotFoundException('등록할 사용자를 찾을 수 없습니다.');
    }

    const requestSecret = generateSecret();
    const request = await this.prisma.serverRegistrationRequest.create({
      data: {
        ownerId: owner.id,
        name: dto.name,
        osType: dto.osType,
        tailscaleIp: dto.tailscaleIp,
        fingerprint: dto.fingerprint,
        verificationCode: generateVerificationCode(),
        requestSecretHash: hashApiKey(requestSecret),
        expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
      },
    });

    return {
      ...this.toPublic(request),
      requestSecret,
    };
  }

  async findPendingForOwner(ownerId: string) {
    await this.expirePendingRequests();
    const requests = await this.prisma.serverRegistrationRequest.findMany({
      where: { ownerId, status: ServerRegistrationStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(request => this.toPublic(request));
  }

  async decide(
    ownerId: string,
    requestId: string,
    dto: DecideServerRegistrationRequestDto,
  ) {
    const request = await this.prisma.serverRegistrationRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('서버 등록 요청을 찾을 수 없습니다.');
    }
    if (request.ownerId !== ownerId) {
      throw new ForbiddenException('해당 등록 요청에 접근할 권한이 없습니다.');
    }
    const current = await this.expireIfNeeded(request);
    if (current.status !== ServerRegistrationStatus.PENDING) {
      return this.toPublic(current);
    }

    if (!dto.approve) {
      const rejected = await this.prisma.serverRegistrationRequest.update({
        where: { id: requestId },
        data: { status: ServerRegistrationStatus.REJECTED },
      });
      return this.toPublic(rejected);
    }

    const apiKey = generateApiKey();
    const encrypted = encryptForRequestSecret(apiKey, request.requestSecretHash);
    const approved = await this.prisma.$transaction(async tx => {
      const server = await tx.server.create({
        data: {
          ownerId,
          name: request.name,
          osType: request.osType,
          tailscaleIp: request.tailscaleIp,
          apiKeyHash: hashApiKey(apiKey),
          workerProfiles: {
            create: this.defaultWorkerProfiles(),
          },
        },
      });
      return tx.serverRegistrationRequest.update({
        where: { id: requestId },
        data: {
          status: ServerRegistrationStatus.APPROVED,
          serverId: server.id,
          apiKeyCiphertext: encrypted.ciphertext,
          apiKeyIv: encrypted.iv,
          apiKeyAuthTag: encrypted.authTag,
        },
      });
    });

    return this.toPublic(approved);
  }

  async getResult(requestId: string, requestSecret: string) {
    if (!requestSecret) {
      throw new UnauthorizedException('등록 요청 secret이 필요합니다.');
    }
    const request = await this.prisma.serverRegistrationRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) {
      throw new NotFoundException('서버 등록 요청을 찾을 수 없습니다.');
    }
    if (request.requestSecretHash !== hashApiKey(requestSecret)) {
      throw new UnauthorizedException('등록 요청 secret이 올바르지 않습니다.');
    }

    const current = await this.expireIfNeeded(request);
    if (current.status !== ServerRegistrationStatus.APPROVED) {
      return this.toDaemonResult(current);
    }
    if (
      !current.serverId ||
      !current.apiKeyCiphertext ||
      !current.apiKeyIv ||
      !current.apiKeyAuthTag
    ) {
      return this.toDaemonResult(current);
    }

    const apiKey = decryptForRequestSecret(
      {
        ciphertext: current.apiKeyCiphertext,
        iv: current.apiKeyIv,
        authTag: current.apiKeyAuthTag,
      },
      current.requestSecretHash,
    );
    const delivered = await this.prisma.serverRegistrationRequest.update({
      where: { id: requestId },
      data: {
        status: ServerRegistrationStatus.CREDENTIAL_DELIVERED,
        apiKeyCiphertext: null,
        apiKeyIv: null,
        apiKeyAuthTag: null,
      },
    });

    return {
      ...this.toDaemonResult(delivered),
      status: ServerRegistrationStatus.APPROVED,
      serverId: current.serverId,
      apiKey,
    };
  }

  private async expirePendingRequests() {
    await this.prisma.serverRegistrationRequest.updateMany({
      where: {
        status: ServerRegistrationStatus.PENDING,
        expiresAt: { lt: new Date() },
      },
      data: { status: ServerRegistrationStatus.EXPIRED },
    });
  }

  private async expireIfNeeded(request: ServerRegistrationRequest) {
    if (
      request.status !== ServerRegistrationStatus.PENDING ||
      request.expiresAt.getTime() >= Date.now()
    ) {
      return request;
    }
    return this.prisma.serverRegistrationRequest.update({
      where: { id: request.id },
      data: { status: ServerRegistrationStatus.EXPIRED },
    });
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
      {
        provider: WorkerProvider.CLAUDE_CODE,
        profileName: 'future',
        enabled: false,
        capabilities: { taskExecution: true, approvals: true },
      },
      {
        provider: WorkerProvider.ANTIGRAVITY,
        profileName: 'future',
        enabled: false,
        capabilities: { taskExecution: true, approvals: true },
      },
      {
        provider: WorkerProvider.OPENCODE,
        profileName: 'future',
        enabled: false,
        capabilities: { taskExecution: true, approvals: true },
      },
    ];
  }

  private toDaemonResult(request: ServerRegistrationRequest) {
    return {
      id: request.id,
      status: request.status,
      verificationCode: request.verificationCode,
      expiresAt: request.expiresAt,
      serverId: request.serverId,
    };
  }

  private toPublic(request: ServerRegistrationRequest) {
    return {
      id: request.id,
      name: request.name,
      osType: request.osType,
      tailscaleIp: request.tailscaleIp,
      fingerprint: request.fingerprint,
      verificationCode: request.verificationCode,
      status: request.status,
      expiresAt: request.expiresAt,
      serverId: request.serverId,
      createdAt: request.createdAt,
    };
  }
}
