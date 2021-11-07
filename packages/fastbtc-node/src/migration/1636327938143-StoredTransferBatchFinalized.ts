import {MigrationInterface, QueryRunner} from "typeorm";

export class StoredTransferBatchFinalized1636327938143 implements MigrationInterface {
    name = 'StoredTransferBatchFinalized1636327938143'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "public"."stored_bitcoin_transfer_batch" ADD "finalized" boolean NOT NULL DEFAULT false`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "public"."stored_bitcoin_transfer_batch" DROP COLUMN "finalized"`);
    }

}
