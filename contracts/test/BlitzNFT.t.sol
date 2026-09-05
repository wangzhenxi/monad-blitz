// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlitzNFT} from "../src/BlitzNFT.sol";

contract BlitzNFTTest is Test {
    BlitzNFT internal nft;

    uint256 internal constant PRICE = 0.1 ether;
    uint256 internal constant MAX_SUPPLY = 1_000;
    string internal constant BASE_URI = "https://example.com/api/metadata/";
    address internal user = makeAddr("user");
    address internal owner = makeAddr("owner");

    function setUp() public {
        vm.prank(owner);
        nft = new BlitzNFT("Monad Blitz", "BLITZ", BASE_URI, PRICE, MAX_SUPPLY);
    }

    function test_ConstructorSetsMetadata() public view {
        assertEq(nft.name(), "Monad Blitz");
        assertEq(nft.symbol(), "BLITZ");
        assertEq(nft.owner(), owner);
        assertEq(nft.MINT_PRICE(), PRICE);
        assertEq(nft.MAX_SUPPLY(), MAX_SUPPLY);
        assertEq(nft.totalSupply(), 0);
    }

    function test_MintSingleAssignsSequentialIds() public {
        assertEq(nft.totalSupply(), 0);
        vm.deal(user, 10 ether);
        vm.prank(user);
        nft.mint{value: PRICE}(1);
        assertEq(nft.ownerOf(1), user);
        assertEq(nft.totalSupply(), 1);
    }

    function test_MintMultiple() public {
        vm.deal(user, 10 ether);
        vm.prank(user);
        nft.mint{value: PRICE * 3}(3);
        assertEq(nft.balanceOf(user), 3);
        assertEq(nft.ownerOf(1), user);
        assertEq(nft.ownerOf(2), user);
        assertEq(nft.ownerOf(3), user);
        assertEq(nft.totalSupply(), 3);
    }

    function test_MintWrongPriceReverts() public {
        vm.deal(user, 10 ether);
        vm.prank(user);
        vm.expectRevert(BlitzNFT.WrongMintPrice.selector);
        nft.mint{value: PRICE - 1 wei}(1);
    }

    function test_MintZeroQuantityReverts() public {
        vm.prank(user);
        vm.expectRevert(BlitzNFT.InvalidQuantity.selector);
        nft.mint(0);
    }

    function test_MintExceedingSupplyReverts() public {
        vm.deal(user, PRICE * (MAX_SUPPLY + 1));
        vm.prank(user);
        vm.expectRevert(BlitzNFT.SoldOut.selector);
        nft.mint{value: PRICE * (MAX_SUPPLY + 1)}(MAX_SUPPLY + 1);
    }

    function test_MintToExactCapThenRevert() public {
        vm.deal(user, PRICE * MAX_SUPPLY);
        vm.prank(user);
        nft.mint{value: PRICE * MAX_SUPPLY}(MAX_SUPPLY);
        assertEq(nft.totalSupply(), MAX_SUPPLY);

        vm.deal(user, PRICE);
        vm.prank(user);
        vm.expectRevert(BlitzNFT.SoldOut.selector);
        nft.mint{value: PRICE}(1);
    }

    function test_TokenURIConcatenatesBaseAndId() public {
        vm.deal(user, 10 ether);
        vm.prank(user);
        nft.mint{value: PRICE * 2}(2);
        assertEq(nft.tokenURI(1), "https://example.com/api/metadata/1");
        assertEq(nft.tokenURI(2), "https://example.com/api/metadata/2");
    }

    function test_SetBaseURIOnlyOwner() public {
        vm.deal(user, PRICE);
        vm.prank(user);
        nft.mint{value: PRICE}(1);

        vm.prank(user);
        vm.expectRevert();
        nft.setBaseURI("ipfs://new/");

        vm.prank(owner);
        nft.setBaseURI("ipfs://new/");
        assertEq(nft.tokenURI(1), "ipfs://new/1");
    }

    function test_WithdrawOnlyOwner() public {
        vm.deal(user, PRICE);
        vm.prank(user);
        nft.mint{value: PRICE}(1);

        assertEq(address(nft).balance, PRICE);
        vm.prank(user);
        vm.expectRevert();
        nft.withdraw(user);

        vm.prank(owner);
        nft.withdraw(owner);
        assertEq(owner.balance, PRICE);
        assertEq(address(nft).balance, 0);
    }

    function test_ReentrancyBlockedViaMaliciousReceiver() public {
        ReentrantAttacker attacker = new ReentrantAttacker(nft);
        vm.deal(address(attacker), PRICE);
        attacker.attack();
        // First mint succeeded, reentrant mint reverted.
        assertEq(nft.totalSupply(), 1);
        assertEq(nft.ownerOf(1), address(attacker));
    }
}

contract ReentrantAttacker {
    BlitzNFT internal immutable nft;

    constructor(BlitzNFT nft_) {
        nft = nft_;
    }

    function attack() external {
        nft.mint{value: nft.MINT_PRICE()}(1);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external returns (bytes4) {
        // Attempt reentrant mint while the outer mint is still executing.
        try nft.mint{value: nft.MINT_PRICE()}(1) {
            revert("reentrancy not blocked");
        } catch {
            // expected: ReentrancyGuard reverts
        }
        return this.onERC721Received.selector;
    }
}
