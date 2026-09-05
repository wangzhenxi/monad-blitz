import { NextRequest } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 1_000_000) {
    return new Response("Not found", { status: 404 });
  }

  const image = new URL(`/api/image/${tokenId}`, request.url).toString();

  return Response.json({
    name: `Monad Blitz #${tokenId}`,
    description:
      "Monad Blitz — a fixed-price public mint NFT collection on Monad testnet. Fast blocks, instant receipts.",
    image,
    attributes: [
      { trait_type: "Token ID", value: tokenId },
      { trait_type: "Chain", value: "Monad Testnet" },
    ],
  });
}
