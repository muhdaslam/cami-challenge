import { DataSource } from 'typeorm';
import { ClassificationRecord } from './requests/classification-record.entity';
import { CustomerRequest } from './requests/customer-request.entity';
import { RequestNote } from './requests/request-note.entity';
import { InitialSchema1710000000000 } from './migrations/1710000000000-InitialSchema';
import { ClassificationHistory1789821338890 } from './migrations/1789821338890-ClassificationHistory';
import { ClassificationHistoryProviderIndex1789836981276 } from './migrations/1789836981276-ClassificationHistoryProviderIndex';

export function createDataSource() {
  return new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL ?? 'postgres://cami:cami@localhost:5432/cami',
    entities: [CustomerRequest, RequestNote, ClassificationRecord],
    migrations: [
      InitialSchema1710000000000,
      ClassificationHistory1789821338890,
      ClassificationHistoryProviderIndex1789836981276,
    ],
    synchronize: false,
    logging: false,
  });
}
