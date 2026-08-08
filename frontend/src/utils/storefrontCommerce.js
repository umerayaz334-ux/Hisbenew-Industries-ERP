const CART_STORAGE_KEY = "hisbenewStorefrontCart";

export const formatUsdPrice = (value) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));

const cartProduct = (product) => ({
  id: Number(product.id),
  article_no: product.article_no || "",
  name: product.name || product.article_no || "Handmade knife",
  category: product.category || "Knife",
  price: Number(product.selling_price || 0),
  image_url: product.image_url || "",
  available_stock: Number(product.available_stock || 0),
});

export const normalizeCartItems = (items = []) =>
  (Array.isArray(items) ? items : [])
    .map((item) => ({
      id: Number(item.id),
      article_no: item.article_no || "",
      name: item.name || item.article_no || "Handmade knife",
      category: item.category || "Knife",
      price: Number(item.price || 0),
      image_url: item.image_url || "",
      available_stock: Number(item.available_stock || 0),
      quantity: Math.max(1, Number.parseInt(item.quantity, 10) || 1),
    }))
    .filter((item) => Number.isFinite(item.id) && item.id > 0);

export const readStorefrontCart = () => {
  if (typeof window === "undefined") return [];
  try {
    return normalizeCartItems(JSON.parse(window.localStorage.getItem(CART_STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
};

export const writeStorefrontCart = (items) => {
  const nextItems = normalizeCartItems(items);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(nextItems));
  }
  return nextItems;
};

export const addProductToCart = (items, product) => {
  const nextItems = normalizeCartItems(items);
  const nextProduct = cartProduct(product);
  const existing = nextItems.find((item) => item.id === nextProduct.id);
  if (existing) {
    existing.quantity += 1;
    return nextItems;
  }
  return [...nextItems, { ...nextProduct, quantity: 1 }];
};

export const setCartItemQuantity = (items, productId, quantity) =>
  normalizeCartItems(items)
    .map((item) => {
      if (item.id !== Number(productId)) return item;
      const nextQuantity = Number.parseInt(quantity, 10);
      return {
        ...item,
        quantity: Number.isFinite(nextQuantity) ? nextQuantity : 1,
      };
    })
    .filter((item) => item.quantity > 0);

export const removeCartItem = (items, productId) =>
  normalizeCartItems(items).filter((item) => item.id !== Number(productId));

export const cartSummary = (items = []) => {
  const normalized = normalizeCartItems(items);
  return {
    count: normalized.reduce((total, item) => total + item.quantity, 0),
    subtotal: normalized.reduce((total, item) => total + item.price * item.quantity, 0),
  };
};

export const checkoutMessage = (items, form = {}) => {
  const normalized = normalizeCartItems(items);
  const summary = cartSummary(normalized);
  const lines = [
    "Hisbenew website checkout request",
    `Name: ${String(form.name || "").trim() || "Not provided"}`,
    `Email: ${String(form.email || "").trim() || "Not provided"}`,
    `Phone: ${String(form.phone || "").trim() || "Not provided"}`,
    "",
    "Items:",
    ...normalized.map(
      (item) =>
        `- ${item.name} (${item.article_no || "No SKU"}) x ${item.quantity} = ${formatUsdPrice(
          item.price * item.quantity
        )}`
    ),
    "",
    `Subtotal: ${formatUsdPrice(summary.subtotal)}`,
    `Notes: ${String(form.notes || "").trim() || "None"}`,
  ];
  return lines.join("\n");
};
