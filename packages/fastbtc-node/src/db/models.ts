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
    Null = 0,
    New = 1, // New transfer in blockchain
    Sent = 2, // Sent to RSK/BTC
    Mined = 3,
    Refunded = 4,
    Reclaimed = 5,
}

@Entity()
@Unique('btcaddress_nonce_uq', ['btcAddress', 'nonce'])
export class Transfer {
    @PrimaryGeneratedColumn({ name: 'id'})
    dbId!: number;

    @Column({ unique: true })
    transferId!: string;

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

    get totalAmountSatoshi(): BigNumber {
        return this.amountSatoshi.add(this.feeSatoshi);
    }
}

// remember to keep this up-to-date
export const ALL_MODELS = [
    KeyValuePair,
    Transfer,
];
