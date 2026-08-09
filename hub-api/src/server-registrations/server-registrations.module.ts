import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ServerRegistrationsController } from './server-registrations.controller';
import { ServerRegistrationsService } from './server-registrations.service';

@Module({
  imports: [PrismaModule],
  controllers: [ServerRegistrationsController],
  providers: [ServerRegistrationsService],
})
export class ServerRegistrationsModule {}
