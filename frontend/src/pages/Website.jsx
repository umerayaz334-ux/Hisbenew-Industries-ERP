import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import {
  DEFAULT_WEBSITE_SETTINGS,
  getVisibleSectionOrder,
  normalizeWebsiteSettings,
} from "../utils/websiteSettings";
import "./Website.css";

const fallbackHeroImage =
  "https://images.unsplash.com/photo-1600857544200-b2f666a9a2ec?auto=format&fit=crop&w=1800&q=85";

const fallbackCategories = [
  {
    id: "chef",
    title: "Chef knives",
    description: "Balanced blades for kitchens, prep tables, and restaurant buyers.",
  },
  {
    id: "hunting",
    title: "Hunting knives",
    description: "Field-ready knives for outdoor, camping, and sporting customers.",
  },
  {
    id: "sets",
    title: "Gift sets",
    description: "Retail-friendly bundles for shelves, gifting, and wholesale orders.",
  },
  {
    id: "custom",
    title: "Custom blades",
    description: "Buyer-specific shapes, finishes, and quantities for serious projects.",
  },
];

const processSteps = [
  ["01", "Select", "Browse live ERP products or request a custom set."],
  ["02", "Confirm", "Verify quantity, finish, price, and delivery expectations."],
  ["03", "Dispatch", "Packed orders move through fulfillment with clear handoff."],
];

const setMetaTag = (selector, attrs) => {
  if (typeof document === "undefined") return;
  let tag = document.head.querySelector(selector);
  if (!tag) {
    tag = document.createElement("meta");
    document.head.appendChild(tag);
  }
  Object.entries(attrs).forEach(([key, value]) => tag.setAttribute(key, value));
};

const setCanonical = (href) => {
  if (typeof document === "undefined") return;
  const existing = document.head.querySelector('link[rel="canonical"]');
  if (!href) {
    existing?.remove();
    return;
  }
  const tag = existing || document.createElement("link");
  tag.setAttribute("rel", "canonical");
  tag.setAttribute("href", href);
  if (!existing) document.head.appendChild(tag);
};

const applyWebsiteSeo = (settings) => {
  if (typeof document === "undefined") return;
  document.title = settings.meta_title || settings.brand_name;
  setMetaTag('meta[name="description"]', {
    name: "description",
    content: settings.meta_description,
  });
  setMetaTag('meta[name="keywords"]', {
    name: "keywords",
    content: settings.meta_keywords,
  });
  setMetaTag('meta[property="og:title"]', {
    property: "og:title",
    content: settings.meta_title || settings.brand_name,
  });
  setMetaTag('meta[property="og:description"]', {
    property: "og:description",
    content: settings.meta_description,
  });
  setMetaTag('meta[property="og:type"]', {
    property: "og:type",
    content: "website",
  });
  setCanonical(settings.canonical_url);
};

const productImageUrl = (product) =>
  product?.image_url ? getStaticUrl(product.image_url) : null;

