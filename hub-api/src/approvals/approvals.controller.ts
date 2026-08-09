import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApprovalStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ApprovalsService } from './approvals.service';
import { DecideApprovalDto } from './dto/decide-approval.dto';

@UseGuards(JwtAuthGuard)
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvalsService: ApprovalsService) {}

  @Get()
  findAll(@CurrentUser() user: { userId: string }, @Query('status') status?: string) {
    const normalized = status?.toUpperCase() as ApprovalStatus | undefined;
    return this.approvalsService.listForOwner(user.userId, normalized);
  }

  @Post(':id/decision')
  decide(
    @CurrentUser() user: { userId: string },
    @Param('id') id: string,
    @Body() dto: DecideApprovalDto,
  ) {
    return this.approvalsService.decide(user.userId, id, dto);
  }
}
