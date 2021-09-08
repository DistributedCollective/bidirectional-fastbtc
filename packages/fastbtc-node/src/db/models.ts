import {Column, Entity, EntityRepository, PrimaryColumn, PrimaryGeneratedColumn, Repository, Unique} from 'typeorm';
import {BigNumber} from 'ethers';
import {BigNumberColumn} from './utils';

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

export enum TransferStatus {
    New,
    Sending,
    Sent,
    Rejected,
}

@Entity()
@Unique('btcaddress_nonce_uq', ['btcAddress', 'nonce'])
export class Transfer {
    @PrimaryGeneratedColumn({ name: 'id'})
    dbId!: number;

    get transferId(): string {
        return `${this.btcAddress.toLowerCase()}:${this.nonce}`;
    }

    @Column('int')
    status!: TransferStatus;

    @Column()
    btcAddress!: string;

    @Column()
    nonce!: number;

    @BigNumberColumn()
    amountSatoshi!: BigNumber;

    @BigNumberColumn()
    feeSatoshi!: BigNumber;

    @Column()
    rskAddress!: string;

    @Column()
    rskTransactionHash!: string;

    @Column()
    rskTransactionIndex!: number;

    @Column()
    rskLogIndex!: number;

    @Column()
    rskBlockNumber!: number;

    @Column()
    btcTransactionHash!: string;
}

// remember to keep this up-to-date
export const ALL_MODELS = [
    KeyValuePair,
    Transfer,
];
