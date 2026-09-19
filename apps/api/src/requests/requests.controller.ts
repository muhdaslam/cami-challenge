import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import { ClassificationService } from './classification.service';
import { ClassifyRequestDto, ClassifyResponse } from './classify.dto';
import { RequestsService } from './requests.service';
import { RequestStatus } from './customer-request.entity';

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly classification: ClassificationService,
  ) {}

  @Get()
  list(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    if (limit !== undefined && limit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return this.requestsService.list(limit);
  }

  @Get('history')
  history(@Query('category') _category?: string) {
    return {
      items: [],
      message: 'Classification history is not implemented yet.',
    };
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.requestsService.getById(id);
  }

  @Post()
  create(@Body() body: { message?: string }) {
    if (!body?.message || typeof body.message !== 'string') {
      return { error: 'message is required' };
    }
    return this.requestsService.create(body.message);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status?: RequestStatus }) {
    if (!body?.status) {
      return { error: 'status is required' };
    }
    return this.requestsService.updateStatus(id, body.status);
  }

  @Post('classify')
  classify(
    @Body(new ValidationPipe({ whitelist: true, stopAtFirstError: true })) dto: ClassifyRequestDto,
  ): Promise<ClassifyResponse> {
    return this.classification.classify(dto);
  }
}
