import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CLASSIFICATION_CATEGORIES, ClassificationCategory } from './classification-provider';

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

export class HistoryQueryDto {
  @IsOptional()
  @IsIn(CLASSIFICATION_CATEGORIES)
  category?: ClassificationCategory;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  // Query strings arrive as text, hence @Type. Only the first failed check is reported and
  // decorators run bottom-up, so the "is a whole number" check goes last.
  @IsOptional()
  @Type(() => Number)
  @Max(MAX_HISTORY_LIMIT)
  @Min(1)
  @IsInt()
  limit?: number;
}

export type ClassificationHistoryItem = {
  id: string;
  requestId: string | null;
  message: string;
  category: ClassificationCategory;
  confidence: number;
  provider: string;
  createdAt: string;
};

export type ClassificationHistoryPage = {
  items: ClassificationHistoryItem[];
  // Every match, ignoring `limit`.
  total: number;
};
