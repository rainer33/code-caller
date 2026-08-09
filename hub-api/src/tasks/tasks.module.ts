import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ServersModule } from '../servers/servers.module';
import { WorkersModule } from '../workers/workers.module';
import { TasksController } from './tasks.controller';
import { TasksProcessor } from './tasks.processor';
import { TasksService, TASK_DISPATCH_QUEUE } from './tasks.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: TASK_DISPATCH_QUEUE }),
    ServersModule,
    WorkersModule,
    RealtimeModule,
    NotificationsModule,
  ],
  controllers: [TasksController],
  providers: [TasksService, TasksProcessor],
  exports: [TasksService],
})
export class TasksModule {}
