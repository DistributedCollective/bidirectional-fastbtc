import {MigrationInterface, QueryRunner} from "typeorm";

export class Initial1635806092097 implements MigrationInterface {
    name = 'Initial1635806092097'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "key_value_pair" ("key" character varying NOT NULL, "value" text NOT NULL, CONSTRAINT "PK_4cc3ea8f17c6ea4901df01228fe" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "transfer" ("id" SERIAL NOT NULL, "transfer_id" character varying NOT NULL, "status" integer NOT NULL, "btc_address" character varying NOT NULL, "nonce" integer NOT NULL, "amount_satoshi" bigint NOT NULL, "fee_satoshi" bigint NOT NULL, "rsk_address" character varying NOT NULL, "rsk_transaction_hash" character varying NOT NULL, "rsk_transaction_index" integer NOT NULL, "rsk_log_index" integer NOT NULL, "rsk_block_number" integer NOT NULL, "btc_transaction_hash" character varying NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_7aa3769048ff14716eb5e0939e1" UNIQUE ("transfer_id"), CONSTRAINT "btcaddress_nonce_uq" UNIQUE ("btc_address", "nonce"), CONSTRAINT "PK_fd9ddbdd49a17afcbe014401295" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "transfer"`);
        await queryRunner.query(`DROP TABLE "key_value_pair"`);
    }

}
