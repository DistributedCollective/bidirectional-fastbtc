import {MigrationInterface, QueryRunner} from "typeorm";

export class Initial1632087942683 implements MigrationInterface {
    name = 'Initial1632087942683'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `CREATE TABLE "key_value_pair"
             (
                 "key"   text NOT NULL,
                 "value" text NOT NULL,
                 CONSTRAINT "pk_key_value_pair" PRIMARY KEY ("key")
             )`
        );
        await queryRunner.query(
            `CREATE TABLE "transfer"
             (
                 "id"                    SERIAL  NOT NULL,
                 "transfer_id"           text    NOT NULL,
                 "status"                integer NOT NULL,
                 "btc_address"           text    NOT NULL,
                 "nonce"                 integer NOT NULL,
                 "amount_satoshi"        bigint  NOT NULL,
                 "fee_satoshi"           bigint  NOT NULL,
                 "rsk_address"           text    NOT NULL,
                 "rsk_transaction_hash"  text    NOT NULL,
                 "rsk_transaction_index" integer NOT NULL,
                 "rsk_log_index"         integer NOT NULL,
                 "rsk_block_number"      integer NOT NULL,
                 "btc_transaction_hash"  text    NOT NULL,
                 CONSTRAINT "uq_transfer_id" UNIQUE ("transfer_id"),
                 CONSTRAINT "uq_transfer_btc_address_nonce" UNIQUE ("btc_address", "nonce"),
                 CONSTRAINT "pk_transfer" PRIMARY KEY ("id")
             )`
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP TABLE "transfer"`
        );
        await queryRunner.query(
            `DROP TABLE "key_value_pair"`
        );
    }

}
