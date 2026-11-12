import type { Metadata } from "next";
import { StorePage } from "@/components/shop/store-page";
import { WishlistGrid } from "@/components/shop/wishlist-grid";

export const metadata: Metadata = { title: "Wishlist", robots: { index: false } };

export default function WishlistPage() {
  return (
    <StorePage title="Wishlist" width="wide" intro="Pieces you saved with the heart. Kept in this browser only, no account needed.">
      <WishlistGrid />
    </StorePage>
  );
}
