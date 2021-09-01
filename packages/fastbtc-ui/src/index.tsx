import React from 'react';
import ReactDOM from 'react-dom';
import {Config, DAppProvider} from '@usedapp/core';

import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';
import {configuredChainId, multicall} from './contracts';

// NOTE: RSK multicall: https://github.com/makerdao/multicall/pull/10
const config: Config = {
    readOnlyChainId: configuredChainId,
    readOnlyUrls: {
        [configuredChainId]: 'http://localhost:8545',  // local hardhat rpc. TODO: make it configurable
    },
    multicallAddresses: {
        [configuredChainId]: multicall.address,
    },
    supportedChains: [configuredChainId],
    pollingInterval: 1,
};
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
