import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import {
  DEFAULT_WEBSITE_SETTINGS,
  normalizeWebsiteSettings,
} from "../utils/websiteSettings";
import {
  addProductToCart,
  cartSummary,
  checkoutMessage,
  formatUsdPrice,
  readStorefrontCart,
  removeCartItem,
  setCartItemQuantity,
  writeStorefrontCart,
} from "../utils/storefrontCommerce";
import "./Website.css";

const fallbackCatalogImage =
  "https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=1800&q=85";

const setMetaTag = (selector, attrs) => {
  if (typeof document === "undefined") return;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    document.head.appendChild(tag);
  }
  Object.entries(attrs).forEach(([key, value]) => tag.setAttribute(key, value));
};

const applyCatalogSeo = (settings) => {
  if (typeof document === "undefined") return;
  document.title = `Catalog | ${settings.brand_name}`;
  setMetaTag('meta[name="description"]', {
    name: "description",
    content: settings.meta_description,
  });
  setMetaTag('meta[name="keywords"]', {
    name: "keywords",
    content: settings.meta_keywords,
  });
};

const productImageUrl = (product) =>
  product?.image_url ? getStaticUrl(product.image_url) : null;

const sortProducts = (products, settings) => {
  const hidden = new Set(settings.hidden_product_ids || []);
  const orderIndex = new Map(
    (settings.product_order_ids || []).map((id, index) => [Number(id), index])
  );

  return [...products]
    .filter((product) => !hidden.has(Number(product.id)))
    .sort((a, b) => {
      const aOrder = orderIndex.has(Number(a.id)) ? orderIndex.get(Number(a.id)) : 9999;
      const bOrder = orderIndex.has(Number(b.id)) ? orderIndex.get(Number(b.id)) : 9999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.category || "").localeCompare(String(b.category || "")) ||
        String(a.article_no || a.name || "").localeCompare(String(b.article_no || b.name || ""));
    });
};

const checkoutHrefForSettings = (settings, cartItems, checkoutForm) => {
  if (!cartItems.length) return "#checkout";
  const message = checkoutMessage(cartItems, checkoutForm);
  const encodedMessage = encodeURIComponent(message);
  if (settings.whatsapp) {
    return `https://wa.me/${String(settings.whatsapp).replace(/\D/g, "")}?text=${encodedMessage}`;
  }
  if (settings.email) {
    return `mailto:${settings.email}?subject=${encodeURIComponent("Hisbenew website order request")}&body=${encodedMessage}`;
  }
  if (settings.phone) return `tel:${settings.phone}`;
  return "/#contact";
};

