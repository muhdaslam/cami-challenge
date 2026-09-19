import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerRequest } from './customer-request.entity';
import { RequestNote } from './request-note.entity';
import { ClassificationHistoryService } from './classification-history.service';
import { CLASSIFICATION_PROVIDER } from './classification-provider';
import { ClassificationRecord } from './classification-record.entity';
import { ClassificationService } from './classification.service';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { KeywordClassifier } from './keyword-classifier';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerRequest, RequestNote, ClassificationRecord])],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    ClassificationService,
    ClassificationHistoryService,
    KeywordClassifier,
    // The one place that picks the provider: point this at another implementation to swap it.
    { provide: CLASSIFICATION_PROVIDER, useExisting: KeywordClassifier },
  ],
})
export class RequestsModule {}
