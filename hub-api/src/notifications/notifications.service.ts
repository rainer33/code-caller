import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret } from '../common/crypto.util';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private app: admin.app.App | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const serviceAccountPath = this.config.get<string>('FCM_SERVICE_ACCOUNT_PATH');
    if (!serviceAccountPath) {
      this.logger.warn('FCM_SERVICE_ACCOUNT_PATH가 설정되지 않아 푸시 발송이 비활성화됩니다.');
      return;
    }
    try {
      this.app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath),
      });
    } catch (error) {
      this.logger.warn(`FCM 초기화 실패, 푸시 발송이 비활성화됩니다: ${(error as Error).message}`);
    }
  }

  async registerPushToken(userId: string, dto: RegisterPushTokenDto) {
    const encKey = this.config.getOrThrow<string>('PUSH_TOKEN_ENC_KEY');
    const encryptedToken = encryptSecret(dto.token, encKey);
    await this.prisma.pushToken.upsert({
      where: { userId_token: { userId, token: encryptedToken } },
      create: { userId, token: encryptedToken, platform: dto.platform },
      update: { platform: dto.platform },
    });
  }

  async sendPush(userId: string, title: string, body: string): Promise<void> {
    if (!this.app) {
      return;
    }
    const encKey = this.config.getOrThrow<string>('PUSH_TOKEN_ENC_KEY');
    const pushTokens = await this.prisma.pushToken.findMany({ where: { userId } });
    if (pushTokens.length === 0) {
      return;
    }
    const tokens = pushTokens.map((pt) => decryptSecret(pt.token, encKey));
    try {
      await this.app.messaging().sendEachForMulticast({
        tokens,
        notification: { title, body },
      });
    } catch (error) {
      this.logger.error(`FCM 푸시 발송 실패: ${(error as Error).message}`);
    }
  }
}
