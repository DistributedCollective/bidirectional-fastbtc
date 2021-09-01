import React from 'react';
import './App.css';
import ConnectWalletWrapper from './ConnectWalletWrapper';
import TransferForm from './TransferForm';

function App() {
  return (
    <div className="App">
        <h1>FastBTC 2 proto</h1>
        <ConnectWalletWrapper>
            <TransferForm />
        </ConnectWalletWrapper>
    </div>
  );
}

export default App;
