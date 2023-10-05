import {MigrationInterface, QueryRunner} from "typeorm";

export class TransferBatchCommitment1696485846526 implements MigrationInterface {
    name = 'TransferBatchCommitment1696485846526'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "transfer_batch_commitment" ("id" SERIAL NOT NULL, "btc_transaction_hash" character varying NOT NULL, "transfer_batch_size" integer NOT NULL, "rsk_transaction_hash" character varying NOT NULL, "rsk_transaction_index" integer NOT NULL, "rsk_log_index" integer NOT NULL, "rsk_block_hash" character varying NOT NULL, "rsk_block_number" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_6eb9e301e73d57a89ac7a5c09ec" UNIQUE ("btc_transaction_hash"), CONSTRAINT "PK_d6e3d706a9989dd4263a3bbbe06" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_ddc22b692d85fe9d5ea96ae569" ON "transfer_batch_commitment" ("rsk_block_number", "rsk_transaction_index", "rsk_log_index") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "IDX_ddc22b692d85fe9d5ea96ae569"`);
        await queryRunner.query(`DROP TABLE "transfer_batch_commitment"`);
    }

}
