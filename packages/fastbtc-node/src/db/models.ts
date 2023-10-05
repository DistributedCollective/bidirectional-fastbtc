import {
    BeforeUpdate,
    Column,
    Entity,
    EntityRepository,
    Index,
    PrimaryColumn,
    PrimaryGeneratedColumn,
    Repository,
    Unique,
} from 'typeorm';
import {BigNumber} from 'ethers';
import {BigNumberColumn} from './utils';

/**
 * A bare-bones model to store arbitrary data. Don't use directly -- use KeyValuePairRepository
 */
@Entity()
export class KeyValuePair {
    @PrimaryColumn()
    key!: string;

    @Column('jsonb')
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

// NOTE: this must match the status enum in the FastBTCBridge smart contract
export enum TransferStatus {
    Null = 0,
    New = 1, // New transfer in blockchain
    Sending = 2, // Sending to BTC
    Mined = 3,
    Refunded = 4,
    Reclaimed = 5,
    Invalid = 255,
}

/**
 * A rBTC to BTC transfer. Corresponds (almost) directly to the BitcoinTransfer event from FastBTCBridge.sol
 */
@Entity()
@Unique('btcaddress_nonce_uq', ['btcAddress', 'nonce'])
@Index(['rskBlockNumber', 'rskTransactionIndex', 'rskLogIndex'], {unique: true})
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

    @Column('timestamp with time zone', {nullable: false, default: () => 'CURRENT_TIMESTAMP'})
    createdAt!: Date;

    @Column('timestamp with time zone', {nullable: false, default: () => 'CURRENT_TIMESTAMP'})
    updatedAt!: Date;

    @BeforeUpdate()
    public setUpdatedAt() {
        this.updatedAt = new Date();
    }

    get totalAmountSatoshi(): BigNumber {
        return this.amountSatoshi.add(this.feeSatoshi);
    }
}

@Entity()
export class LogItem {
    @PrimaryGeneratedColumn({ name: 'id'})
    dbId!: number;

    @Column()
    type!: string;

    @Column('jsonb')
    data!: {[key: string]: any};

    @Column('timestamp with time zone', {nullable: false, default: () => 'CURRENT_TIMESTAMP'})
    createdAt!: Date;
}


/**
 * A bare-bones model to persist transfer batch data (not stored explicitly in RSK) to DB
 */
@Entity()
export class StoredBitcoinTransferBatch {
    @PrimaryGeneratedColumn({ name: 'id'})
    dbId!: number;

    @Column('jsonb')
    data!: {[key: string]: any};

    @Column({ default: false})
    finalized!: boolean;

    @Column('timestamp with time zone', {nullable: false, default: () => 'CURRENT_TIMESTAMP'})
    createdAt!: Date;
}


export interface CreateOrUpdateFromTransferBatchOpts {
    markFinalized?: boolean;
}
@EntityRepository(StoredBitcoinTransferBatch)
export class StoredBitcoinTransferBatchRepository extends Repository<StoredBitcoinTransferBatch> {
    async createOrUpdateFromTransferBatch(
        transferBatch: unknown & {transferIds: string[]},
        opts: CreateOrUpdateFromTransferBatchOpts = {}
    ): Promise<void> {
        let stored = await this.findByTransferIds(transferBatch.transferIds);
        if (!stored) {
            stored = new StoredBitcoinTransferBatch();
        }
        stored.data = transferBatch;
        if (opts.markFinalized) {
            stored.finalized = true;
        }
        await this.save(stored);
    }

    async findByTransferIds(transferIds: string[]): Promise<StoredBitcoinTransferBatch|undefined> {
        // TODO: this should compare the order too
        return await this
            .createQueryBuilder('batch')
            .where(`batch."data"->'transferIds' @> :transferIds AND batch."data"->'transferIds' <@ :transferIds`)
            .setParameters({
                transferIds: JSON.stringify(transferIds),
            })
            .getOne();
    }
}

/**
 * This model corresponds to the BitcoinTransferBatchSending event
 *
 * Nodes should only sign transfers in a batch that has a bitcoin transaction hash that has been committed
 * to the RSK smart contract to avoid double spending.
 */
@Entity()
@Index(['rskBlockNumber', 'rskTransactionIndex', 'rskLogIndex'], {unique: true})
export class TransferBatchCommitment {
    @PrimaryGeneratedColumn({ name: 'id'})
    dbId!: number;

    // Event args

    @Column({ unique: true })
    btcTransactionHash!: string;

    @Column('int', {nullable: false})
    transferBatchSize!: number;

    // Event data

    @Column({nullable: false})
    rskTransactionHash!: string;

    @Column({nullable: false})
    rskTransactionIndex!: number;

    @Column({nullable: false})
    rskLogIndex!: number;

    @Column({nullable: false})
    rskBlockHash!: string;

    @Column({nullable: false})
    rskBlockNumber!: number;

    // Metadata

    @Column('timestamp with time zone', {nullable: false, default: () => 'CURRENT_TIMESTAMP'})
    createdAt!: Date;
}

// remember to keep this up-to-date
export const ALL_MODELS = [
    KeyValuePair,
    Transfer,
    LogItem,
    StoredBitcoinTransferBatch,
    TransferBatchCommitment,
];
