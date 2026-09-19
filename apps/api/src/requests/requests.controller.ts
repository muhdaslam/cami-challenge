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
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { KeywordClassifier } from './keyword-classifier';
import { RequestStatus } from './customer-request.entity';

@Controller('requests')
export class RequestsController {
  constructor(
    private readonly requestsService: RequestsService,
    private readonly classifier: KeywordClassifier,
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

  /**
   * Classify a customer request. Business rules currently live in the controller.
   */
  @Post('classify')
  async classify(@Body() body: any) {
    const message = body?.message;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { error: 'message must be a non-empty string' };
    }

    if (message.length > 2000) {
      return { error: 'message too long' };
    }

    const trimmed = message.trim();
    let result = this.classifier.classify(trimmed);

    // Soften confidence for very short messages.
    if (trimmed.split(/\s+/).length < 3 && result.category !== 'unknown') {
      result = {
        category: result.category,
        confidence: Math.max(0.5, result.confidence - 0.15),
      };
    }

    // Prefer "unknown" when confidence is weak.
    if (result.confidence < 0.55) {
      result = { category: 'unknown', confidence: result.confidence };
    }

    const requestId = body.requestId as string | undefined;
    if (requestId) {
      const existing: any = await this.requestsService.getById(requestId);
      existing.category = result.category;
      existing.confidence = result.confidence;
      if (existing.status === 'open') {
        existing.status = 'in_progress';
      }
      await this.requestsService.save(existing);
    }

    return {
      category: result.category,
      confidence: result.confidence,
      requestId: requestId ?? null,
    };
  }
}
