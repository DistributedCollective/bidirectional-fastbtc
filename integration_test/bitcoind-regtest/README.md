Local Bitcoin network for integration tests
===========================================

You don't need to read this README unless you're developing stuff related to the integration tests -- everything will
be handled under the hood using docker by the testing scripts.

Starting bitcoind regtest
-------------------------

```shell
cd THIS_DIRECTORY
bitcoind -conf=$PWD/bitcoin.conf
```

Creating a new Bitcoin multisig
-------------------------------

bitcoind regtest must be running.

Create a random wallet
```shell
bitcoin-cli -conf=$PWD/bitcoin.conf createwallet wallet1
bitcoin-cli -conf=$PWD/bitcoin.conf -rpcwallet=wallet1 dumpwallet wallet1.txt
```

Open `wallet1.txt`, note the `# extended private masterkey: tprv...` line, and the line that has `hdseed=1`:

```shell
# extended private masterkey: tprv8ZgxMBicQKsPdLiVtqrvinq5JyvByQZs4xWMgzZ3YWK7ndu27yQ3qoWivh8cgdtB3bKuYKWRKhaEvtykaFCsDCB7akNdcArjgrCnFhuDjmV
cTj4tA23bVHAnA42bYGGPfv13G2dfuChxtenJKsZffkCVMvofcfC 2021-10-08T13:44:47Z hdseed=1 # addr=bcrt1qupfx6n06gjyrzug3v5xjdqa5vyfxpsa9stuu66
```
(NOTE: these values are "known" secrets that we only use with local bitcoind regtest network -- they are not "leaked"
but do not use them in production!)

The extended private masterkey can be used in places in the config where it requires a master private key, such as
`FASTBTC_BTC_MASTER_PRIVATE_KEY`.

The hdseed can be used to re-create this wallet deterministically in `docker-entrypoint.sh`:

```shell
bitcoin-cli createwallet wallet1 false true || true
bitcoin-cli -rpcwallet=wallet1 sethdseed true "cTj4tA23bVHAnA42bYGGPfv13G2dfuChxtenJKsZffkCVMvofcfC"
```

Get the xpub and derived public key (using Python and the bip32 library)

```python
from bip32 import BIP32
xprv = "tprv8ZgxMBicQKsPdLiVtqrvinq5JyvByQZs4xWMgzZ3YWK7ndu27yQ3qoWivh8cgdtB3bKuYKWRKhaEvtykaFCsDCB7akNdcArjgrCnFhuDjmV"
key = BIP32.from_xpriv(xprv)
pubkey = key.get_pubkey_from_path('m/0/0/0').hex()  # where m/0/0/0 is FASTBTC_BTC_KEY_DERIVATION_PATH, default m/0/0/0
print(pubkey)
# pubkey looks something like 02f2bfc7a7d86f04d675083c7157d95c5741e85ff69b0c1357059fe1ee52271218, note it down
xpub = key.get_xpub()
print(xpub)
# xpub looks something like tpubD6NzVbkrYhZ4WokHnVXX8CVBt1S88jkmeG78yWbLxn7Wd89nkNDe2J8b6opP4K38mRwXf9d9VVN5uA58epPKjj584R1rnDDbk6oHUD1MoWD
# also note it down
```

Repeat the above for as many wallets as you want in the multisig.

Create the multisig:

```shell
# All derived pubkeys from above go in this variable as a JSON array
# This should be sorted
PUBKEYS='["02b6255b46857398e2042ad46bae5bcd5e8f288cc2871cb2a54e4ddc1443c5dc41","02f2bfc7a7d86f04d675083c7157d95c5741e85ff69b0c1357059fe1ee52271218"]'
# How many required signers out of all pubkeys
NUM_REQUIRED=2
bitcoin-cli -conf=$PWD/bitcoin.conf createmultisig $NUM_REQUIRED "$PUBKEYS" bech32
```

Note the address from the output

```shell
MULTISIG_ADDRESS=""  # put the address here
bitcoin-cli -conf=$PWD/bitcoin.conf createwallet mymultisig true true
bitcoin-cli -conf=$PWD/bitcoin.conf -rpcwallet=mymultisig importaddress "$MULTISIG_ADDRESS"
```
