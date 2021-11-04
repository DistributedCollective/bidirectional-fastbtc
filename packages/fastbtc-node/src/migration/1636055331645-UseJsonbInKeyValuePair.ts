import {MigrationInterface, QueryRunner} from "typeorm";

export class UseJsonbInKeyValuePair1636055331645 implements MigrationInterface {
    name = 'UseJsonbInKeyValuePair1636055331645';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "key_value_pair" ALTER COLUMN "value" TYPE jsonb USING value::jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "key_value_pair" ALTER COLUMN "value" TYPE text USING value::text`);
    }

}
