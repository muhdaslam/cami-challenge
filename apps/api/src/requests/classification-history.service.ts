import { Inject, Injectable } from '@nestjs/common';
import {
  CLASSIFICATION_LOG,
  ClassificationHistoryPage,
  ClassificationLog,
} from './classification-log';
import { DEFAULT_HISTORY_LIMIT, HistoryQueryDto } from './history-query.dto';

@Injectable()
export class ClassificationHistoryService {
  constructor(@Inject(CLASSIFICATION_LOG) private readonly log: ClassificationLog) {}

  list({
    category,
    requestId,
    limit = DEFAULT_HISTORY_LIMIT,
  }: HistoryQueryDto): Promise<ClassificationHistoryPage> {
    return this.log.list({ category, requestId, limit });
  }
}
