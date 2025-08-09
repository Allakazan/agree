import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ServerService } from './server.service';
import { CreateServerDto } from './dto/create-server.dto';
import { ApiBearerAuth } from '@nestjs/swagger';
import { User } from '../auth/decorators/user.decorator';
import { LoggedUser } from '../auth/types/loggedUser.type';

@Controller('server')
@ApiBearerAuth()
export class ServerController {
  constructor(private readonly serverService: ServerService) {}

  @Post()
  async create(
    @User() user: LoggedUser,
    @Body() createServerDto: CreateServerDto,
  ) {
    try {
      console.log(user);
      return this.serverService.create(createServerDto);
    } catch (error) {
      throw new BadRequestException(error);
    }
  }

  @Get('/')
  async find() {
    return await this.serverService.findAll();
  }
}
