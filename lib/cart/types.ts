export type CartLine = {
  variant_id: string;
  product_id: string;
  slug: string;
  title: string;
  sku: string;
  size: string;
  color: string;
  color_hex: string | null;
  unit_price_minor: number;
  quantity: number;
  line_total_minor: number;
  available: number;
  purchasable: boolean;
  is_demo: boolean;
};

export type Cart = {
  currency: "BDT";
  items: CartLine[];
  item_count: number;
  subtotal_minor: number;
};

export const EMPTY_CART: Cart = { currency: "BDT", items: [], item_count: 0, subtotal_minor: 0 };
