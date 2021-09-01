import { Entity, PrimaryGeneratedColumn, Column, BaseEntity } from 'typeorm';

@Entity()
export class Transfer extends BaseEntity {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    btcAddress!: string;

    @Column()
    rskAddress!: string;

    @Column()
    amountSatoshi!: string;

    @Column()
    feeSatoshi!: string;
}
