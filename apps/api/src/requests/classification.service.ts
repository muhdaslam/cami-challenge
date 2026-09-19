import { BadGatewayException, Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClassificationHistoryService } from './classification-history.service';
import { applyClassificationRules } from './classification-rules';
import {
  CLASSIFICATION_PROVIDER,
  ClassificationProvider,
  isClassificationResult,
} from './classification-provider';
import { ClassifyRequestDto, ClassifyResponse } from './classify.dto';
import { RequestsService } from './requests.service';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @Inject(CLASSIFICATION_PROVIDER) private readonly provider: ClassificationProvider,
    private readonly requests: RequestsService,
    private readonly history: ClassificationHistoryService,
    private readonly dataSource: DataSource,
  ) {}

  async classify({ message, requestId }: ClassifyRequestDto): Promise<ClassifyResponse> {
    const trimmed = message.trim();
    const suggestion = await this.askProvider(trimmed);
    const result = applyClassificationRules(suggestion, trimmed);

    // The request update and its history row stand or fall together.
    await this.dataSource.transaction(async (manager) => {
      if (requestId) {
        await this.requests.applyClassification(requestId, result, manager);
      }
      await this.history.record(
        {
          requestId: requestId ?? null,
          message: trimmed,
          category: result.category,
          confidence: result.confidence,
          provider: this.provider.name,
        },
        manager,
      );
    });

    return {
      category: result.category,
      confidence: result.confidence,
      requestId: requestId ?? null,
    };
  }

  // Whatever a provider does wrong is a bad gateway, not a bug in this service.
  private async askProvider(message: string) {
    let suggestion: unknown;
    try {
      suggestion = await this.provider.classify(message);
    } catch (error) {
      this.logger.error(
        `Classification provider "${this.provider.name}" failed`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new BadGatewayException(`Classification provider "${this.provider.name}" failed`);
    }

    if (!isClassificationResult(suggestion)) {
      this.logger.error(
        `Classification provider "${this.provider.name}" returned ${JSON.stringify(suggestion)}`,
      );
      throw new BadGatewayException(
        `Classification provider "${this.provider.name}" returned an invalid result`,
      );
    }
    return suggestion;
  }
}
