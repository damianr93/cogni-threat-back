import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  BadRequestException,
} from '@nestjs/common';
import { CurrentUser } from '../../shared/auth/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('admin/users')
@Roles('ADMIN')
export class AdminUsersController {
  constructor(private readonly authService: AuthService) {}

  @Get()
  listUsers() {
    return this.authService.listUsers();
  }

  @Put(':id')
  updateUser(@Param('id') id: string, @Body() body: UpdateUserDto) {
    return this.authService.updateUser(id, body);
  }

  @Delete(':id')
  deleteUser(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    if (id === user.id) {
      throw new BadRequestException('No puedes eliminar tu propio usuario');
    }

    return this.authService.deleteUser(id);
  }
}
