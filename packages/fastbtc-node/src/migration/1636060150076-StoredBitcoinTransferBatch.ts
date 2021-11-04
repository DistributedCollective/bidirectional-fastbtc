import {MigrationInterface, QueryRunner} from "typeorm";

export class StoredBitcoinTransferBatch1636060150076 implements MigrationInterface {
    name = 'StoredBitcoinTransferBatch1636060150076'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "stored_bitcoin_transfer_batch" ("id" SERIAL NOT NULL, "status" integer NOT NULL, "data" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_60775b89b2cd2fc3e7a78050ed8" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "stored_bitcoin_transfer_batch"`);
    }

}
