import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ServersModule } from '../servers/servers.module';
import { AppGateway } from './app.gateway';
import { DaemonGateway } from './daemon.gateway';
import { RealtimeService } from './realtime.service';

@Module({
  imports: [ServersModule, JwtModule.register({})],
  providers: [DaemonGateway, AppGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
