import { Body, Controller, Get, Post } from '@nestjs/common';
import { Public } from '../../shared/guards/ip-whitelist.guard';
import { CurrentUser } from '../../shared/auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../shared/auth/types/authenticated-user.type';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @Public()
  login(@Body() body: LoginDto) {
    return this.authService.login(body);
  }

  @Post('register')
  @Public()
  register(@Body() body: RegisterDto) {
    return this.authService.register(body);
  }

  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }
}
