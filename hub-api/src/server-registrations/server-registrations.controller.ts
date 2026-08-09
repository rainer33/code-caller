import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CreateServerRegistrationRequestDto } from './dto/create-server-registration-request.dto';
import { DecideServerRegistrationRequestDto } from './dto/decide-server-registration-request.dto';
import { ServerRegistrationsService } from './server-registrations.service';

@Controller('server-registration-requests')
export class ServerRegistrationsController {
  constructor(private readonly serverRegistrationsService: ServerRegistrationsService) {}

  @Post()
  create(@Body() dto: CreateServerRegistrationRequestDto) {
    return this.serverRegistrationsService.create(dto);
  }

  @Get(':id/result')
  getResult(@Param('id') id: string, @Query('secret') secret: string) {
    return this.serverRegistrationsService.getResult(id, secret);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  findPending(@CurrentUser() user: { userId: string }) {
    return this.serverRegistrationsService.findPendingForOwner(user.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/decision')
  decide(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: DecideServerRegistrationRequestDto,
  ) {
    return this.serverRegistrationsService.decide(user.userId, id, dto);
  }
}
