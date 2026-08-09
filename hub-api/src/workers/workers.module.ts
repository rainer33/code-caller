import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { CodexAdapter } from './adapters/codex.adapter';
import { WorkerRegistry } from './worker-registry.service';

@Module({
  imports: [RealtimeModule],
  providers: [CodexAdapter, WorkerRegistry],
  exports: [WorkerRegistry],
})
export class WorkersModule {}
