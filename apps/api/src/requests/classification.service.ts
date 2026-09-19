import { Injectable } from '@nestjs/common';
import { applyClassificationRules } from './classification-rules';
import { ClassifyRequestDto, ClassifyResponse } from './classify.dto';
import { KeywordClassifier } from './keyword-classifier';
import { RequestsService } from './requests.service';

@Injectable()
export class ClassificationService {
  constructor(
    private readonly classifier: KeywordClassifier,
    private readonly requests: RequestsService,
  ) {}

  async classify({ message, requestId }: ClassifyRequestDto): Promise<ClassifyResponse> {
    const trimmed = message.trim();
    const result = applyClassificationRules(this.classifier.classify(trimmed), trimmed);

    if (requestId) {
      await this.requests.applyClassification(requestId, result);
    }

    return {
      category: result.category,
      confidence: result.confidence,
      requestId: requestId ?? null,
    };
  }
}