function WebsiteCatalog() {
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WEBSITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [cartItems, setCartItems] = useState([]);
  const [checkoutForm, setCheckoutForm] = useState({
    name: "",
    email: "",
    phone: "",
    notes: "",
  });
  const [checkoutNotice, setCheckoutNotice] = useState("");

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      api.get("/website-products"),
      api.get("/website-settings"),
    ]).then(([productsResult, settingsResult]) => {
      if (!active) return;

      if (productsResult.status === "fulfilled") {
        setProducts(Array.isArray(productsResult.value.data) ? productsResult.value.data : []);
      } else {
        console.error("Catalog products failed to load:", productsResult.reason);
        setError("Unable to load products right now.");
      }

      if (settingsResult.status === "fulfilled") {
        setSettings(normalizeWebsiteSettings(settingsResult.value.data));
      } else {
        console.error("Catalog settings failed to load:", settingsResult.reason);
      }

      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyCatalogSeo(settings);
  }, [settings]);

  useEffect(() => {
    setCartItems(readStorefrontCart());
  }, []);

  const sortedProducts = useMemo(
    () => sortProducts(products, settings),
    [products, settings]
  );

  const categories = useMemo(
    () => [
      "All",
      ...Array.from(
        new Set(sortedProducts.map((product) => product.category).filter(Boolean))
      ),
    ],
    [sortedProducts]
  );

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    return sortedProducts.filter((product) => {
      const matchesCategory = category === "All" || product.category === category;
      const matchesQuery =
        !search ||
        [
          product.name,
          product.article_no,
          product.category,
          product.notes,
        ].some((value) => String(value || "").toLowerCase().includes(search));
      return matchesCategory && matchesQuery;
    });
  }, [category, query, sortedProducts]);

  const selectedHeroProduct = sortedProducts.find(
    (product) => Number(product.id) === Number(settings.hero_product_id)
  );
  const heroProduct =
    (selectedHeroProduct && productImageUrl(selectedHeroProduct)
      ? selectedHeroProduct
      : null) ||
    sortedProducts.find((product) => productImageUrl(product));
  const heroImage =
    productImageUrl(heroProduct) ||
    settings.hero_image_url ||
    fallbackCatalogImage;

  const summary = useMemo(() => cartSummary(cartItems), [cartItems]);
  const checkoutHref = useMemo(
    () => checkoutHrefForSettings(settings, cartItems, checkoutForm),
    [cartItems, checkoutForm, settings]
  );
  const checkoutTarget = checkoutHref.startsWith("http") ? "_blank" : undefined;

  const persistCart = (nextItems) => {
    const savedItems = writeStorefrontCart(nextItems);
    setCartItems(savedItems);
    return savedItems;
  };

  const handleAddToCart = (product) => {
    persistCart(addProductToCart(cartItems, product));
    setCheckoutNotice(`${product.name || product.article_no || "Product"} added to cart.`);
  };

  const updateQuantity = (productId, quantity) => {
    persistCart(setCartItemQuantity(cartItems, productId, quantity));
  };

  const removeItem = (productId) => {
    persistCart(removeCartItem(cartItems, productId));
  };

  const updateCheckoutForm = (field, value) => {
    setCheckoutNotice("");
    setCheckoutForm((current) => ({ ...current, [field]: value }));
  };

  const handleCheckoutClick = (event) => {
    if (!cartItems.length) {
      event.preventDefault();
      setCheckoutNotice("Add at least one product before checkout.");
      return;
    }
    setCheckoutNotice("Checkout request ready. Send it through the contact window that opens.");
  };

  return (
    <main className="website-page catalog-page">
      <header className="catalog-header">
        <a className="catalog-brand" href="/">
          <strong>{settings.brand_name}</strong>
          <span>{settings.tagline}</span>
        </a>
        <nav className="catalog-nav" aria-label="Catalog navigation">
          <a href="/">Home</a>
          <a href="/catalog">Catalog</a>
          <a href="#products">Products</a>
          <a href="#checkout">Checkout {summary.count ? `(${summary.count})` : ""}</a>
          <a href="#contact">Contact</a>
        </nav>
        <a className="catalog-product-link" href="#checkout">
          Cart {summary.count ? `(${summary.count})` : ""}
        </a>
      </header>

      <section
        className="catalog-hero"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 14, 20, 0.86), rgba(10, 14, 20, 0.35)), url(${heroImage})` }}
      >
        <span className="catalog-eyebrow">Live catalog</span>
        <h1>{settings.primary_cta_label}</h1>
        <p>
          Browse current products synced from ERP inventory. Add products to a
          cart, review the USD checkout total, and send your order request.
        </p>
      </section>

      <section className="catalog-shell" id="products">
        <div className="catalog-toolbar">
          <label className="catalog-search">
            <span>Search</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Name, SKU, category"
              type="search"
              value={query}
            />
          </label>

          <div className="catalog-filters" aria-label="Product categories">
            {categories.map((item) => (
              <button
                className={`catalog-filter-button ${category === item ? "is-active" : ""}`}
                key={item}
                onClick={() => setCategory(item)}
                type="button"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <p className="catalog-results-line">
          {loading ? "Loading inventory..." : `${filteredProducts.length} products shown`}
        </p>

        {error && (
          <div className="site-empty-state">
            <h3>{error}</h3>
            <p>Please try again or contact sales directly.</p>
          </div>
        )}

        {!loading && !error && filteredProducts.length === 0 && (
          <div className="site-empty-state">
            <h3>No matching products</h3>
            <p>Adjust search or category filters to browse more inventory.</p>
          </div>
        )}

        <div className="catalog-shop-layout">
          <div className="catalog-product-grid">
            {filteredProducts.map((product) => {
              const imageUrl = productImageUrl(product);
              const stockLabel = Number(product.available_stock || 0) > 0 ? "Available" : "Inquiry";
              return (
                <article className="catalog-product-card" key={product.id}>
                  <a className="catalog-product-media" href="#checkout">
                    {imageUrl ? (
                      <img src={imageUrl} alt={product.name || product.article_no || "Knife"} />
                    ) : (
                      <span>{product.article_no || "Knife"}</span>
                    )}
                  </a>
                  <div className="catalog-product-copy">
                    <span>{product.category || "Knife"}</span>
                    <h3>{product.name || product.article_no || "Handmade knife"}</h3>
                    <p>{product.notes || "Premium blade sourced from live ERP inventory."}</p>
                  </div>
                  <div className="catalog-product-meta">
                    {settings.show_prices && <strong>{formatUsdPrice(product.selling_price)}</strong>}
                    {settings.show_stock_badges && (
                      <span className="catalog-product-stock">{stockLabel}</span>
                    )}
                  </div>
                  <div className="catalog-product-actions">
                    <button
                      className="catalog-add-cart"
                      onClick={() => handleAddToCart(product)}
                      type="button"
                    >
                      Add to cart
                    </button>
                    <a className="catalog-product-link" href="#checkout">
                      Checkout
                    </a>
                  </div>
                </article>
              );
            })}
          </div>

          <aside className="catalog-checkout-panel" id="checkout" aria-label="Checkout cart">
            <header>
              <span>Checkout</span>
              <h2>Your cart</h2>
              <p>{summary.count ? `${summary.count} item${summary.count === 1 ? "" : "s"} ready` : "Add products to start an order."}</p>
            </header>

            <div className="catalog-cart-list">
              {cartItems.length === 0 ? (
                <div className="catalog-cart-empty">
                  <strong>No products yet</strong>
                  <span>Add items from the catalog and checkout here.</span>
                </div>
              ) : (
                cartItems.map((item) => (
                  <article className="catalog-cart-item" key={item.id}>
                    <div className="catalog-cart-thumb">
                      {item.image_url ? (
                        <img src={getStaticUrl(item.image_url)} alt="" />
                      ) : (
                        <span>{item.article_no || "HI"}</span>
                      )}
                    </div>
                    <div>
                      <strong>{item.name}</strong>
                      <small>{item.article_no || item.category}</small>
                      <span>{formatUsdPrice(item.price)} each</span>
                    </div>
                    <div className="catalog-cart-controls">
                      <button
                        aria-label={`Decrease ${item.name}`}
                        onClick={() => updateQuantity(item.id, item.quantity - 1)}
                        type="button"
                      >
                        -
                      </button>
                      <input
                        aria-label={`${item.name} quantity`}
                        inputMode="numeric"
                        min="1"
                        onChange={(event) => updateQuantity(item.id, event.target.value)}
                        value={item.quantity}
                      />
                      <button
                        aria-label={`Increase ${item.name}`}
                        onClick={() => updateQuantity(item.id, item.quantity + 1)}
                        type="button"
                      >
                        +
                      </button>
                      <button
                        className="is-remove"
                        onClick={() => removeItem(item.id)}
                        type="button"
                      >
                        Remove
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>

            <div className="catalog-checkout-total">
              <span>Subtotal</span>
              <strong>{formatUsdPrice(summary.subtotal)}</strong>
            </div>

            <div className="catalog-checkout-form">
              <label>
                Name
                <input
                  onChange={(event) => updateCheckoutForm("name", event.target.value)}
                  placeholder="Buyer name"
                  value={checkoutForm.name}
                />
              </label>
              <label>
                Email
                <input
                  onChange={(event) => updateCheckoutForm("email", event.target.value)}
                  placeholder="buyer@example.com"
                  type="email"
                  value={checkoutForm.email}
                />
              </label>
              <label>
                Phone
                <input
                  onChange={(event) => updateCheckoutForm("phone", event.target.value)}
                  placeholder="Phone or WhatsApp"
                  value={checkoutForm.phone}
                />
              </label>
              <label>
                Notes
                <textarea
                  onChange={(event) => updateCheckoutForm("notes", event.target.value)}
                  placeholder="Quantity details, delivery location, or custom request"
                  rows="3"
                  value={checkoutForm.notes}
                />
              </label>
            </div>

            {checkoutNotice && <p className="catalog-checkout-notice">{checkoutNotice}</p>}

            <a
              className={`catalog-checkout-button ${cartItems.length ? "" : "is-disabled"}`}
              href={checkoutHref}
              onClick={handleCheckoutClick}
              rel={checkoutTarget ? "noreferrer" : undefined}
              target={checkoutTarget}
            >
              Checkout order request
            </a>
            <small className="catalog-checkout-footnote">
              Checkout sends the cart to sales for confirmation before payment and dispatch.
            </small>
          </aside>
        </div>
      </section>

      <section className="site-contact catalog-shell" id="contact">
        <div>
          <span>Contact</span>
          <h2>{settings.contact_heading}</h2>
          <p>{settings.contact_text}</p>
        </div>
        <a href="/#contact">{settings.contact_button_label}</a>
      </section>
    </main>
  );
}

export default WebsiteCatalog;
