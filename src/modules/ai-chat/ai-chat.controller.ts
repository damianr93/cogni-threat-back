import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Public } from '../../shared/guards/ip-whitelist.guard';
import { Roles } from '../../shared/auth/decorators/roles.decorator';
import { CurrentUser } from '../../shared/auth/decorators/current-user.decorator';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import { AiChatService } from './ai-chat.service';
import { SyncSchedulerService } from './ingestion/sync-scheduler.service';
import { AskQuestionDto } from './dto/ask-question.dto';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { DeleteConversationDto } from './dto/delete-conversation.dto';
import { UpdateConversationTitleDto } from './dto/update-conversation-title.dto';

@Controller('ai')
export class AiChatController {
  constructor(
    private readonly aiChat: AiChatService,
    private readonly sync: SyncSchedulerService,
  ) {}

  @Get('health')
  @Public()
  getHealth() {
    return this.aiChat.getHealth();
  }

  @Get('me/conversations')
  async listConversations(@CurrentUser() user: AuthenticatedUser) {
    return {
      success: true,
      data: await this.aiChat.listConversations(user.id),
    };
  }

  @Post('conversation')
  @RequireWrite()
  createConversation(
    @Body() body: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiChat.createConversation(user.id, body.title);
  }

  @Get('conversation/:id/history')
  async getHistory(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return {
      success: true,
      data: await this.aiChat.getHistory(id, user.id),
    };
  }

  @Put('conversation/:id/update-title')
  @RequireWrite()
  updateTitle(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateConversationTitleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiChat.updateTitle(id, body.title, user.id);
  }

  @Post('conversation/delete')
  @RequireWrite()
  deleteConversation(
    @Body() body: DeleteConversationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.aiChat.deleteConversation(body.conversationId, user.id);
  }

  @Post('ask')
  @RequireWrite()
  ask(@Body() body: AskQuestionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.aiChat.ask(
      body.conversationId,
      body.question,
      user.id,
      body.categories,
      body.sources,
    );
  }

  @Get('context/categories')
  getContextCategories() {
    return this.aiChat.getContextCategories();
  }

  @Get('context/sources')
  getContextSources(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ) {
    return this.aiChat.getContextSources(
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
      search,
      category,
    );
  }

  @Post('admin/sync')
  @Roles('ADMIN')
  async triggerSync() {
    void this.sync.triggerFull();
    return {
      success: true,
      data: { message: 'Ingesta iniciada en background' },
    };
  }
}
