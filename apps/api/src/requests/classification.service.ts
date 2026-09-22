import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  CLASSIFICATION_LOG,
  ClassificationLog,
  RequestNotFoundError,
} from './classification-log';
import { applyClassificationRules } from './classification-rules';
import {
  CLASSIFICATION_PROVIDER,
  ClassificationProvider,
  isClassificationResult,
} from './classification-provider';
import { ClassifyRequestDto, ClassifyResponse } from './classify.dto';

@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @Inject(CLASSIFICATION_PROVIDER) private readonly provider: ClassificationProvider,
    @Inject(CLASSIFICATION_LOG) private readonly log: ClassificationLog,
  ) {}

  async classify({ message, requestId }: ClassifyRequestDto): Promise<ClassifyResponse> {
    const trimmed = message.trim();
    const suggestion = await this.askProvider(trimmed);
    const result = applyClassificationRules(suggestion, trimmed);

    try {
      await this.log.record({
        requestId: requestId ?? null,
        message: trimmed,
        result,
        provider: this.provider.name,
      });
    } catch (error) {
      if (error instanceof RequestNotFoundError) {
        throw new NotFoundException(error.message);
      }
      throw error;
    }

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
