import React from 'react';
import {useEthers} from '@usedapp/core';
import {Button} from './forms';

interface ConnectWalletWrapperProps {
}
const ConnectWalletWrapper: React.FC<ConnectWalletWrapperProps> = ({
    children,
}) => {
    const { activateBrowserWallet, deactivate, account } = useEthers();
    const [error, setError] = React.useState<Error|null>(null);

    return (
        <div className="ConnectWalletWrapper">
            {error && (
                <div>Error: {error.message}</div>
            )}

            {!account ? (
                <Button onClick={() => {
                    setError(null);
                    activateBrowserWallet(setError)
                }}>Connect wallet</Button>
            ) : (
                <div>
                    <div>
                        <small>
                            <code>{account}</code>{' '}
                            <span style={{cursor: 'pointer'}} onClick={() => deactivate()}>(disconnect)</span>
                        </small>
                    </div>
                    <div>
                        {children}
                    </div>
                </div>
            )}
        </div>
    )
}
export default ConnectWalletWrapper;
