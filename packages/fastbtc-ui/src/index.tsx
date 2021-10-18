import React from 'react';
import ReactDOM from 'react-dom';
import {Config, DAppProvider, ChainId, CHAIN_NAMES} from '@usedapp/core';

import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import {configuredChainId, multicall} from './contracts';

// NOTE: RSK multicall: https://github.com/makerdao/multicall/pull/10
const config: Config = {
    readOnlyChainId: configuredChainId,
    readOnlyUrls: {
        31337: 'http://localhost:8545',
        30: 'https://public-node.rsk.co',
        31: 'https://public-node.testnet.rsk.co',
        // 31: 'https://testnet.sovryn.app/rpc',
    },
    multicallAddresses: {
        [configuredChainId]: multicall.address,
    },
    supportedChains: [configuredChainId],
    pollingInterval: 1,
};

// money-patch stuff. fun fun fun
(ChainId as any).RSK = 30;
(ChainId as any).RSKTestnet = 31;
(CHAIN_NAMES as any)[30] = 'RSK';
(CHAIN_NAMES as any)[31] = 'RSKTestnet';

// oh gawd, monkeypatch fetch
// see this issue: https://github.com/NoahZinsmeister/web3-react/issues/173
const originalFetch = window.fetch;
window.fetch = (url, opts): Promise<Response> => {
    if (url === config.readOnlyUrls![config.readOnlyChainId!] && opts) {
        opts.headers = opts.headers || {
            'Content-Type': 'application/json'
        };
    }
    return originalFetch(url, opts);
}

console.log('Config', config);

ReactDOM.render(
  <React.StrictMode>
      <DAppProvider config={config}>
          <App />
      </DAppProvider>
  </React.StrictMode>,
  document.getElementById('root')
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
