import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateServerDto } from './dto/create-server.dto';
import { ServersService } from './servers.service';

@UseGuards(JwtAuthGuard)
@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Post()
  create(@CurrentUser() user: { userId: string }, @Body() dto: CreateServerDto) {
    return this.serversService.create(user.userId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: { userId: string }) {
    return this.serversService.findAllForOwner(user.userId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.serversService.findOneForOwner(user.userId, id);
  }

  @Get(':id/health')
  getHealth(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.serversService.getHealth(user.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: { userId: string }, @Param('id') id: string) {
    return this.serversService.remove(user.userId, id);
  }
}
