// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BlitzNFT — fixed-price public mint NFT on Monad
/// @notice OpenZeppelin ERC-721 with a fixed-price public mint, capped supply,
/// and owner-settable base URI (metadata lives offchain).
contract BlitzNFT is ERC721, Ownable, ReentrancyGuard {
    uint256 public immutable MINT_PRICE;
    uint256 public immutable MAX_SUPPLY;

    uint256 public totalSupply;
    string private _baseTokenURI;

    error SoldOut();
    error WrongMintPrice();
    error InvalidQuantity();
    error WithdrawFailed();

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseTokenURI_,
        uint256 mintPrice_,
        uint256 maxSupply_
    ) ERC721(name_, symbol_) Ownable(msg.sender) {
        MINT_PRICE = mintPrice_;
        MAX_SUPPLY = maxSupply_;
        _baseTokenURI = baseTokenURI_;
    }

    /// @notice Mint `quantity` tokens for exactly MINT_PRICE * quantity.
    function mint(uint256 quantity) external payable nonReentrant {
        if (quantity == 0) revert InvalidQuantity();
        if (totalSupply + quantity > MAX_SUPPLY) revert SoldOut();
        if (msg.value != MINT_PRICE * quantity) revert WrongMintPrice();

        uint256 tokenId = totalSupply;
        for (uint256 i; i < quantity; ++i) {
            ++tokenId;
            _safeMint(msg.sender, tokenId);
        }
        totalSupply = tokenId;
    }

    /// @notice Owner can repoint the base URI (e.g. from app metadata route to IPFS).
    function setBaseURI(string calldata baseTokenURI_) external onlyOwner {
        _baseTokenURI = baseTokenURI_;
    }

    /// @notice Owner withdraws the collected mint proceeds.
    function withdraw(address to) external onlyOwner nonReentrant {
        uint256 amount = address(this).balance;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
