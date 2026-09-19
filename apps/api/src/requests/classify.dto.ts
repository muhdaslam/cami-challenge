import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { ClassificationCategory } from './classification-provider';

export const MAX_MESSAGE_LENGTH = 2000;

export class ClassifyRequestDto {
  // Decorators run bottom-up and the pipe reports only the first failure, so the type check
  // goes last. The length limit is measured on the raw text, before trimming.
  @MaxLength(MAX_MESSAGE_LENGTH)
  @Matches(/\S/, { message: 'message must not be blank' })
  @IsString()
  message!: string;

  @IsOptional()
  @IsUUID()
  requestId?: string;
}

export type ClassifyResponse = {
  category: ClassificationCategory;
  confidence: number;
  requestId: string | null;
};
