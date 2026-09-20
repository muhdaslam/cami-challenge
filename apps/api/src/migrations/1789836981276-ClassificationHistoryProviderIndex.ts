import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassificationHistoryProviderIndex1789836981276 implements MigrationInterface {
  name = 'ClassificationHistoryProviderIndex1789836981276';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The history filtered by provider, newest first. Without it a provider whose few rows are
    // all old (one that has been replaced) is found by scanning the whole table: 6.6 ms at 200k
    // rows and growing, against 0.05 ms and constant with the index.
    //
    // A plain CREATE INDEX blocks inserts while it builds, which is instant at this size. On a
    // big table build it with CREATE INDEX CONCURRENTLY, which cannot run inside the
    // transaction TypeORM wraps a migration in, so that needs a migration of its own.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_classification_history_provider_created_at
      ON classification_history(provider, created_at DESC, id DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS idx_classification_history_provider_created_at;`);
  }
}
