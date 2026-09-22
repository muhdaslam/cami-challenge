import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerRequest } from './customer-request.entity';
import { RequestNote } from './request-note.entity';
import { CLASSIFICATION_LOG } from './classification-log';
import { ClassificationHistoryService } from './classification-history.service';
import { CLASSIFICATION_PROVIDER } from './classification-provider';
import { ClassificationRecord } from './classification-record.entity';
import { ClassificationService } from './classification.service';
import { REQUEST_STORE } from './request-store';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { KeywordClassifier } from './keyword-classifier';
import { TypeOrmClassificationLog } from './typeorm-classification-log';
import { TypeOrmRequestStore } from './typeorm-request-store';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerRequest, RequestNote, ClassificationRecord])],
  controllers: [RequestsController],
  providers: [
    RequestsService,
    ClassificationService,
    ClassificationHistoryService,
    KeywordClassifier,
    // The places that pick an implementation: point a token at another class to swap it.
    { provide: CLASSIFICATION_PROVIDER, useExisting: KeywordClassifier },
    { provide: REQUEST_STORE, useClass: TypeOrmRequestStore },
    { provide: CLASSIFICATION_LOG, useClass: TypeOrmClassificationLog },
  ],
})
export class RequestsModule {}
