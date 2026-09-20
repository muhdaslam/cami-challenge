import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  CLASSIFICATION_LOG,
  ClassificationHistoryFacets,
  ClassificationHistoryFilter,
  ClassificationHistoryPage,
  ClassificationLog,
  InvalidCursorError,
} from './classification-log';
import { DEFAULT_HISTORY_LIMIT, HistoryFilterDto, HistoryQueryDto } from './history-query.dto';

// What a single field's validation cannot see: filters that only make sense together.
function toFilter(dto: HistoryFilterDto): ClassificationHistoryFilter {
  const { category, provider, requestId, adHoc, from, to, minConfidence, maxConfidence, q } = dto;

  if (requestId && adHoc === true) {
    throw new BadRequestException('requestId cannot be combined with adHoc=true');
  }
  if (from && to && Date.parse(from) >= Date.parse(to)) {
    throw new BadRequestException('from must be earlier than to');
  }
  if (minConfidence !== undefined && maxConfidence !== undefined && minConfidence > maxConfidence) {
    throw new BadRequestException('minConfidence must not be greater than maxConfidence');
  }

  return {
    category,
    provider,
    requestId,
    adHoc,
    from: from ? new Date(from) : undefined,
    to: to ? new Date(to) : undefined,
    minConfidence,
    maxConfidence,
    text: q,
  };
}

@Injectable()
export class ClassificationHistoryService {
  constructor(@Inject(CLASSIFICATION_LOG) private readonly log: ClassificationLog) {}

  async list(dto: HistoryQueryDto): Promise<ClassificationHistoryPage> {
    const { limit = DEFAULT_HISTORY_LIMIT, cursor } = dto;
    const filter = toFilter(dto);

    try {
      return await this.log.list({ ...filter, limit, cursor });
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  facets(dto: HistoryFilterDto): Promise<ClassificationHistoryFacets> {
    return this.log.facets(toFilter(dto));
  }
}