const sortProductsForSite = (products, settings) => {
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

const featuredProductsForSite = (products, settings) => {
  const featuredIds = new Set(settings.featured_product_ids || []);
  const selected = featuredIds.size
    ? products.filter((product) => featuredIds.has(Number(product.id)))
    : products;

  return selected
    .sort((a, b) => Number(b.selling_price || 0) - Number(a.selling_price || 0))
    .slice(0, settings.featured_limit);
};

function Website() {
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WEBSITE_SETTINGS);
  const [loading, setLoading] = useState(true);

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
        console.error("Website products failed to load:", productsResult.reason);
      }

      if (settingsResult.status === "fulfilled") {
        setSettings(normalizeWebsiteSettings(settingsResult.value.data));
      } else {
        console.error("Website settings failed to load:", settingsResult.reason);
      }

      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    applyWebsiteSeo(settings);
  }, [settings]);

  const visibleProducts = useMemo(
    () => sortProductsForSite(products, settings),
    [products, settings]
  );

  const featuredProducts = useMemo(
    () => featuredProductsForSite(visibleProducts, settings),
    [visibleProducts, settings]
  );

  const selectedHeroProduct = visibleProducts.find(
    (product) => Number(product.id) === Number(settings.hero_product_id)
  );
  const heroProduct =
    (selectedHeroProduct && productImageUrl(selectedHeroProduct)
      ? selectedHeroProduct
      : null) ||
    visibleProducts.find((product) => productImageUrl(product));
  const heroImage =
    productImageUrl(heroProduct) ||
    settings.hero_image_url ||
    fallbackHeroImage;

  const categories = useMemo(() => {
    const grouped = new Map();
    visibleProducts.forEach((product) => {
      const category = product.category || "Signature knives";
      const current = grouped.get(category) || {
        id: category.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        title: category,
        count: 0,
        image: productImageUrl(product),
      };
      grouped.set(category, {
        ...current,
        count: current.count + 1,
        image: current.image || productImageUrl(product),
      });
    });

    const liveCategories = Array.from(grouped.values()).slice(0, 6);
    return liveCategories.length ? liveCategories : fallbackCategories;
  }, [visibleProducts]);

  const navSections = getVisibleSectionOrder(settings).filter((section) =>
    ["collections", "featured", "about", "process", "contact"].includes(section)
  );

  const contactHref =
    settings.whatsapp
      ? `https://wa.me/${String(settings.whatsapp).replace(/\D/g, "")}`
      : settings.email
        ? `mailto:${settings.email}`
        : settings.phone
          ? `tel:${settings.phone}`
          : "/website/catalog";

  const renderProductCard = (product) => {
    const imageUrl = productImageUrl(product);
    return (
      <article className="site-product-card" key={product.id}>
        <a className="site-product-media" href="/website/catalog">
          {imageUrl ? (
            <img src={imageUrl} alt={product.name || product.article_no || "Knife"} />
          ) : (
            <span>{product.article_no || "Knife"}</span>
          )}
        </a>
        <div className="site-product-copy">
          <span>{product.category || "Knife"}</span>
          <h3>{product.name || product.article_no || "Handmade knife"}</h3>
          <p>{product.notes || "Hand-finished blade ready for practical use and retail presentation."}</p>
        </div>
        <div className="site-product-meta">
          {settings.show_prices && (
            <strong>
              PKR {Number(product.selling_price || 0).toLocaleString("en-PK")}
            </strong>
          )}
          {settings.show_stock_badges && (
            <small>{Number(product.available_stock || 0) > 0 ? "Available" : "Inquiry only"}</small>
          )}
        </div>
      </article>
    );
  };

  const sections = {
    hero: (
      <section
        className="site-hero"
        id="hero"
        key="hero"
        style={{ backgroundImage: `linear-gradient(90deg, rgba(10, 14, 20, 0.86), rgba(10, 14, 20, 0.42)), url(${heroImage})` }}
      >
        <header className="site-header">
          <a className="site-brand" href="/website">
            <strong>{settings.brand_name}</strong>
            <span>{settings.tagline}</span>
          </a>
          <nav className="site-nav" aria-label="Website navigation">
            {navSections.map((section) => (
              <a href={`#${section}`} key={section}>
                {section === "featured" ? "Products" : section}
              </a>
            ))}
          </nav>
          <a className="site-header-cta" href={contactHref}>
            {settings.secondary_cta_label}
          </a>
        </header>

        {settings.announcement_text && (
          <div className="site-announcement">{settings.announcement_text}</div>
        )}

        <div className="site-hero-copy">
          <span>{settings.hero_badge}</span>
          <h1>{settings.hero_title}</h1>
          <p>{settings.hero_subtitle}</p>
          <div className="site-hero-actions">
            <a href="/website/catalog">{settings.primary_cta_label}</a>
            <a href={contactHref}>{settings.secondary_cta_label}</a>
          </div>
        </div>
      </section>
    ),
    trust: (
      <section className="site-trust" id="trust" key="trust" aria-label="Business highlights">
        {[
          [settings.trust_metric_1_value, settings.trust_metric_1_label],
          [settings.trust_metric_2_value, settings.trust_metric_2_label],
          [settings.trust_metric_3_value, settings.trust_metric_3_label],
        ].map(([value, label]) => (
          <article key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>
    ),
    collections: (
      <section className="site-section" id="collections" key="collections">
        <div className="site-section-heading">
          <span>Collections</span>
          <h2>{settings.collections_heading}</h2>
          <p>{settings.collections_text}</p>
        </div>
        <div className="site-collection-grid">
          {categories.map((category) => (
            <a className="site-collection-card" href="/website/catalog" key={category.id}>
              {category.image && <img src={category.image} alt={category.title} />}
              <div>
                <h3>{category.title}</h3>
                <p>
                  {"count" in category
                    ? `${category.count} live products`
                    : category.description}
                </p>
              </div>
            </a>
          ))}
        </div>
      </section>
    ),
    featured: settings.show_featured_products && (
      <section className="site-section" id="featured" key="featured">
        <div className="site-section-heading has-action">
          <div>
            <span>Products</span>
            <h2>{settings.featured_heading}</h2>
            <p>{settings.featured_text}</p>
          </div>
          <a href="/website/catalog">Open full catalog</a>
        </div>
        <div className="site-product-grid">
          {featuredProducts.map(renderProductCard)}
          {!loading && !featuredProducts.length && (
            <div className="site-empty-state">
              <h3>No featured products yet</h3>
              <p>Turn on products from the ERP Website editor to populate this section.</p>
            </div>
          )}
        </div>
      </section>
    ),
    about: (
      <section className="site-split-section" id="about" key="about">
        <div>
          <span>About</span>
          <h2>{settings.about_heading}</h2>
          <p>{settings.about_text}</p>
        </div>
        <div className="site-proof-list">
          <p>Live ERP catalog</p>
          <p>Wholesale-ready ordering</p>
          <p>Custom buyer support</p>
          <p>Careful product presentation</p>
        </div>
      </section>
    ),
    process: (
      <section className="site-section" id="process" key="process">
        <div className="site-section-heading">
          <span>Process</span>
          <h2>{settings.process_heading}</h2>
          <p>{settings.process_text}</p>
        </div>
        <div className="site-process-grid">
          {processSteps.map(([number, title, text]) => (
            <article key={title}>
              <span>{number}</span>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>
    ),
    contact: (
      <section className="site-contact" id="contact" key="contact">
        <div>
          <span>Contact</span>
          <h2>{settings.contact_heading}</h2>
          <p>{settings.contact_text}</p>
          <div className="site-contact-lines">
            {settings.phone && <a href={`tel:${settings.phone}`}>{settings.phone}</a>}
            {settings.email && <a href={`mailto:${settings.email}`}>{settings.email}</a>}
            {settings.whatsapp && (
              <a href={`https://wa.me/${String(settings.whatsapp).replace(/\D/g, "")}`}>
                WhatsApp
              </a>
            )}
          </div>
        </div>
        <a href={contactHref}>{settings.contact_button_label}</a>
      </section>
    ),
  };

  return (
    <main className={`website-page website-theme-${settings.theme_style || "atelier"}`}>
      {getVisibleSectionOrder(settings).map((section) => sections[section]).filter(Boolean)}
    </main>
  );
}

export default Website;
