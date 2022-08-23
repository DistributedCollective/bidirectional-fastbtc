export interface ReplenisherSecrets {
    rpcPassword: string;
    masterPrivateKey: string|null;
    masterPublicKeys: string[];
}

export interface ReplenisherConfig {
    btcNetwork: 'mainnet' | 'testnet' | 'regtest';
    rpcUrl: string;
    rpcUserName: string;
    keyDerivationPath: string;
    numRequiredSigners: number;
    secrets: () => ReplenisherSecrets;
}
