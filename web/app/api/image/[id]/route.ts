import { NextRequest } from "next/server";

function hueFor(tokenId: number, offset: number) {
  return (tokenId * 137 + offset) % 360;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const tokenId = Number(id);
  if (!Number.isInteger(tokenId) || tokenId < 1 || tokenId > 1_000_000) {
    return new Response("Not found", { status: 404 });
  }

  const hue1 = hueFor(tokenId, 0);
  const hue2 = hueFor(tokenId, 90);
  const hue3 = hueFor(tokenId, 200);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="hsl(${hue1}, 85%, 55%)"/>
      <stop offset="50%" stop-color="hsl(${hue2}, 80%, 50%)"/>
      <stop offset="100%" stop-color="hsl(${hue3}, 75%, 45%)"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="32" fill="url(#g)"/>
  <circle cx="256" cy="216" r="88" fill="rgba(255,255,255,0.22)"/>
  <path d="M256 148 L 308 216 L 256 284 L 204 216 Z" fill="rgba(255,255,255,0.85)"/>
  <text x="256" y="392" text-anchor="middle" font-family="monospace" font-size="40" font-weight="bold" fill="white">Monad Blitz</text>
  <text x="256" y="444" text-anchor="middle" font-family="monospace" font-size="32" fill="rgba(255,255,255,0.8)">#${tokenId}</text>
</svg>`;

  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
