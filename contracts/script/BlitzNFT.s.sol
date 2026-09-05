// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {BlitzNFT} from "../src/BlitzNFT.sol";

contract BlitzNFTScript is Script {
    function run() public returns (BlitzNFT nft) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory baseTokenURI = vm.envOr("BASE_TOKEN_URI", string("https://monad-blitz.example.com/api/metadata/"));
        uint256 mintPrice = vm.envOr("MINT_PRICE", uint256(0.1 ether));
        uint256 maxSupply = vm.envOr("MAX_SUPPLY", uint256(1_000));

        vm.startBroadcast(deployerPrivateKey);
        nft = new BlitzNFT("Monad Blitz", "BLITZ", baseTokenURI, mintPrice, maxSupply);
        vm.stopBroadcast();
    }
}
