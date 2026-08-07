import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import {
  DEFAULT_WEBSITE_SETTINGS,
  normalizeWebsiteSettings,
} from "../utils/websiteSettings";
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

function WebsiteCatalog() {
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WEBSITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

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

  return (
    <main className="website-page catalog-page">
      <header className="catalog-header">
        <a className="catalog-brand" href="/website">
          <strong>{settings.brand_name}</strong>
          <span>{settings.tagline}</span>
        </a>
        <nav className="catalog-nav" aria-label="Catalog navigation">
          <a href="/website">Home</a>
          <a href="/website/catalog">Catalog</a>
          <a href="#products">Products</a>
          <a href="#contact">Contact</a>
        </nav>
        <a className="catalog-product-link" href="/website#contact">
          {settings.contact_button_label}
        </a>
      </header>

      <section
        className="catalog-hero"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 14, 20, 0.86), rgba(10, 14, 20, 0.35)), url(${heroImage})` }}
      >
        <span className="catalog-eyebrow">Live catalog</span>
        <h1>{settings.primary_cta_label}</h1>
        <p>
          Browse current products synced from ERP inventory. Filter by category,
          compare prices, and contact sales for wholesale or custom quantities.
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

        <div className="catalog-product-grid">
          {filteredProducts.map((product) => {
            const imageUrl = productImageUrl(product);
            return (
              <article className="catalog-product-card" key={product.id}>
                <a className="catalog-product-media" href="#contact">
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
                  {settings.show_prices && (
                    <strong>
                      PKR {Number(product.selling_price || 0).toLocaleString("en-PK")}
                    </strong>
                  )}
                  {settings.show_stock_badges && (
                    <span className="catalog-product-stock">
                      {Number(product.available_stock || 0) > 0 ? "Available" : "Inquiry"}
                    </span>
                  )}
                </div>
                <a className="catalog-product-link" href="/website#contact">
                  Request quote
                </a>
              </article>
            );
          })}
        </div>
      </section>

      <section className="site-contact catalog-shell" id="contact">
        <div>
          <span>Contact</span>
          <h2>{settings.contact_heading}</h2>
          <p>{settings.contact_text}</p>
        </div>
        <a href="/website#contact">{settings.contact_button_label}</a>
      </section>
    </main>
  );
}

export default WebsiteCatalog;
