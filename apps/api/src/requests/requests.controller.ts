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
import { ClassificationHistoryService } from './classification-history.service';
import { ClassificationHistoryPage } from './classification-log';
import { ClassificationService } from './classification.service';
import { ClassifyRequestDto, ClassifyResponse } from './classify.dto';
import { HistoryQueryDto } from './history-query.dto';
import { RequestStatus } from './request-model';
import { RequestsService } from './requests.service';

// `transform` is what turns query strings into the numbers a DTO declares; `stopAtFirstError`
// keeps the error body to one reason per field.
const dtoPipe = new ValidationPipe({ whitelist: true, transform: true, stopAtFirstError: true });

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly classification: ClassificationService,
    private readonly classificationHistory: ClassificationHistoryService,
  ) {}

  @Get()
  list(@Query('limit', new ParseIntPipe({ optional: true })) limit?: number) {
    if (limit !== undefined && limit < 1) {
      throw new BadRequestException('limit must be a positive integer');
    }
    return this.requestsService.list(limit);
  }

  // Declared before ':id' so "history" is not read as an id.
  @Get('history')
  history(@Query(dtoPipe) query: HistoryQueryDto): Promise<ClassificationHistoryPage> {
    return this.classificationHistory.list(query);
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
  classify(@Body(dtoPipe) dto: ClassifyRequestDto): Promise<ClassifyResponse> {
    return this.classification.classify(dto);
  }
}
