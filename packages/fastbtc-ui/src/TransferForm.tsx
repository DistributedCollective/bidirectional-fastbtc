import React from 'react';
import {useEtherBalance, useEthers} from '@usedapp/core';
import {BigNumber} from 'ethers';
import {parseEther, formatEther} from 'ethers/lib/utils';

import {Input, Button} from './forms';
import {fastbtcBridge} from './contracts';

import './TransferForm.css';


const ONE_RBTC_IN_WEI = BigNumber.from('10').pow(18);
const ONE_BTC_IN_SATOSHI = BigNumber.from('10').pow(8);
const SATOSHI_DIVISOR = ONE_RBTC_IN_WEI.div(ONE_BTC_IN_SATOSHI);

const validateBitcoinAddress = (s: string): string => {
    // TODO: add validation here
    return s;
}

const TransferForm: React.FC = () => {
    const { account } = useEthers();
    const rbtcBalance = useEtherBalance(account);

    const [transferAmountWei, setTransferAmountWei] = React.useState<BigNumber|null>(null);
    const [btcAddress, setBtcAddress] = React.useState<string|null>(null);

    const convertAndValidateTransferAmount = (s: string) => {
        let wei;
        try {
            wei = parseEther(s);
        } catch (e) {
            throw new Error("Invalid amount");
        }

        if (rbtcBalance && wei.gt(rbtcBalance)) {
            throw new Error("Amount exceeds balance in wallet");
        }

        if (!wei.mod(SATOSHI_DIVISOR).isZero()) {
            throw new Error("Too precise amount");
        }

        return wei;
    }

    return (
        <div className="TransferForm">
            <h2>Transfer rBTC to BTC</h2>
            <Input
                onValueChange={setTransferAmountWei}
                convertValue={convertAndValidateTransferAmount}
                description={
                    "rBTC transfer amount" + (rbtcBalance ? ` (balance: ${formatEther(rbtcBalance)} RBTC)` : '')
                }
            />
            <Input
                onValueChange={setBtcAddress}
                convertValue={validateBitcoinAddress}
                description="BTC address"
            />
            <Button
                disabled={!transferAmountWei || !btcAddress}
            >
                Transfer
            </Button>
        </div>
    );
}
export default TransferForm;
