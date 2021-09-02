import {ValueTransformer, Column, ColumnOptions} from 'typeorm';
import {BigNumber} from 'ethers';

export const bigNumberTransformer: ValueTransformer = {
    from: (value: string) => BigNumber.from(value),
    to: (value: BigNumber) => value.toString(),
}
export const BigNumberColumn = (opts: ColumnOptions = {}) => Column({
    type: 'bigint',
    transformer: bigNumberTransformer,
    ...opts
})
