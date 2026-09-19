import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RequestsModule } from './requests/requests.module';
import { ClassificationRecord } from './requests/classification-record.entity';
import { CustomerRequest } from './requests/customer-request.entity';
import { RequestNote } from './requests/request-note.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL ?? 'postgres://cami:cami@localhost:5432/cami',
      entities: [CustomerRequest, RequestNote, ClassificationRecord],
      synchronize: false,
      logging: ['query'],
    }),
    RequestsModule,
  ],
})
export class AppModule {}
