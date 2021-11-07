import {MigrationInterface, QueryRunner} from "typeorm";

export class TransferEventIndex1636316808855 implements MigrationInterface {
    name = 'TransferEventIndex1636316808855'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_13e4021888aa27af3459659665" ON "public"."transfer" ("rsk_block_number", "rsk_transaction_index", "rsk_log_index") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_13e4021888aa27af3459659665"`);
    }
}
