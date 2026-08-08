import { useEffect, useMemo, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import {
  DEFAULT_WEBSITE_SETTINGS,
  WEBSITE_SECTIONS,
  getVisibleSectionOrder,
  normalizeWebsiteSettings,
  websitePreviewUrl,
} from "../utils/websiteSettings";
import "./WebsiteAdmin.css";

const editorTabs = [
  ["content", "Content"],
  ["sections", "Sections"],
  ["products", "Products"],
  ["seo", "SEO"],
  ["design", "Design"],
];

const contentFields = [
  ["brand_name", "Brand name"],
  ["tagline", "Tagline"],
  ["announcement_text", "Announcement"],
  ["hero_badge", "Hero badge"],
  ["hero_title", "Hero title", "textarea"],
  ["hero_subtitle", "Hero subtitle", "textarea"],
  ["primary_cta_label", "Primary button"],
  ["secondary_cta_label", "Secondary button"],
  ["collections_heading", "Collections heading"],
  ["collections_text", "Collections text", "textarea"],
  ["featured_heading", "Featured heading"],
  ["featured_text", "Featured text", "textarea"],
  ["about_heading", "About heading"],
  ["about_text", "About text", "textarea"],
  ["process_heading", "Process heading"],
  ["process_text", "Process text", "textarea"],
  ["contact_heading", "Contact heading"],
  ["contact_text", "Contact text", "textarea"],
  ["contact_button_label", "Contact button"],
  ["phone", "Phone"],
  ["email", "Email"],
  ["whatsapp", "WhatsApp"],
];

const seoFields = [
  ["meta_title", "SEO title"],
  ["meta_description", "Meta description", "textarea"],
  ["meta_keywords", "Keywords"],
  ["canonical_url", "Canonical URL"],
];

const metricFields = [
  ["trust_metric_1_value", "Metric 1 value"],
  ["trust_metric_1_label", "Metric 1 label"],
  ["trust_metric_2_value", "Metric 2 value"],
  ["trust_metric_2_label", "Metric 2 label"],
  ["trust_metric_3_value", "Metric 3 value"],
  ["trust_metric_3_label", "Metric 3 label"],
];

const moveItem = (items, fromIndex, toIndex) => {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return items;
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const uniqueIds = (ids) => Array.from(new Set(ids.map(Number).filter(Boolean)));

function WebsiteAdmin() {
  const [settings, setSettings] = useState(DEFAULT_WEBSITE_SETTINGS);
  const [products, setProducts] = useState([]);
  const [activeTab, setActiveTab] = useState("content");
  const [previewMode, setPreviewMode] = useState("desktop");
  const [sectionDragId, setSectionDragId] = useState("");
  const [productDragId, setProductDragId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      api.get("/website-settings"),
      api.get("/products"),
    ]).then(([settingsResult, productsResult]) => {
      if (!active) return;

      if (settingsResult.status === "fulfilled") {
        setSettings(normalizeWebsiteSettings(settingsResult.value.data));
      } else {
        console.error("Website settings failed to load:", settingsResult.reason);
        setError("Website settings could not be loaded.");
      }

      if (productsResult.status === "fulfilled") {
        setProducts(Array.isArray(productsResult.value.data) ? productsResult.value.data : []);
      } else {
        console.error("Website products failed to load:", productsResult.reason);
      }

      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const previewUrl = useMemo(() => websitePreviewUrl(), []);
  const normalizedSettings = useMemo(
    () => normalizeWebsiteSettings(settings),
    [settings]
  );

  const orderedProducts = useMemo(() => {
    const orderIndex = new Map(
      (normalizedSettings.product_order_ids || []).map((id, index) => [Number(id), index])
    );
    return [...products].sort((a, b) => {
      const aOrder = orderIndex.has(Number(a.id)) ? orderIndex.get(Number(a.id)) : 9999;
      const bOrder = orderIndex.has(Number(b.id)) ? orderIndex.get(Number(b.id)) : 9999;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(a.category || "").localeCompare(String(b.category || "")) ||
        String(a.article_no || a.name || "").localeCompare(String(b.article_no || b.name || ""));
    });
  }, [normalizedSettings.product_order_ids, products]);

  const visibleProducts = orderedProducts.filter(
    (product) => !normalizedSettings.hidden_product_ids.includes(Number(product.id))
  );
  const featuredProducts = orderedProducts.filter((product) =>
    normalizedSettings.featured_product_ids.includes(Number(product.id))
  );
  const visibleSectionCount = getVisibleSectionOrder(normalizedSettings).length;

  const updateField = (field, value) => {
    setNotice("");
    setError("");
    setSettings((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const toggleArrayValue = (field, value) => {
    setSettings((current) => {
      const currentValues = Array.isArray(current[field]) ? current[field].map(Number) : [];
      const numericValue = Number(value);
      const nextValues = currentValues.includes(numericValue)
        ? currentValues.filter((item) => item !== numericValue)
        : [...currentValues, numericValue];
      return {
        ...current,
        [field]: uniqueIds(nextValues),
      };
    });
  };

  const toggleSection = (sectionId) => {
    if (sectionId === "hero") return;
    setSettings((current) => {
      const hidden = new Set(current.hidden_section_ids || []);
      if (hidden.has(sectionId)) {
        hidden.delete(sectionId);
      } else {
        hidden.add(sectionId);
      }
      return {
        ...current,
        hidden_section_ids: Array.from(hidden),
      };
    });
  };

  const moveSection = (sectionId, direction) => {
    setSettings((current) => {
      const order = normalizeWebsiteSettings(current).section_order;
      const index = order.indexOf(sectionId);
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      return {
        ...current,
        section_order: moveItem(order, index, nextIndex),
      };
    });
  };

  const dropSection = (targetId) => {
    if (!sectionDragId || sectionDragId === targetId) return;
    setSettings((current) => {
      const order = normalizeWebsiteSettings(current).section_order;
      return {
        ...current,
        section_order: moveItem(order, order.indexOf(sectionDragId), order.indexOf(targetId)),
      };
    });
    setSectionDragId("");
  };

  const moveProduct = (productId, direction) => {
    setSettings((current) => {
      const allIds = orderedProducts.map((product) => Number(product.id));
      const currentOrder = uniqueIds([
        ...(current.product_order_ids || []),
        ...allIds.filter((id) => !(current.product_order_ids || []).includes(id)),
      ]);
      const index = currentOrder.indexOf(Number(productId));
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      return {
        ...current,
        product_order_ids: moveItem(currentOrder, index, nextIndex),
      };
    });
  };

  const dropProduct = (targetId) => {
    if (!productDragId || Number(productDragId) === Number(targetId)) return;
    setSettings((current) => {
      const allIds = orderedProducts.map((product) => Number(product.id));
      const currentOrder = uniqueIds([
        ...(current.product_order_ids || []),
        ...allIds.filter((id) => !(current.product_order_ids || []).includes(id)),
      ]);
      return {
        ...current,
        product_order_ids: moveItem(
          currentOrder,
          currentOrder.indexOf(Number(productDragId)),
          currentOrder.indexOf(Number(targetId))
        ),
      };
    });
    setProductDragId(null);
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    setSaving(true);
    setNotice("");
    setError("");

    try {
      const payload = normalizeWebsiteSettings(settings);
      const response = await api.put("/website-settings", payload);
      setSettings(normalizeWebsiteSettings(response.data));
      setNotice("Website settings saved.");
    } catch (saveError) {
      console.error("Website settings save failed:", saveError);
      setError(saveError.response?.data?.detail || "Website settings could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setSettings(DEFAULT_WEBSITE_SETTINGS);
    setNotice("");
    setError("");
  };

  const openPreview = (path = "/") => {
    const url = new URL(path, previewUrl);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  const renderField = ([field, label, type]) => (
    <label className="website-admin-field" key={field}>
      <span>{label}</span>
      {type === "textarea" ? (
        <textarea
          name={field}
          onChange={(event) => updateField(field, event.target.value)}
          value={settings[field] || ""}
        />
      ) : (
        <input
          name={field}
          onChange={(event) => updateField(field, event.target.value)}
          value={settings[field] || ""}
        />
      )}
    </label>
  );

  const renderContentEditor = () => (
    <div className="website-editor-stack">
      <section className="website-admin-panel">
        <div className="website-admin-panel-heading">
          <h2>Storefront copy</h2>
          <span>Homepage</span>
        </div>
        <div className="website-admin-grid">{contentFields.map(renderField)}</div>
      </section>

      <section className="website-admin-panel">
        <div className="website-admin-panel-heading">
          <h2>Trust metrics</h2>
          <span>Buyer proof</span>
        </div>
        <div className="website-admin-grid">{metricFields.map(renderField)}</div>
      </section>
    </div>
  );

  const renderSectionsEditor = () => (
    <section className="website-admin-panel">
      <div className="website-admin-panel-heading">
        <h2>Sections</h2>
        <span>Drag to reorder</span>
      </div>

      <div className="website-section-list">
        {normalizedSettings.section_order.map((sectionId, index) => {
          const section = WEBSITE_SECTIONS.find((item) => item.id === sectionId);
          const hidden = normalizedSettings.hidden_section_ids.includes(sectionId);
          return (
            <article
              className={`website-section-item ${hidden ? "is-hidden" : ""}`}
              draggable
              key={sectionId}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setSectionDragId(sectionId)}
              onDrop={() => dropSection(sectionId)}
            >
              <div className="website-drag-handle">Drag</div>
              <div>
                <strong>{section?.label || sectionId}</strong>
                <p>{section?.description}</p>
              </div>
              <div className="website-row-actions">
                <button
                  disabled={index === 0}
                  onClick={() => moveSection(sectionId, "up")}
                  type="button"
                >
                  Up
                </button>
                <button
                  disabled={index === normalizedSettings.section_order.length - 1}
                  onClick={() => moveSection(sectionId, "down")}
                  type="button"
                >
                  Down
                </button>
                <button
                  disabled={sectionId === "hero"}
                  onClick={() => toggleSection(sectionId)}
                  type="button"
                >
                  {hidden ? "Show" : "Hide"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  const renderProductsEditor = () => (
    <section className="website-admin-panel">
      <div className="website-admin-panel-heading">
        <h2>Products</h2>
        <span>{visibleProducts.length} visible</span>
      </div>

      <div className="website-product-toolbar">
        <label className="website-admin-toggle">
          <input
            checked={normalizedSettings.show_featured_products !== false}
            onChange={(event) => updateField("show_featured_products", event.target.checked)}
            type="checkbox"
          />
          <span>Show featured products section</span>
        </label>
        <label className="website-admin-toggle">
          <input
            checked={normalizedSettings.show_prices !== false}
            onChange={(event) => updateField("show_prices", event.target.checked)}
            type="checkbox"
          />
          <span>Show product prices</span>
        </label>
        <label className="website-admin-toggle">
          <input
            checked={normalizedSettings.show_stock_badges !== false}
            onChange={(event) => updateField("show_stock_badges", event.target.checked)}
            type="checkbox"
          />
          <span>Show stock badges</span>
        </label>
        <label className="website-admin-field website-feature-limit">
          <span>Featured item limit</span>
          <input
            max="24"
            min="1"
            onChange={(event) => updateField("featured_limit", event.target.value)}
            type="number"
            value={settings.featured_limit}
          />
        </label>
      </div>

      <div className="website-product-manager">
        {orderedProducts.map((product, index) => {
          const productId = Number(product.id);
          const hidden = normalizedSettings.hidden_product_ids.includes(productId);
          const featured = normalizedSettings.featured_product_ids.includes(productId);
          const imageUrl = product.image_url ? getStaticUrl(product.image_url) : null;
          return (
            <article
              className={`website-product-row ${hidden ? "is-hidden" : ""}`}
              draggable
              key={product.id}
              onDragOver={(event) => event.preventDefault()}
              onDragStart={() => setProductDragId(productId)}
              onDrop={() => dropProduct(productId)}
            >
              <div className="website-product-thumb">
                {imageUrl ? (
                  <img src={imageUrl} alt={product.name || product.article_no} />
                ) : (
                  <span>{product.article_no?.slice(0, 2) || "PR"}</span>
                )}
              </div>
              <div className="website-product-info">
                <strong>{product.name || product.article_no}</strong>
                <span>
                  {product.article_no} / {product.category || "No category"}
                </span>
              </div>
              <div className="website-row-actions">
                <button disabled={index === 0} onClick={() => moveProduct(productId, "up")} type="button">
                  Up
                </button>
                <button disabled={index === orderedProducts.length - 1} onClick={() => moveProduct(productId, "down")} type="button">
                  Down
                </button>
                <button onClick={() => toggleArrayValue("featured_product_ids", productId)} type="button">
                  {featured ? "Featured" : "Feature"}
                </button>
                <button onClick={() => toggleArrayValue("hidden_product_ids", productId)} type="button">
                  {hidden ? "Show" : "Hide"}
                </button>
              </div>
            </article>
          );
        })}

        {!orderedProducts.length && (
          <div className="website-admin-empty">
            Products will appear here after they are created in ERP Products.
          </div>
        )}
      </div>
    </section>
  );

  const renderSeoEditor = () => (
    <section className="website-admin-panel">
      <div className="website-admin-panel-heading">
        <h2>SEO</h2>
        <span>Search preview</span>
      </div>
      <div className="website-admin-grid">{seoFields.map(renderField)}</div>
      <div className="website-serp-preview">
        <span>{settings.canonical_url || previewUrl}</span>
        <strong>{settings.meta_title}</strong>
        <p>{settings.meta_description}</p>
      </div>
    </section>
  );

  const renderDesignEditor = () => (
    <section className="website-admin-panel">
      <div className="website-admin-panel-heading">
        <h2>Design</h2>
        <span>Theme</span>
      </div>
      <div className="website-admin-grid">
        <label className="website-admin-field">
          <span>Theme style</span>
          <select
            onChange={(event) => updateField("theme_style", event.target.value)}
            value={settings.theme_style || "atelier"}
          >
            <option value="atelier">Atelier</option>
            <option value="trade">Trade</option>
            <option value="gallery">Gallery</option>
          </select>
        </label>
        <label className="website-admin-field">
          <span>Hero background product</span>
          <select
            onChange={(event) => updateField("hero_product_id", Number(event.target.value))}
            value={Number(settings.hero_product_id || 0)}
          >
            <option value="0">Auto choose from products</option>
            {orderedProducts
              .filter((product) => product.image_url)
              .map((product) => (
                <option key={product.id} value={product.id}>
                  {product.article_no} - {product.name || "Product"}
                </option>
              ))}
          </select>
        </label>
        <label className="website-admin-field">
          <span>Hero image URL</span>
          <input
            onChange={(event) => updateField("hero_image_url", event.target.value)}
            placeholder="Optional external URL if no product is selected"
            value={settings.hero_image_url || ""}
          />
        </label>
      </div>
      <div className="website-design-hints">
        <article>
          <strong>Atelier</strong>
          <span>Editorial storefront for premium handmade products.</span>
        </article>
        <article>
          <strong>Trade</strong>
          <span>Sharper wholesale tone for B2B buyers and large orders.</span>
        </article>
        <article>
          <strong>Gallery</strong>
          <span>Product-first display with quieter copy and strong visuals.</span>
        </article>
      </div>
    </section>
  );

  const renderActiveEditor = () => {
    if (activeTab === "sections") return renderSectionsEditor();
    if (activeTab === "products") return renderProductsEditor();
    if (activeTab === "seo") return renderSeoEditor();
    if (activeTab === "design") return renderDesignEditor();
    return renderContentEditor();
  };

  const previewProducts = featuredProducts.length
    ? featuredProducts
    : visibleProducts.slice(0, normalizedSettings.featured_limit);
  const selectedHeroProduct = orderedProducts.find(
    (product) => Number(product.id) === Number(normalizedSettings.hero_product_id)
  );
  const previewHeroProduct =
    (selectedHeroProduct?.image_url ? selectedHeroProduct : null) ||
    orderedProducts.find((product) => product.image_url);
  const previewHeroImage =
    (previewHeroProduct?.image_url ? getStaticUrl(previewHeroProduct.image_url) : "") ||
    settings.hero_image_url;

  return (
    <div className="website-admin-page">
      <header className="website-admin-header">
        <div>
          <span>Website</span>
          <h1>Website Builder</h1>
          <p>Control storefront content, SEO, product visibility, and homepage sections.</p>
        </div>
        <div className="website-admin-actions">
          <button className="website-admin-secondary" onClick={() => openPreview("/catalog")} type="button">
            Preview catalog
          </button>
          <button className="website-admin-primary" onClick={() => openPreview("/")} type="button">
            Preview website
          </button>
        </div>
      </header>

      {notice && <div className="website-admin-message success">{notice}</div>}
      {error && <div className="website-admin-message error">{error}</div>}

      <form className="website-builder-layout" onSubmit={saveSettings}>
        <section className="website-editor-column">
          <nav className="website-editor-tabs" aria-label="Website editor sections">
            {editorTabs.map(([tab, label]) => (
              <button
                className={activeTab === tab ? "is-active" : ""}
                key={tab}
                onClick={() => setActiveTab(tab)}
                type="button"
              >
                {label}
              </button>
            ))}
          </nav>

          {loading ? (
            <section className="website-admin-panel">
              <div className="website-admin-empty">Loading website editor...</div>
            </section>
          ) : (
            renderActiveEditor()
          )}
        </section>

        <aside className="website-preview-column">
          <div className="website-preview-toolbar">
            <div>
              <span>Live preview</span>
              <strong>{settings.brand_name}</strong>
            </div>
            <div className="website-preview-switch">
              <button
                className={previewMode === "desktop" ? "is-active" : ""}
                onClick={() => setPreviewMode("desktop")}
                type="button"
              >
                Desktop
              </button>
              <button
                className={previewMode === "mobile" ? "is-active" : ""}
                onClick={() => setPreviewMode("mobile")}
                type="button"
              >
                Mobile
              </button>
            </div>
          </div>

          <div className={`website-live-preview is-${previewMode}`}>
            <div
              className="website-preview-hero"
              style={
                previewHeroImage
                  ? {
                      backgroundImage: `linear-gradient(90deg, rgba(17, 24, 39, 0.92), rgba(22, 78, 99, 0.62)), url(${previewHeroImage})`,
                    }
                  : undefined
              }
            >
              <span>{settings.hero_badge}</span>
              <h2>{settings.hero_title}</h2>
              <p>{settings.hero_subtitle}</p>
            </div>
            <div className="website-preview-stats">
              <strong>{visibleSectionCount}</strong>
              <span>visible sections</span>
              <strong>{visibleProducts.length}</strong>
              <span>visible products</span>
            </div>
            <div className="website-preview-sections">
              {getVisibleSectionOrder(normalizedSettings).map((section) => (
                <span key={section}>{WEBSITE_SECTIONS.find((item) => item.id === section)?.label || section}</span>
              ))}
            </div>
            <div className="website-preview-products">
              {previewProducts.slice(0, 3).map((product) => {
                const imageUrl = product.image_url ? getStaticUrl(product.image_url) : null;
                return (
                  <article key={product.id}>
                    {imageUrl ? <img src={imageUrl} alt="" /> : <span />}
                    <strong>{product.name || product.article_no}</strong>
                  </article>
                );
              })}
            </div>
          </div>
        </aside>

        <div className="website-admin-savebar">
          <button className="website-admin-secondary" onClick={resetDefaults} type="button">
            Reset defaults
          </button>
          <button className="website-admin-primary" disabled={saving || loading} type="submit">
            {saving ? "Saving" : "Save website"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default WebsiteAdmin;
