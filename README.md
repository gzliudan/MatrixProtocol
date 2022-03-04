# Matrix Protocol

This project is forked from [set-protocol-v2](https://github.com/SetProtocol/set-protocol-v2).

## Install

```shell
git clone https://gitee.com/matrix-tech/MatrixProtocol
cd MatrixProtocol
yarn
```

## Compile

```shell
yarn compile
```

## Test

```shell
yarn test
```

## Setup config file

Create config file .env from .env.example, and edit it:

```shell
cp .env.example .env
vi .env
```

## Deploy

```shell
# for testnet mumbai
yarn deploy:mumbai

# for mainnet polygon
yarn deploy:polygon
```

## Verify

```shell
# for testnet mumbai
yarn verify:mumbai

# for mainnet polygon
yarn verify:polygon
```

## Setup admin roles

### 1. grant admin role to an account

```shell
# for testnet mumbai
yarn grantAdmin:mumbai ${ACCOUNT_ADDRESS}

# for mainnet polygon
yarn grantAdmin:polygon ${ACCOUNT_ADDRESS}
```

### 2. grant default admin role to an account

```shell
# for testnet mumbai
yarn grantDefaultAdmin:mumbai ${ACCOUNT_ADDRESS}

# for mainnet polygon
yarn grantDefaultAdmin:polygon ${ACCOUNT_ADDRESS}
```

### 3. revoke an account from admin role

```shell
# for testnet mumbai
yarn revokeAdmin:mumbai ${ACCOUNT_ADDRESS}

# for mainnet polygon
yarn revokeAdmin:polygon ${ACCOUNT_ADDRESS}
```

### 4. revoke an account from default admin role

```shell
# for testnet mumbai
yarn revokeDefaultAdmin:mumbai ${ACCOUNT_ADDRESS}

# for mainnet polygon
yarn revokeDefaultAdmin:polygon ${ACCOUNT_ADDRESS}
```
