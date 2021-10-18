import React from 'react';
import {useContractCall, useContractFunction, useDebounce, useEtherBalance, useEthers} from '@usedapp/core';
import {BigNumber} from 'ethers';
import {parseEther, formatEther, formatUnits} from 'ethers/lib/utils';

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
    const [transferInProgress, setTransferInProgress] = React.useState(false);

    const debouncedTransferAmountWei = useDebounce(transferAmountWei, 1000);
    const debouncedBtcAddress = useDebounce(btcAddress, 1000);
    const debounceInProgress = transferAmountWei !== debouncedTransferAmountWei || btcAddress !== debouncedBtcAddress;

    const [nextNonce] = useContractCall(
        debouncedBtcAddress && {
            abi: fastbtcBridge.interface,
            address: fastbtcBridge.address,
            method: 'getNextNonce',
            args: [debouncedBtcAddress],
        }
    ) ?? [];
    const [isValidBtcAddress] = useContractCall(
    debouncedBtcAddress && {
            abi: fastbtcBridge.interface,
            address: fastbtcBridge.address,
            method: 'isValidBtcAddress',
            args: [debouncedBtcAddress],
        }
    ) ?? [];
    const [feeWei] = useContractCall(
    debouncedTransferAmountWei && {
            abi: fastbtcBridge.interface,
            address: fastbtcBridge.address,
            method: 'calculateFeeWei',
            args: [debouncedTransferAmountWei],
        }
    ) ?? [];
    const [minTransferSatoshi] = useContractCall(
        {
            abi: fastbtcBridge.interface,
            address: fastbtcBridge.address,
            method: 'minTransferSatoshi',
            args: [],
        }
    ) ?? [];
    const [maxTransferSatoshi] = useContractCall(
        {
            abi: fastbtcBridge.interface,
            address: fastbtcBridge.address,
            method: 'maxTransferSatoshi',
            args: [],
        }
    ) ?? [];
    const {
        state: transferState,
        send: sendTransfer
    } = useContractFunction(
        fastbtcBridge as any, // TODO: https://github.com/EthWorks/useDApp/issues/263
        'transferToBtc'
    );

    //console.log('transferState', transferState);
    //console.log('sendTransfer', sendTransfer);

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

    const isValid = transferAmountWei && btcAddress;
    const isLoading = !feeWei || !nextNonce || !isValidBtcAddress;

    const submitTransfer = async () => {
        if(!isValid || isLoading || transferInProgress) {
            return;
        }
        setTransferInProgress(true);
        try {
            await sendTransfer(btcAddress, nextNonce, { value: transferAmountWei });
        } finally {
            setTransferInProgress(false);
        }
    }

    return (
        <div className="TransferForm">
            <h2>Transfer rBTC to BTC</h2>
            {rbtcBalance && (
                <div className="transfer-details">
                    rBTC balance: <code>{formatEther(rbtcBalance)}</code>
                </div>
            )}
            {minTransferSatoshi && maxTransferSatoshi && (
                <div className="transfer-details">
                    min <code>{formatUnits(minTransferSatoshi, 8)} rBTC</code>{' '}
                    max <code>{formatUnits(maxTransferSatoshi, 8)} rBTC</code>
                </div>
            )}
            <Input
                onValueChange={setTransferAmountWei}
                convertValue={convertAndValidateTransferAmount}
                description={
                    "rBTC transfer amount"
                }
            />
            <Input
                onValueChange={setBtcAddress}
                convertValue={validateBitcoinAddress}
                description="BTC address"
            />
            {isValid && (
                isLoading ? (
                    <div className="transfer-details">
                        <code>Loading...</code>
                    </div>
                ) : (
                    <div className="transfer-details">
                        Transfer <code>{formatEther(transferAmountWei)} rBTC</code> from <code>{account}</code><br/>
                        Receive <code>{formatEther(transferAmountWei.sub(feeWei))} BTC</code> to <code>{btcAddress}</code><br/>
                        Fee: <code>{formatEther(feeWei)} BTC</code>
                    </div>
                )
            )}
            <Button
                disabled={!isValid || isLoading || transferInProgress || debounceInProgress}
                onClick={submitTransfer}
            >
                Transfer
            </Button>
            {transferState.status !== 'None' && (
                <div className="transfer-details">
                    Transfer status: <strong>{transferState.status}</strong>
                    {transferState.transaction && (
                        <div>
                            Transaction: <code>{transferState.transaction.hash}</code>
                        </div>
                    )}
                    {transferState.errorMessage && (
                        <div>
                            Message: {transferState.errorMessage}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
export default TransferForm;
