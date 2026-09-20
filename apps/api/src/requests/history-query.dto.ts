import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { CLASSIFICATION_CATEGORIES, ClassificationCategory } from './classification-provider';

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;
export const MAX_SEARCH_LENGTH = 100;

// Query strings arrive as text. An empty value must not quietly turn into 0 or false.
const toNumber = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? Number.NaN : Number(value)) : value;
const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;
const trimmed = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// On every field below, only the first failed check is reported and decorators run bottom-up, so
// the "is a string / number / whole number" check is the last decorator.

/** The filters the list and the facets share. */
export class HistoryFilterDto {
  @IsOptional()
  @IsIn(CLASSIFICATION_CATEGORIES)
  category?: ClassificationCategory;

  @IsOptional()
  @Length(1, 64)
  @IsString()
  provider?: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  adHoc?: boolean;

  // Kept as text here; the service turns them into dates. `from` is inclusive, `to` exclusive.
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Transform(toNumber)
  @Max(1)
  @Min(0)
  @IsNumber()
  minConfidence?: number;

  @IsOptional()
  @Transform(toNumber)
  @Max(1)
  @Min(0)
  @IsNumber()
  maxConfidence?: number;

  // A case-insensitive substring of the classified text.
  @IsOptional()
  @Transform(trimmed)
  @Length(1, MAX_SEARCH_LENGTH)
  @IsString()
  q?: string;
}

export class HistoryQueryDto extends HistoryFilterDto {
  @IsOptional()
  @Type(() => Number)
  @Max(MAX_HISTORY_LIMIT)
  @Min(1)
  @IsInt()
  limit?: number;

  // The `nextCursor` of the previous page.
  @IsOptional()
  @IsUUID()
  cursor?: string;
}
