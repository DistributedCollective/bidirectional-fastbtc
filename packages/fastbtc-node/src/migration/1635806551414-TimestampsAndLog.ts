import {MigrationInterface, QueryRunner} from "typeorm";

export class TimestampsAndLog1635806551414 implements MigrationInterface {
    name = 'TimestampsAndLog1635806551414'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "log_item" ("id" SERIAL NOT NULL, "type" character varying NOT NULL, "data" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_3f752d4ed86402411327566f5fe" PRIMARY KEY ("id"))`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "log_item"`);
    }

}
