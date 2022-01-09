#!/bin/bash

mkdir -p flatten
rm -f flatten/*

function flatten_file() {
    full_file_name="contracts/$1/$2.sol"
    echo "${full_file_name} => flatten/$2.txt"
    npx hardhat flatten ${full_file_name} > flatten/$2.tmp
    grep -v SPDX flatten/$2.tmp > flatten/$2.txt
}

flatten_file "mocks" "Erc20Mock"
flatten_file "protocol" "Controller"
flatten_file "protocol" "MatrixTokenFactory"
flatten_file "protocol" "IntegrationRegistry"
flatten_file "protocol" "PriceOracle"
flatten_file "protocol" "MatrixValuer"
flatten_file "protocol/modules" "BasicIssuanceModule"

rm -f flatten/*.tmp

echo
echo "Create files in directory flatten OK. Please visit https://kovan.etherscan.io/ to verify contracts"
echo
