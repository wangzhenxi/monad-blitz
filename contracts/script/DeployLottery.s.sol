// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {Lottery} from "src/Lottery.sol";

/// @dev 部署脚本：constructor 参数全部来自 env（见 docs/tech-design.md §6）
///      forge script script/DeployLottery.s.sol --rpc-url $MONAD_TESTNET_RPC --broadcast
contract DeployLottery is Script {
    function run() public {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address entropyAddr = vm.envAddress("ENTROPY_ADDRESS");
        address provider = vm.envAddress("ENTROPY_PROVIDER");

        // issuer：空串 = 线上无许可模式；地址串 = 线下验签模式
        string memory issuerStr = vm.envOr("ISSUER_ADDRESS", string(""));
        address issuer =
            bytes(issuerStr).length == 0 ? address(0) : vm.parseAddress(issuerStr);

        // 演示参数默认值：drawTime = now + 3 min，deposit = 10 MOD，timeout = 2 min，winnerCount = 3
        uint256 drawDelay = vm.envOr("DRAW_DELAY_SECONDS", uint256(3 minutes));
        uint256 deposit = vm.envOr("DEPOSIT_AMOUNT", uint256(10 ether));
        uint256 entropyTimeout = vm.envOr("ENTROPY_TIMEOUT", uint256(2 minutes));
        uint256 winnerCount = vm.envOr("WINNER_COUNT", uint256(3));

        vm.startBroadcast(deployerKey);
        Lottery lottery = new Lottery(
            issuer, entropyAddr, provider, block.timestamp + drawDelay, deposit, entropyTimeout, winnerCount
        );
        vm.stopBroadcast();

        console.log("Lottery deployed at:", address(lottery));
        console.log("issuer:", issuer);
        console.log("drawTime:", lottery.drawTime());
        console.log("winnerCount:", lottery.winnerCount());
    }
}
