import {Entity, PrimaryColumn, PrimaryGeneratedColumn, Column, BaseEntity, EntityRepository, Repository} from 'typeorm';

@Entity()
export class KeyValuePair {
    @PrimaryColumn()
    key!: string;

    @Column("simple-json")
    value!: any;
}

@EntityRepository(KeyValuePair)
export class KeyValuePairRepository extends Repository<KeyValuePair> {
    async getValue<T = any>(key: string): Promise<T | undefined> {
        const keyValuePair = await this.findOne({ key });
        return keyValuePair?.value;
    }

    async setValue<T = any>(key: string, value: T): Promise<void> {
        let keyValuePair = await this.findOne({ key });
        if (!keyValuePair) {
            keyValuePair = await this.create({
                key,
                value,
            });
        } else {
            keyValuePair.value = value;
        }
        await this.save(keyValuePair);
    }

    async getOrCreateValue<T = any>(key: string, defaultValue: T): Promise<T> {
        let keyValuePair = await this.findOne({ key });
        if (!keyValuePair) {
            keyValuePair = await this.create({
                key,
                value: defaultValue,
            });
            await this.save(keyValuePair);
        }
        return keyValuePair!.value;
    }
}

@Entity()
export class Transfer {
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

// remember to keep this up-to-date
export const ALL_MODELS = [
    KeyValuePair,
    Transfer,
];
