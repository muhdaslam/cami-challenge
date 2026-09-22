import { MigrationInterface, QueryRunner } from 'typeorm';

export class ClassificationHistory1789821338890 implements MigrationInterface {
  name = 'ClassificationHistory1789821338890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS classification_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        request_id uuid NULL REFERENCES customer_requests(id) ON DELETE CASCADE,
        message text NOT NULL,
        category varchar(32) NOT NULL,
        confidence double precision NOT NULL,
        provider varchar(64) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      );
    `);

    // Unfiltered list, newest first.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_classification_history_created_at
      ON classification_history(created_at DESC, id DESC);
    `);

    // List filtered by category, newest first.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_classification_history_category_created_at
      ON classification_history(category, created_at DESC, id DESC);
    `);

    // One request's history, and the lookup behind ON DELETE CASCADE.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_classification_history_request_id
      ON classification_history(request_id, created_at DESC, id DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS classification_history;`);
  }
}
