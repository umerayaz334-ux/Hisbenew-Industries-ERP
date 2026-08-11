import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, { getStaticUrl } from "../api/api";
import { formatUtcLocal } from "../utils/dateUtils";
import {
  DEFAULT_WEBSITE_SETTINGS,
  normalizeWebsiteSettings,
} from "../utils/websiteSettings";
import {
  addProductToCart,
  cartSummary,
  formatUsdPrice,
  readStorefrontCart,
  removeCartItem,
  setCartItemQuantity,
  writeStorefrontCart,
} from "../utils/storefrontCommerce";
import "./Website.css";

const QUICK_CHAT_CHIPS = [
  { label: "🗡️ Wholesale Price List", msg: "Hi! I would like to receive your wholesale catalog & price list for volume ordering." },
  { label: "🚚 Lead Times & Shipping", msg: "Hello! What are your current manufacturing lead times and international shipping rates?" },
  { label: "⚒️ Custom Forging Specs", msg: "Hi! I am interested in custom Damascus forging & OEM branding specs." },
  { label: "📞 Speak to Sales Rep", msg: "Hello! Can a factory sales manager contact me regarding a bulk order?" },
];

const fallbackCatalogImage =
  "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=1800&q=85";

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

export default function WebsiteCatalog() {
  const [products, setProducts] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_WEBSITE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [sortBy, setSortBy] = useState("featured");
  const [tagStyle, setTagStyle] = useState("glass-bottom"); // "glass-bottom", "inline-title", "corner-ribbon"
  const [cartItems, setCartItems] = useState([]);
  const [wishlist, setWishlist] = useState({});
  
  // Hero Slider State
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);

  // Slide-out Cart Drawer & Product Page States
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("product") || null;
  });
  const [productModalQty, setProductModalQty] = useState(1);
  const [productModalTab, setProductModalTab] = useState("specs");
  const [activeModalImgIdx, setActiveModalImgIdx] = useState(0);

  useEffect(() => {
    const handlePopState = () => {
      const params = new URLSearchParams(window.location.search);
      setSelectedProductId(params.get("product") || null);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openProductPage = (product, e) => {
    if (e && e.preventDefault) e.preventDefault();
    const url = new URL(window.location.href);
    url.searchParams.set("product", product.id);
    window.history.pushState({}, "", url.toString());
    setSelectedProductId(String(product.id));
    setProductModalQty(1);
    setProductModalTab("specs");
    setActiveModalImgIdx(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeProductPage = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete("product");
    window.history.pushState({}, "", url.toString());
    setSelectedProductId(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isContactModalOpen, setIsContactModalOpen] = useState(false);
  const [contactForm, setContactForm] = useState({
    name: "",
    email: "",
    phone: "",
    inquiryType: "Wholesale Inquiry",
    message: "",
  });
  const [contactSubmitted, setContactSubmitted] = useState(false);

  const handleContactSubmit = (e) => {
    e.preventDefault();
    setContactSubmitted(true);
    setTimeout(() => {
      setContactSubmitted(false);
      setIsContactModalOpen(false);
      setContactForm({ name: "", email: "", phone: "", inquiryType: "Wholesale Inquiry", message: "" });
    }, 2500);
  };

  // Live Chat Widget State & Enhancements
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatVisitorName, setChatVisitorName] = useState(() => localStorage.getItem("hisbenew_chat_name") || "");
  const [chatVisitorEmail, setChatVisitorEmail] = useState(() => localStorage.getItem("hisbenew_chat_email") || "");
  const [chatSessionId] = useState(() => {
    let sid = localStorage.getItem("hisbenew_chat_sid");
    if (!sid) {
      sid = "v_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      localStorage.setItem("hisbenew_chat_sid", sid);
    }
    return sid;
  });
  const [chatMessages, setChatMessages] = useState([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const [isSupportTyping, setIsSupportTyping] = useState(false);
  const chatMessagesEndRef = useRef(null);
  const prevChatCountRef = useRef(0);

  const playChatChime = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } catch {
      // Audio context silenced if un-triggered
    }
  };

  const fetchChatMessages = useCallback(async () => {
    if (!chatSessionId) return;
    try {
      const res = await api.get(`/public-live-chat/${chatSessionId}`);
      if (Array.isArray(res.data)) {
        const nextMsgs = res.data;
        if (nextMsgs.length > prevChatCountRef.current) {
          const newSupportMsgs = nextMsgs.slice(prevChatCountRef.current).filter((m) => !m.is_from_visitor);
          if (newSupportMsgs.length > 0) {
            playChatChime();
            if (!isChatOpen) {
              setUnreadChatCount((prev) => prev + newSupportMsgs.length);
            }
          }
        }
        prevChatCountRef.current = nextMsgs.length;
        setChatMessages(nextMsgs);
      }
    } catch (e) {
      console.warn("Live chat fetch warning:", e);
    }
  }, [chatSessionId, isChatOpen]);

  useEffect(() => {
    fetchChatMessages();
    const interval = setInterval(fetchChatMessages, 3500);
    return () => clearInterval(interval);
  }, [fetchChatMessages]);

  useEffect(() => {
    if (isChatOpen) {
      setUnreadChatCount(0);
      if (chatMessagesEndRef.current) {
        chatMessagesEndRef.current.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [chatMessages, isChatOpen]);

  const handleSendChatMessage = async (e, customText = null) => {
    if (e && e.preventDefault) e.preventDefault();
    const text = (customText || chatDraft).trim();
    if (!text || chatSending) return;

    const visitorName = chatVisitorName.trim() || "Website Visitor";
    if (chatVisitorName) localStorage.setItem("hisbenew_chat_name", chatVisitorName);
    if (chatVisitorEmail) localStorage.setItem("hisbenew_chat_email", chatVisitorEmail);

    const tempMsg = {
      id: "temp_" + Date.now(),
      sender_name: visitorName,
      is_from_visitor: true,
      body: text,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, tempMsg]);
    setChatDraft("");
    setIsSupportTyping(true);

    setChatSending(true);
    try {
      await api.post("/public-live-chat", {
        session_id: chatSessionId,
        visitor_name: visitorName,
        visitor_email: chatVisitorEmail || null,
        message: text,
      });
      await fetchChatMessages();
    } catch (err) {
      console.error("Chat send error:", err);
    } finally {
      setChatSending(false);
      setTimeout(() => setIsSupportTyping(false), 2000);
    }
  };

  const handleProductChatInquiry = (product) => {
    setIsChatOpen(true);
    const pName = product.name || product.title || "Item";
    const pSku = product.sku || product.article_no || "N/A";
    const inquiryText = `Hi! I would like to inquire about ${pName} (SKU: ${pSku}). Is this in stock for wholesale ordering?`;
    setChatDraft(inquiryText);
    if (selectedProductId) setSelectedProductId(null);
  };
  
  // Checkout Form State
  const [checkoutForm, setCheckoutForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    address: "",
    city: "",
    zip: "",
    paymentMethod: "card",
    notes: "",
  });
  const [checkoutSubmitting, setCheckoutSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState(null);

  useEffect(() => {
    let active = true;

    Promise.allSettled([
      api.get("/website-products"),
      api.get("/website-settings"),
    ]).then(([productsResult, settingsResult]) => {
      if (!active) return;

      if (productsResult.status === "fulfilled") {
        setProducts(Array.isArray(productsResult.value.data) ? productsResult.value.data : []);
      }
      if (settingsResult.status === "fulfilled") {
        setSettings(normalizeWebsiteSettings(settingsResult.value.data));
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

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

  // Preset Hero Categories requested by user
  const PRESET_HERO_CATEGORIES = useMemo(() => [
    "✨ All Collections",
    "Chef Knife Sets",
    "Cleaver Knifes",
    "Folding Knifes",
    "Hunting & Skinner Knifes",
    "Swords",
    "ULU & Pizza Cutters",
  ], []);

  // Category-Wise 3D Coverflow Hero Slider State
  const [selectedHeroCategory, setSelectedHeroCategory] = useState("✨ All Collections");
  const [coverflowIndex, setCoverflowIndex] = useState(0);

  // Showcase 1 product from EVERY category side-by-side or filter by selected pill
  const coverflowProducts = useMemo(() => {
    if (!sortedProducts.length) return [];

    if (selectedHeroCategory === "✨ All Collections" || selectedHeroCategory === "All") {
      const catMap = new Map();
      sortedProducts.forEach((p) => {
        const cat = p.category || "General Collection";
        if (!catMap.has(cat)) catMap.set(cat, []);
        catMap.get(cat).push(p);
      });

      const multiCatItems = [];
      catMap.forEach((pList) => {
        if (pList.length > 0) multiCatItems.push(pList[0]);
      });

      if (multiCatItems.length < 5) {
        sortedProducts.forEach((p) => {
          if (!multiCatItems.some((item) => String(item.id) === String(p.id)) && multiCatItems.length < 6) {
            multiCatItems.push(p);
          }
        });
      }
      return multiCatItems;
    }

    const filtered = sortedProducts.filter((p) => {
      const pCat = (p.category || "").toLowerCase();
      const sCat = selectedHeroCategory.toLowerCase();
      if (pCat === sCat) return true;
      if (sCat.includes("chef") && pCat.includes("chef")) return true;
      if (sCat.includes("cleaver") && pCat.includes("cleaver")) return true;
      if (sCat.includes("folding") && pCat.includes("folding")) return true;
      if (sCat.includes("skinner") && (pCat.includes("skinner") || pCat.includes("hunting"))) return true;
      if (sCat.includes("sword") && pCat.includes("sword")) return true;
      if ((sCat.includes("ulu") || sCat.includes("pizza")) && (pCat.includes("ulu") || pCat.includes("pizza"))) return true;
      return pCat.includes(sCat);
    });

    return filtered.length > 0 ? filtered.slice(0, 6) : sortedProducts.slice(0, 5);
  }, [sortedProducts, selectedHeroCategory]);

  const currentHeroProduct = useMemo(() => {
    if (!coverflowProducts.length) return null;
    return coverflowProducts[coverflowIndex % coverflowProducts.length] || coverflowProducts[0];
  }, [coverflowProducts, coverflowIndex]);

  // Auto-rotate 3D Coverflow Carousel
  useEffect(() => {
    if (!coverflowProducts.length) return;
    const timer = setInterval(() => {
      setCoverflowIndex((prev) => (prev + 1) % coverflowProducts.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [coverflowProducts.length]);

  const filteredProducts = useMemo(() => {
    const search = query.trim().toLowerCase();
    let list = sortedProducts.filter((product) => {
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

    if (sortBy === "price-low") {
      list.sort((a, b) => Number(a.selling_price || 0) - Number(b.selling_price || 0));
    } else if (sortBy === "price-high") {
      list.sort((a, b) => Number(b.selling_price || 0) - Number(a.selling_price || 0));
    } else if (sortBy === "name") {
      list.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
    }

    return list;
  }, [category, query, sortBy, sortedProducts]);

  const summary = useMemo(() => cartSummary(cartItems), [cartItems]);
  const shippingFee = summary.subtotal > 500 || summary.subtotal === 0 ? 0 : 25;
  const orderTotal = summary.subtotal + shippingFee;

  const persistCart = (nextItems) => {
    const savedItems = writeStorefrontCart(nextItems);
    setCartItems(savedItems);
    return savedItems;
  };

  const handleAddToCart = (product, event) => {
    if (event) event.stopPropagation();
    persistCart(addProductToCart(cartItems, product));
    setIsCartOpen(true);
  };

  const toggleWishlist = (productId, event) => {
    if (event) event.stopPropagation();
    setWishlist((prev) => ({
      ...prev,
      [productId]: !prev[productId],
    }));
  };

  const updateQuantity = (productId, quantity) => {
    persistCart(setCartItemQuantity(cartItems, productId, quantity));
  };

  const removeItem = (productId) => {
    persistCart(removeCartItem(cartItems, productId));
  };

  const handleCompleteCheckout = async (e) => {
    e.preventDefault();
    if (!cartItems.length) return;

    if (!checkoutForm.fullName || !checkoutForm.email || !checkoutForm.address) {
      alert("Please fill in your Name, Email, and Address.");
      return;
    }

    setCheckoutSubmitting(true);
    try {
      const payload = {
        customer_name: checkoutForm.fullName,
        customer_email: checkoutForm.email,
        customer_phone: checkoutForm.phone,
        shipping_address: `${checkoutForm.address}, ${checkoutForm.city || ""} ${checkoutForm.zip || ""}`.trim(),
        payment_method: checkoutForm.paymentMethod,
        notes: checkoutForm.notes,
        items: cartItems.map((item) => ({
          id: item.id,
          name: item.name,
          article_no: item.article_no,
          price: item.price,
          quantity: item.quantity,
        })),
        total_usd: orderTotal,
      };

      const res = await api.post("/public-order", payload);
      const createdOrderNo = res.data?.order_id || `ORD-WEB-${Date.now()}`;

      const orderData = {
        order_id: createdOrderNo,
        customer_name: checkoutForm.fullName,
        customer_email: checkoutForm.email,
        customer_phone: checkoutForm.phone,
        shipping_address: `${checkoutForm.address}, ${checkoutForm.city} ${checkoutForm.zip}`,
        payment_method: checkoutForm.paymentMethod,
        items: cartItems,
        total_usd: orderTotal,
        date: new Date().toISOString(),
      };

      persistCart([]);
      setCompletedOrder(orderData);
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Error placing order. Please check backend connection and try again.");
    } finally {
      setCheckoutSubmitting(false);
    }
  };

  const categoryBubbleItems = useMemo(() => {
    if (!sortedProducts.length) return [];

    const catMap = new Map();
    sortedProducts.forEach((p) => {
      const cat = p.category || "Knife Sets";
      if (!catMap.has(cat)) {
        const img = p.image_url ? getStaticUrl(p.image_url) : fallbackCatalogImage;
        catMap.set(cat, { name: cat, img });
      }
    });
    
    const items = Array.from(catMap.values());
    if (!items.length) return [];
    return [...items, ...items, ...items, ...items];
  }, [sortedProducts]);

  const selectedProductPageItem = useMemo(() => {
    if (!selectedProductId || !products.length) return null;
    return products.find((p) => String(p.id) === String(selectedProductId)) || null;
  }, [selectedProductId, products]);

  const relatedProducts = useMemo(() => {
    if (!selectedProductPageItem || !sortedProducts.length) return [];
    const sameCat = sortedProducts.filter(
      (p) => String(p.id) !== String(selectedProductPageItem.id) && p.category === selectedProductPageItem.category
    );
    if (sameCat.length >= 4) return sameCat.slice(0, 4);
    const others = sortedProducts.filter(
      (p) => String(p.id) !== String(selectedProductPageItem.id)
    );
    return others.slice(0, 4);
  }, [selectedProductPageItem, sortedProducts]);

  return (
    <div className="shopify-storefront luxury-theme">
      {/* Announcement Bar */}
      <div className="shopify-announcement-bar">
        <span>✨ EXCLUSIVE WHOLESALE & CRAFTSMAN COLLECTION • ✈️ GLOBAL EXPRESS SHIPPING AVAILABLE</span>
      </div>

      {/* Header */}
      <header className="shopify-header">
        <div className="shopify-header-inner">
          <div className="shopify-header-brand-wrap">
            <button
              className="shopify-mobile-toggle-btn"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              type="button"
              aria-label="Toggle mobile menu"
            >
              {isMobileMenuOpen ? "✕" : "☰"}
            </button>

            <a className="shopify-brand" href="/catalog" onClick={(e) => { e.preventDefault(); closeProductPage(); }}>
              <span className="shopify-brand-mark">HI</span>
              <div className="shopify-brand-text">
                <span className="shopify-brand-title">{settings.brand_name || "HISBENEW CRAFTS"}</span>
                <span className="shopify-brand-sub">LUXURY KNIVES & TOOLS</span>
              </div>
            </a>
          </div>

          <nav className={`shopify-nav ${isMobileMenuOpen ? "is-open" : ""}`}>
            <a href="/catalog" className={!selectedProductPageItem ? "is-active" : ""} onClick={(e) => { e.preventDefault(); closeProductPage(); setIsMobileMenuOpen(false); }}>Home Catalog</a>
            <a href="#catalog" onClick={() => { if (selectedProductPageItem) closeProductPage(); setIsMobileMenuOpen(false); }}>Shop Collection</a>
            <a
              href="#contact"
              onClick={(e) => {
                e.preventDefault();
                setIsMobileMenuOpen(false);
                setIsContactModalOpen(true);
              }}
            >
              Contact Us
            </a>
            <div className="shopify-mobile-drawer-footer">
              <a
                href="/login"
                className="shopify-mobile-drawer-login-btn"
                onClick={() => setIsMobileMenuOpen(false)}
              >
                🔒 Factory Portal Login
              </a>
            </div>
          </nav>

          <div className="shopify-header-right">
            <div className="shopify-search-box">
              <span className="shopify-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search collection..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>

            <button
              className="shopify-cart-trigger-btn"
              onClick={() => setIsCartOpen(true)}
              type="button"
              aria-label="View shopping cart"
            >
              <span className="cart-icon-svg">🛍️</span>
              <span className="cart-badge-count">{summary.count}</span>
            </button>

            <a href="/login" className="shopify-portal-login-btn" title="Factory Admin Login">
              🔒 Login
            </a>
          </div>
        </div>
      </header>

      {/* RENDER DEDICATED STANDALONE PRODUCT PAGE WITH PROPER URL ADDRESS */}
      {selectedProductPageItem ? (
        <main className="shopify-main-container product-standalone-page">
          {/* Single Unified Luxury Top Navigation Bar */}
          <div className="product-page-top-bar">
            <div className="product-page-breadcrumbs">
              <button className="back-to-catalog-btn" onClick={closeProductPage} type="button">
                ← Back to Catalog
              </button>
              <span className="crumb-sep">/</span>
              <a href="/catalog" onClick={(e) => { e.preventDefault(); closeProductPage(); }} className="crumb-link">
                Storefront
              </a>
              <span className="crumb-sep">/</span>
              <span className="crumb-cat">{selectedProductPageItem.category || "Cutlery"}</span>
              <span className="crumb-sep">/</span>
              <span className="crumb-active">{selectedProductPageItem.name || selectedProductPageItem.article_no}</span>
            </div>

            <div className="product-page-share-bar">
              <button
                className="product-page-share-btn"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/catalog?product=${selectedProductPageItem.id}`);
                  alert("Product page address copied to clipboard!");
                }}
                title="Copy shareable product link"
              >
                🔗 Share Product Address
              </button>
            </div>
          </div>

          {/* Seamless Product Detail Workspace */}
          <div className="product-page-main-workspace">
            <div className="product-page-layout">
              {/* Left Column: Image Gallery & Badges */}
              <div className="product-page-gallery-col">
                <div className="product-page-main-frame">
                  <span className="product-page-forge-tag">🔥 BESTSELLER</span>
                  {productImageUrl(selectedProductPageItem) ? (
                    <img
                      src={
                        activeModalImgIdx === 0
                          ? productImageUrl(selectedProductPageItem)
                          : activeModalImgIdx === 1
                          ? "https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=1000&q=80"
                          : "https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=1000&q=80"
                      }
                      alt={selectedProductPageItem.name}
                    />
                  ) : (
                    <div className="shopify-no-img-lg">{selectedProductPageItem.article_no}</div>
                  )}
                </div>

                <div className="product-page-thumbs">
                  <button className={`thumb-btn ${activeModalImgIdx === 0 ? "is-active" : ""}`} onClick={() => setActiveModalImgIdx(0)}>
                    {productImageUrl(selectedProductPageItem) ? (
                      <img src={productImageUrl(selectedProductPageItem)} alt="View 1" />
                    ) : (
                      <span>Front</span>
                    )}
                  </button>
                  <button className={`thumb-btn ${activeModalImgIdx === 1 ? "is-active" : ""}`} onClick={() => setActiveModalImgIdx(1)}>
                    <img src="https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&w=300&q=80" alt="Detail" />
                  </button>
                  <button className={`thumb-btn ${activeModalImgIdx === 2 ? "is-active" : ""}`} onClick={() => setActiveModalImgIdx(2)}>
                    <img src="https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=300&q=80" alt="Sheath" />
                  </button>
                </div>

                <div className="product-page-trust-bar">
                  <div>
                    <span className="trust-icon">✈️</span>
                    <div>
                      <strong>DHL Express Shipping</strong>
                      <small>Worldwide 3-5 Day Delivery</small>
                    </div>
                  </div>
                  <div>
                    <span className="trust-icon">🛡️</span>
                    <div>
                      <strong>Lifetime Guarantee</strong>
                      <small>Handmade Forging Warranty</small>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Details & Pricing */}
              <div className="product-page-details-col">
                <div className="product-page-rating">
                  <span className="stars">★★★★★</span>
                  <strong className="score">4.9</strong>
                  <span className="count">(142 Customer Reviews)</span>
                  <span className="stock-pill">In Stock • Ships Fast</span>
                </div>

                <h1 className="product-page-title">{selectedProductPageItem.name || selectedProductPageItem.article_no}</h1>
                <div className="product-page-sku">
                  <span>Article / SKU: <strong>{selectedProductPageItem.article_no || "KLF-414"}</strong></span>
                  <span>Category: <strong>{selectedProductPageItem.category || "Factory Knife"}</strong></span>
                </div>

                <div className="product-page-price-box">
                  <span className="current-price">
                    {formatUsdPrice(
                      (productModalQty >= 21
                        ? Number(selectedProductPageItem.selling_price || 0) * 0.7
                        : productModalQty >= 6
                        ? Number(selectedProductPageItem.selling_price || 0) * 0.84
                        : Number(selectedProductPageItem.selling_price || 0)) * productModalQty
                    )}
                  </span>
                  <span className="msrp-cross">
                    MSRP {formatUsdPrice((Number(selectedProductPageItem.selling_price || 0) * 1.8) * productModalQty)}
                  </span>
                  <span className="save-badge">
                    Save {productModalQty >= 21 ? "30% Wholesale" : productModalQty >= 6 ? "16% Bulk" : "44% Today"}
                  </span>
                </div>

                <div className="product-page-wholesale-tiers">
                  <div className={`tier-card ${productModalQty <= 5 ? "is-active" : ""}`}>
                    <strong>1 – 5 Pcs</strong>
                    <span>{formatUsdPrice(selectedProductPageItem.selling_price)}/ea</span>
                    <small>Standard Tier</small>
                  </div>
                  <div className={`tier-card ${productModalQty >= 6 && productModalQty <= 20 ? "is-active" : ""}`}>
                    <strong>6 – 20 Pcs</strong>
                    <span>{formatUsdPrice(Number(selectedProductPageItem.selling_price || 0) * 0.84)}/ea</span>
                    <small className="green-text">Save 16%</small>
                  </div>
                  <div className={`tier-card ${productModalQty >= 21 ? "is-active" : ""}`}>
                    <strong>21+ Wholesale</strong>
                    <span>{formatUsdPrice(Number(selectedProductPageItem.selling_price || 0) * 0.70)}/ea</span>
                    <small className="gold-text">Save 30% Wholesale</small>
                  </div>
                </div>

                <div className="product-page-qty-row">
                  <label>Quantity:</label>
                  <div className="product-page-qty-selector">
                    <button onClick={() => setProductModalQty((q) => Math.max(1, q - 1))} type="button">-</button>
                    <input type="number" min="1" value={productModalQty} onChange={(e) => setProductModalQty(Math.max(1, parseInt(e.target.value) || 1))} />
                    <button onClick={() => setProductModalQty((q) => q + 1)} type="button">+</button>
                  </div>
                  <span className="qty-total-text">
                    Total: <strong>
                      {formatUsdPrice(
                        (productModalQty >= 21
                          ? Number(selectedProductPageItem.selling_price || 0) * 0.7
                          : productModalQty >= 6
                          ? Number(selectedProductPageItem.selling_price || 0) * 0.84
                          : Number(selectedProductPageItem.selling_price || 0)) * productModalQty
                      )}
                    </strong>
                  </span>
                </div>

                <div className="product-page-cta-group">
                  <button
                    className="product-page-add-cart-btn"
                    onClick={() => {
                      for (let i = 0; i < productModalQty; i++) {
                        handleAddToCart(selectedProductPageItem);
                      }
                      setIsCartOpen(true);
                    }}
                  >
                    🛒 Add {productModalQty > 1 ? `${productModalQty} Items` : ""} to Cart • {formatUsdPrice(
                      (productModalQty >= 21
                        ? Number(selectedProductPageItem.selling_price || 0) * 0.7
                        : productModalQty >= 6
                        ? Number(selectedProductPageItem.selling_price || 0) * 0.84
                        : Number(selectedProductPageItem.selling_price || 0)) * productModalQty
                    )}
                  </button>

                  <button
                    className="product-page-chat-btn"
                    onClick={() => handleProductChatInquiry(selectedProductPageItem)}
                    type="button"
                  >
                    💬 Live Chat Inquiry
                  </button>
                </div>

                <div className="product-page-tabs-container">
                  <div className="product-page-tab-headers">
                    <button className={productModalTab === "specs" ? "is-active" : ""} onClick={() => setProductModalTab("specs")}>
                      Specifications
                    </button>
                    <button className={productModalTab === "wholesale" ? "is-active" : ""} onClick={() => setProductModalTab("wholesale")}>
                      OEM & Wholesale
                    </button>
                    <button className={productModalTab === "reviews" ? "is-active" : ""} onClick={() => setProductModalTab("reviews")}>
                      Reviews (142)
                    </button>
                  </div>

                  <div className="product-page-tab-content">
                    {productModalTab === "specs" && (
                      <div className="product-specs-grid">
                        <div className="spec-row"><span>Blade Material:</span> <strong>Hand-Forged 1095 / 15N20 Damascus (352 Layers)</strong></div>
                        <div className="spec-row"><span>Handle Material:</span> <strong>Natural Premium Rosewood & Brass Bolster</strong></div>
                        <div className="spec-row"><span>Hardness:</span> <strong>58-60 HRC Heat Treated</strong></div>
                        <div className="spec-row"><span>Overall Length:</span> <strong>10.5 inches (5.5" Blade, 5.0" Handle)</strong></div>
                        <div className="spec-row"><span>Leather Sheath:</span> <strong>Includes 100% Genuine Stitched Cowhide Sheath</strong></div>
                      </div>
                    )}

                    {productModalTab === "wholesale" && (
                      <div className="product-wholesale-info">
                        <p><strong>Custom Branding Available:</strong> Laser logo etching, custom handles & OEM packaging available for orders over 50 units.</p>
                      </div>
                    )}

                    {productModalTab === "reviews" && (
                      <div className="product-reviews-list">
                        <div className="review-card">
                          <div className="review-header">
                            <span className="stars">★★★★★</span>
                            <strong>Marcus T. (Texas, USA)</strong>
                            <span className="verified-badge">✓ Verified Purchaser</span>
                          </div>
                          <p>"Incredible weight and edge retention. The Damascus pattern is genuinely hand-forged."</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* RELATED & FEATURED PRODUCTS SECTION */}
          {relatedProducts.length > 0 && (
            <section className="product-page-related-section">
              <div className="section-title-block">
                <div>
                  <span className="section-eyebrow">CURATED CRAFTSMANSHIP</span>
                  <h2 className="section-heading">You May Also Like</h2>
                </div>
                <span className="section-count-badge">Handcrafted Recommendations</span>
              </div>

              <div className="luxury-product-grid">
                {relatedProducts.map((relProduct, idx) => {
                  const relImg = productImageUrl(relProduct);
                  const relIsWishlisted = !!wishlist[relProduct.id];
                  const relMsrp = Number(relProduct.selling_price || 0) * 1.2;

                  return (
                    <div
                      key={relProduct.id}
                      className="faire-square-card"
                      onClick={(e) => openProductPage(relProduct, e)}
                    >
                      <div className="faire-card-media-square">
                        {relImg ? (
                          <img src={relImg} alt={relProduct.name || relProduct.article_no} className="faire-square-img" />
                        ) : (
                          <div className="faire-no-img">
                            <span>{relProduct.article_no || "Crafted Item"}</span>
                          </div>
                        )}

                        {idx === 0 && (
                          <div className="faire-card-badge-wrap glass-bottom">
                            <span className="faire-badge-pill is-bestseller">🔥 BESTSELLER</span>
                          </div>
                        )}

                        <button
                          className={`faire-wishlist-heart ${relIsWishlisted ? "is-liked" : ""}`}
                          onClick={(e) => toggleWishlist(relProduct.id, e)}
                          title="Add to Wishlist"
                        >
                          {relIsWishlisted ? "♥" : "♡"}
                        </button>

                        <div className="faire-hover-actions">
                          <button
                            className="faire-quick-add-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddToCart(relProduct, e);
                            }}
                          >
                            + Quick Add
                          </button>
                        </div>
                      </div>

                      <div className="faire-card-content">
                        <div className="faire-price-line">
                          <span className="faire-main-price">{formatUsdPrice(relProduct.selling_price)}</span>
                          <span className="faire-msrp-text">MSRP {formatUsdPrice(relMsrp)}</span>
                        </div>

                        <h3 className="faire-product-name" title={relProduct.name || relProduct.article_no}>
                          {relProduct.name || relProduct.article_no}
                        </h3>

                        <div className="faire-case-info">
                          Case of 1 • {relProduct.category || "Factory Knife"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </main>
      ) : (
          /* NORMAL STOREFRONT CATALOG VIEW */
          <Fragment>
            {/* Category-Wise 3D Coverflow Perspective Hero Slider */}
            {coverflowProducts.length > 0 && currentHeroProduct && (
            <section className="shopify-hero-slider">
              <div className="hero-slider-inner">
                {/* Left Column: Premium Copy & Wholesale/Customize CTAs */}
                <div className="hero-slide-copy">
                  <span className="hero-spotlight-badge">
                    ⭐ FACTORY DIRECT • {(currentHeroProduct.category || "WHOLESALE & OEM").toUpperCase()}
                  </span>
                  <h1 className="hero-slide-title">
                    Handcrafted Masterpieces & Custom Blade Forging
                  </h1>
                  <p className="hero-slide-desc">
                    {currentHeroProduct.notes
                      ? currentHeroProduct.notes.length > 130
                        ? currentHeroProduct.notes.slice(0, 130) + "..."
                        : currentHeroProduct.notes
                      : "Direct factory pricing on 1095/15N20 Damascus steel, custom laser logo etching, Rosewood grips, and cowhide sheaths."}
                  </p>

                  <div className="hero-feature-pills">
                    <span className="hero-feat-pill">✔ 100% Hand-Forged</span>
                    <span className="hero-feat-pill">✈️ Express Shipping</span>
                    <span className="hero-feat-pill">🛡️ Quality Guarantee</span>
                  </div>

                  <div className="hero-actions">
                    <button
                      className="hero-primary-btn"
                      onClick={() => {
                        setContactForm((prev) => ({ ...prev, inquiryType: "Wholesale Inquiry" }));
                        setIsContactModalOpen(true);
                      }}
                      type="button"
                    >
                      📦 Wholesale Inquiry
                    </button>

                    <button
                      className="hero-secondary-btn"
                      onClick={() => {
                        setContactForm((prev) => ({ ...prev, inquiryType: "Custom Order" }));
                        setIsContactModalOpen(true);
                      }}
                      type="button"
                    >
                      🛠️ Customize / OEM Order
                    </button>
                  </div>
                </div>

                {/* Right Column: 3D Coverflow Perspective Card Stack Stage */}
                <div className="hero-coverflow-stage">
                  {coverflowProducts.map((prod, idx) => {
                    const total = coverflowProducts.length;
                    const activeIdx = coverflowIndex % total;
                    let diff = idx - activeIdx;

                    if (diff > Math.floor(total / 2)) diff -= total;
                    if (diff < -Math.floor(total / 2)) diff += total;

                    let posClass = "pos-hidden";
                    if (diff === 0) posClass = "pos-center";
                    else if (diff === -1) posClass = "pos-left-1";
                    else if (diff === 1) posClass = "pos-right-1";
                    else if (diff === -2) posClass = "pos-left-2";
                    else if (diff === 2) posClass = "pos-right-2";

                    const imgUrl = productImageUrl(prod) || fallbackCatalogImage;

                    return (
                      <div
                        key={prod.id || idx}
                        className={`coverflow-card ${posClass}`}
                        onClick={() => setCoverflowIndex(idx)}
                      >
                        <div className="coverflow-card-media">
                          <img src={imgUrl} alt={prod.name} className="coverflow-card-img" />
                          <div className="coverflow-card-overlay">
                            <h4 className="coverflow-card-title">{prod.name || prod.article_no}</h4>
                            <span className="coverflow-card-price">{formatUsdPrice(prod.selling_price)}</span>
                          </div>
                        </div>
                        <span className="coverflow-card-cat-badge">{prod.category || "Factory Knife"}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Slider Navigation Arrows & Dots */}
              <button
                className="slider-arrow prev"
                onClick={() => setCoverflowIndex((prev) => (prev - 1 + coverflowProducts.length) % coverflowProducts.length)}
              >
                ❮
              </button>
              <button
                className="slider-arrow next"
                onClick={() => setCoverflowIndex((prev) => (prev + 1) % coverflowProducts.length)}
              >
                ❯
              </button>

              <div className="slider-dots">
                {coverflowProducts.map((_, idx) => (
                  <button
                    key={idx}
                    className={`slider-dot ${idx === (coverflowIndex % coverflowProducts.length) ? "is-active" : ""}`}
                    onClick={() => setCoverflowIndex(idx)}
                  ></button>
                ))}
              </div>
            </section>
          )}

          {/* Mobile Only Feature Pills (shown below slider & above Featured Collections) */}
          <div className="mobile-after-slider-bar">
            <div className="mobile-feature-pills-row">
              <span className="mobile-feat-pill">✔ 100% Hand-Forged</span>
              <span className="mobile-feat-pill">✈️ Express Shipping</span>
              <span className="mobile-feat-pill">🛡️ Quality Guarantee</span>
            </div>
          </div>

          {/* Automated Moving Circular Category Showcase Slider */}
          {categoryBubbleItems.length > 0 && (
            <section className="auto-category-marquee-section">
              <div className="marquee-section-header">
                <span className="marquee-tag">PRODUCT CATEGORIES</span>
                <h3 className="marquee-title">Featured Collections</h3>
              </div>

              <div className="marquee-viewport">
                <div className="marquee-track">
                  {categoryBubbleItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="category-circle-card"
                      onClick={() => {
                        setCategory(item.name);
                        document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
                      }}
                    >
                      <div className="category-circle-img-wrap">
                        <img src={item.img} alt={item.name} />
                      </div>
                      <span className="category-circle-name">{item.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Main Catalog Workspace */}
          <main className="shopify-main-container" id="catalog">
            <div className="section-title-block">
              <div>
                <span className="section-eyebrow">HANDMADE CATALOG</span>
                <h2>Wholesale Knives & Tools</h2>
              </div>
              <span className="count-tag">{filteredProducts.length} Items Available</span>
            </div>

            <div className="shopify-toolbar">
              <div className="shopify-category-pills">
                {categories.map((cat) => (
                  <button
                    key={cat}
                    className={`shopify-pill-btn ${category === cat ? "is-active" : ""}`}
                    onClick={() => setCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="shopify-sort-wrapper">
                <div className="shopify-control-item">
                  <span>Tag Style:</span>
                  <select value={tagStyle} onChange={(e) => setTagStyle(e.target.value)}>
                    <option value="glass-bottom">Style 1: Bottom Glass Capsule</option>
                    <option value="inline-title">Style 2: Inline Title Badge</option>
                    <option value="corner-ribbon">Style 3: Corner Metallic Ribbon</option>
                  </select>
                </div>

                <div className="shopify-control-item">
                  <span>Sort By:</span>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="featured">Featured / Custom Order</option>
                    <option value="price-low">Price: Low to High</option>
                    <option value="price-high">Price: High to Low</option>
                    <option value="name">Product Name (A-Z)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Luxury Product Grid */}
            {loading ? (
              <div className="shopify-loading-state">
                <div className="shopify-loader-spinner"></div>
                <p>Loading master collection...</p>
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="shopify-empty-state">
                <h3>No products found</h3>
                <p>Try selecting a different category or clear search query.</p>
                <button onClick={() => { setQuery(""); setCategory("All"); }}>Show All Products</button>
              </div>
            ) : (
              <div className="luxury-product-grid">
                {filteredProducts.map((product, idx) => {
                  const imgUrl = productImageUrl(product);
                  const isWishlisted = !!wishlist[product.id];
                  const msrp = Number(product.selling_price || 0) * 1.2;
                  const showBestseller = idx === 0 || idx === 4;
                  const showNew = idx === 1;

                  return (
                    <div
                      key={product.id}
                      className="faire-square-card"
                      onClick={(e) => openProductPage(product, e)}
                    >
                      <div className="faire-card-media-square">
                        {imgUrl ? (
                          <img src={imgUrl} alt={product.name || product.article_no} className="faire-square-img" />
                        ) : (
                          <div className="faire-no-img">
                            <span>{product.article_no || "Crafted Item"}</span>
                          </div>
                        )}

                        {(showBestseller || showNew) && tagStyle !== "inline-title" && (
                          <div className={`faire-card-badge-wrap ${tagStyle}`}>
                            <span className={`faire-badge-pill ${showBestseller ? "is-bestseller" : "is-new"}`}>
                              {showBestseller ? "🔥 BESTSELLER" : "✨ NEW ARRIVAL"}
                            </span>
                          </div>
                        )}

                        <button
                          className={`faire-wishlist-heart ${isWishlisted ? "is-liked" : ""}`}
                          onClick={(e) => toggleWishlist(product.id, e)}
                          title="Add to Wishlist"
                        >
                          {isWishlisted ? "♥" : "♡"}
                        </button>

                        <div className="faire-hover-actions">
                          <button
                            className="faire-quick-add-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddToCart(product, e);
                            }}
                          >
                            + Quick Add
                          </button>
                        </div>
                      </div>

                      <div className="faire-card-content">
                        {(showBestseller || showNew) && tagStyle === "inline-title" && (
                          <div className="faire-inline-badge-row">
                            <span className={`faire-badge-pill inline-style ${showBestseller ? "is-bestseller" : "is-new"}`}>
                              {showBestseller ? "🔥 BESTSELLER" : "✨ NEW ARRIVAL"}
                            </span>
                          </div>
                        )}

                        <div className="faire-price-line">
                          <span className="faire-main-price">{formatUsdPrice(product.selling_price)}</span>
                          <span className="faire-msrp-text">MSRP {formatUsdPrice(msrp)}</span>
                        </div>

                        <h3 className="faire-product-name" title={product.name || product.article_no}>
                          {product.name || product.article_no}
                        </h3>

                        <div className="faire-case-info">
                          Case of 1 • {product.category || "Factory Knife"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </main>
        </Fragment>
      )}
      <footer className="shopify-footer">
        <div className="shopify-footer-inner">
          <div className="footer-col brand-col">
            <div className="footer-brand">
              <span className="footer-logo-mark">HI</span>
              <span className="footer-brand-name">{settings.brand_name || "Hisbenew Crafts"}</span>
            </div>
            <p className="footer-tagline">
              {settings.tagline || "Handmade Chef Knives, Hunting Blades & Wholesale Cutlery Manufacturing."}
            </p>
          </div>

          <div className="footer-col links-col">
            <h4>Quick Links</h4>
            <a href="/">Storefront Home</a>
            <a href="#catalog">Shop Full Catalog</a>
            <a href="#featured">Featured Blades</a>
            <a href="/login">Factory Portal Sign In</a>
          </div>

          <div className="footer-col links-col">
            <h4>Customer Support</h4>
            <a href="#catalog">Express Shipping Terms</a>
            <a href="#catalog">Wholesale Orders</a>
            <a href="#catalog">Craftsmanship Guarantee</a>
            <a href="#catalog">Returns & Refunds</a>
          </div>

          <div className="footer-col trust-col">
            <h4>Accepted Payments</h4>
            <div className="footer-payment-badges">
              <span className="pay-badge">VISA</span>
              <span className="pay-badge">MASTERCARD</span>
              <span className="pay-badge">AMEX</span>
              <span className="pay-badge">PAYPAL</span>
              <span className="pay-badge">INVOICE PO</span>
            </div>
            <div className="footer-security-text">
              🔒 256-Bit SSL Encrypted & Secured Checkout
            </div>
          </div>
        </div>

        <div className="shopify-footer-bottom">
          <span>© {new Date().getFullYear()} {settings.brand_name || "Hisbenew Industries"}. All rights reserved.</span>
          <span>Precision Handmade Knife & Tool Manufacturing</span>
        </div>
      </footer>

      {/* Slide-out Cart Drawer Overlay */}
      {isCartOpen && (
        <div className="shopify-cart-overlay" onClick={() => setIsCartOpen(false)}>
          <div className="shopify-cart-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="shopify-drawer-header">
              <h3>Shopping Cart ({summary.count})</h3>
              <button className="shopify-close-drawer-btn" onClick={() => setIsCartOpen(false)}>✕</button>
            </div>

            <div className="shopify-free-shipping-box">
              {summary.subtotal >= 500 ? (
                <span className="shipping-unlocked">🎉 You unlocked FREE Express Shipping!</span>
              ) : (
                <span>Add {formatUsdPrice(500 - summary.subtotal)} more for <strong>FREE Express Shipping</strong></span>
              )}
              <div className="shopify-progress-bar">
                <div
                  className="shopify-progress-fill"
                  style={{ width: `${Math.min(100, (summary.subtotal / 500) * 100)}%` }}
                ></div>
              </div>
            </div>

            <div className="shopify-drawer-body">
              {cartItems.length === 0 ? (
                <div className="shopify-empty-cart">
                  <div className="empty-cart-badge-icon">🛍️</div>
                  <h4>Your Cart is Empty</h4>
                  <p>Discover our handcrafted chef knives, hunting blades & factory wholesale collections.</p>
                  <button
                    className="empty-cart-explore-btn"
                    onClick={() => {
                      setIsCartOpen(false);
                      document.getElementById("catalog")?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Start Shopping ➔
                  </button>
                </div>
              ) : (
                cartItems.map((item) => (
                  <div key={item.id} className="shopify-cart-item">
                    <div className="shopify-item-thumb">
                      {item.image_url ? (
                        <img src={getStaticUrl(item.image_url)} alt={item.name} />
                      ) : (
                        <span>{item.article_no}</span>
                      )}
                    </div>

                    <div className="shopify-item-info">
                      <h4>{item.name}</h4>
                      <span className="shopify-item-price">{formatUsdPrice(item.price)}</span>
                      
                      <div className="shopify-qty-controls">
                        <button onClick={() => updateQuantity(item.id, item.quantity - 1)}>-</button>
                        <span>{item.quantity}</span>
                        <button onClick={() => updateQuantity(item.id, item.quantity + 1)}>+</button>
                      </div>
                    </div>

                    <button className="shopify-remove-item-btn" onClick={() => removeItem(item.id)}>Remove</button>
                  </div>
                ))
              )}
            </div>

            {cartItems.length > 0 && (
              <div className="shopify-drawer-footer">
                <div className="shopify-summary-row">
                  <span>Subtotal</span>
                  <strong>{formatUsdPrice(summary.subtotal)}</strong>
                </div>
                <div className="shopify-summary-row">
                  <span>Shipping</span>
                  <span>{shippingFee === 0 ? "FREE" : formatUsdPrice(shippingFee)}</span>
                </div>
                <div className="shopify-summary-row total-row">
                  <span>Total (USD)</span>
                  <strong>{formatUsdPrice(orderTotal)}</strong>
                </div>

                <button
                  className="shopify-checkout-btn"
                  onClick={() => {
                    setIsCartOpen(false);
                    setIsCheckoutOpen(true);
                  }}
                >
                  Proceed to Checkout ➔
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="shopify-modal-overlay" onClick={() => setIsCheckoutOpen(false)}>
          <div className="shopify-checkout-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shopify-checkout-header">
              <h2>🔒 Secure Order Checkout</h2>
              <button className="shopify-modal-close" onClick={() => setIsCheckoutOpen(false)}>✕</button>
            </div>

            {completedOrder ? (
              <div className="shopify-order-success">
                <div className="success-icon">✓</div>
                <h3>Order Placed Successfully!</h3>
                <p>Order reference <strong>#{completedOrder.order_id}</strong> has been created in the system.</p>
                <div className="order-receipt-box">
                  <div><strong>Customer:</strong> {completedOrder.customer_name} ({completedOrder.customer_email})</div>
                  <div><strong>Address:</strong> {completedOrder.shipping_address}</div>
                  <div><strong>Total Amount:</strong> {formatUsdPrice(completedOrder.total_usd)}</div>
                </div>
                <button
                  className="shopify-checkout-btn"
                  onClick={() => {
                    setCompletedOrder(null);
                    setIsCheckoutOpen(false);
                  }}
                >
                  Continue Shopping
                </button>
              </div>
            ) : (
              <form className="shopify-checkout-form" onSubmit={handleCompleteCheckout}>
                <div className="shopify-checkout-grid">
                  <div className="checkout-left">
                    <h3>Customer & Delivery Address</h3>
                    <div className="checkout-field-row">
                      <input
                        type="text"
                        placeholder="Full Name *"
                        required
                        value={checkoutForm.fullName}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, fullName: e.target.value })}
                      />
                    </div>
                    <div className="checkout-field-row grid-2">
                      <input
                        type="email"
                        placeholder="Email Address *"
                        required
                        value={checkoutForm.email}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, email: e.target.value })}
                      />
                      <input
                        type="tel"
                        placeholder="Phone Number"
                        value={checkoutForm.phone}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, phone: e.target.value })}
                      />
                    </div>
                    <div className="checkout-field-row">
                      <input
                        type="text"
                        placeholder="Street Shipping Address *"
                        required
                        value={checkoutForm.address}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, address: e.target.value })}
                      />
                    </div>
                    <div className="checkout-field-row grid-2">
                      <input
                        type="text"
                        placeholder="City"
                        value={checkoutForm.city}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, city: e.target.value })}
                      />
                      <input
                        type="text"
                        placeholder="ZIP / Postal Code"
                        value={checkoutForm.zip}
                        onChange={(e) => setCheckoutForm({ ...checkoutForm, zip: e.target.value })}
                      />
                    </div>

                    <h3 className="mt-4">Payment Option</h3>
                    <div className="checkout-payment-options">
                      <label className="payment-radio">
                        <input
                          type="radio"
                          name="payment"
                          value="card"
                          checked={checkoutForm.paymentMethod === "card"}
                          onChange={(e) => setCheckoutForm({ ...checkoutForm, paymentMethod: e.target.value })}
                        />
                        <span>💳 Credit / Debit Card</span>
                      </label>
                      <label className="payment-radio">
                        <input
                          type="radio"
                          name="payment"
                          value="invoice"
                          checked={checkoutForm.paymentMethod === "invoice"}
                          onChange={(e) => setCheckoutForm({ ...checkoutForm, paymentMethod: e.target.value })}
                        />
                        <span>📄 Invoice / Purchase Order</span>
                      </label>
                    </div>
                  </div>

                  <div className="checkout-right">
                    <h3>Summary ({summary.count} Items)</h3>
                    <div className="checkout-items-preview">
                      {cartItems.map((item) => (
                        <div key={item.id} className="preview-item">
                          <span>{item.name} x {item.quantity}</span>
                          <strong>{formatUsdPrice(item.price * item.quantity)}</strong>
                        </div>
                      ))}
                    </div>

                    <div className="checkout-totals">
                      <div>Subtotal: <span>{formatUsdPrice(summary.subtotal)}</span></div>
                      <div>Shipping: <span>{shippingFee === 0 ? "FREE" : formatUsdPrice(shippingFee)}</span></div>
                      <div className="final-total">Total: <span>{formatUsdPrice(orderTotal)}</span></div>
                    </div>

                    <button type="submit" className="shopify-checkout-btn" disabled={checkoutSubmitting}>
                      {checkoutSubmitting ? "Placing Order..." : `Confirm & Pay ${formatUsdPrice(orderTotal)}`}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {/* Contact Us Modal */}
      {isContactModalOpen && (
        <div className="shopify-cart-overlay" onClick={() => setIsContactModalOpen(false)}>
          <div className="shopify-contact-modal" onClick={(e) => e.stopPropagation()}>
            <div className="shopify-modal-header">
              <h3>Contact Factory Support & Wholesale Sales</h3>
              <button className="shopify-close-drawer-btn" onClick={() => setIsContactModalOpen(false)}>✕</button>
            </div>

            {contactSubmitted ? (
              <div className="shopify-order-success">
                <div className="success-icon">✓</div>
                <h3>Message Sent Successfully!</h3>
                <p>Thank you for reaching out. Our factory sales team will respond to <strong>{contactForm.email}</strong> within 24 hours.</p>
              </div>
            ) : (
              <div className="contact-modal-grid">
                <div className="contact-info-card">
                  <h4>Factory & Headquarters</h4>
                  <div className="contact-info-item">
                    <strong>📍 Factory Address:</strong>
                    <p>P/O Khaas Talwara, Sohdra, Tehsil Wazirabad, Wazirabad 52030, Pakistan</p>
                  </div>
                  <div className="contact-info-item">
                    <strong>✉️ Direct Email:</strong>
                    <p>support@hisbenew.com / sales@hisbenew.com</p>
                  </div>
                  <div className="contact-info-item">
                    <strong>📞 Phone & WhatsApp:</strong>
                    <p>+92 (300) 123-4567</p>
                  </div>
                  <div className="contact-info-item">
                    <strong>🕒 Business Hours:</strong>
                    <p>Monday – Saturday: 9:00 AM – 6:00 PM (PKT)</p>
                  </div>
                </div>

                <form className="contact-form" onSubmit={handleContactSubmit}>
                  <div className="checkout-field-row grid-2">
                    <div className="field-group">
                      <label>Your Name *</label>
                      <input
                        type="text"
                        required
                        placeholder="John Doe"
                        value={contactForm.name}
                        onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Email Address *</label>
                      <input
                        type="email"
                        required
                        placeholder="john@company.com"
                        value={contactForm.email}
                        onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="checkout-field-row grid-2">
                    <div className="field-group">
                      <label>Phone / WhatsApp</label>
                      <input
                        type="tel"
                        placeholder="+1 (555) 000-0000"
                        value={contactForm.phone}
                        onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })}
                      />
                    </div>
                    <div className="field-group">
                      <label>Inquiry Type</label>
                      <select
                        value={contactForm.inquiryType}
                        onChange={(e) => setContactForm({ ...contactForm, inquiryType: e.target.value })}
                      >
                        <option value="Wholesale Inquiry">Wholesale & Bulk Orders</option>
                        <option value="Custom Order">Custom OEM Knife Orders</option>
                        <option value="General Support">General Support & Tracking</option>
                      </select>
                    </div>
                  </div>

                  <div className="field-group">
                    <label>Your Message / Inquiry Details *</label>
                    <textarea
                      rows="4"
                      required
                      placeholder="Specify order quantity, blade specifications, custom logos, or questions..."
                      value={contactForm.message}
                      onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })}
                    ></textarea>
                  </div>

                  <button type="submit" className="shopify-checkout-btn">
                    Send Inquiry to Factory ➔
                  </button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Floating Live Chat Widget */}
      <div className="shopify-livechat-widget-container">
        {!isChatOpen ? (
          <button
            className="shopify-livechat-trigger-btn"
            onClick={() => setIsChatOpen(true)}
            type="button"
          >
            <span className="livechat-icon">💬</span>
            <span className="livechat-text">Chat with Hisbenew</span>
            {unreadChatCount > 0 ? (
              <span className="livechat-unread-pill">{unreadChatCount}</span>
            ) : (
              <span className="livechat-online-dot"></span>
            )}
          </button>
        ) : (
          <div className="shopify-livechat-popup">
            <div className="livechat-header">
              <div className="livechat-brand">
                <span className="livechat-avatar">HI</span>
                <div>
                  <strong>Hisbenew Live Support</strong>
                  <span className="livechat-status"><span className="green-dot"></span> Online • Responds in &lt; 2 mins</span>
                </div>
              </div>
              <button
                className="livechat-close-btn"
                onClick={() => setIsChatOpen(false)}
                type="button"
              >
                ✕
              </button>
            </div>

            <div className="livechat-body">
              {chatMessages.length === 0 ? (
                <div className="livechat-welcome-card">
                  <div className="welcome-icon">👋</div>
                  <h4>Welcome to Hisbenew Crafts!</h4>
                  <p>Ask us anything about wholesale orders, custom blade forging, specs, or shipping.</p>
                  
                  {/* Quick Action Chips */}
                  <div className="livechat-quick-chips">
                    {QUICK_CHAT_CHIPS.map((chip) => (
                      <button
                        key={chip.label}
                        className="livechat-chip-btn"
                        onClick={(e) => handleSendChatMessage(e, chip.msg)}
                        type="button"
                      >
                        {chip.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`livechat-msg-row ${msg.is_from_visitor ? "visitor" : "support"}`}
                >
                  <div className="livechat-msg-bubble">
                    <span className="msg-sender-label">{msg.sender_name}</span>
                    <p>{msg.body}</p>
                    <span className="msg-time">{formatUtcLocal(msg.created_at)}</span>
                  </div>
                </div>
              ))}

              {isSupportTyping && (
                <div className="livechat-msg-row support">
                  <div className="livechat-msg-bubble is-typing">
                    <span className="typing-dots"><span>.</span><span>.</span><span>.</span></span>
                    <span>Support is typing</span>
                  </div>
                </div>
              )}

              <div ref={chatMessagesEndRef} />
            </div>

            <form className="livechat-footer-form" noValidate onSubmit={handleSendChatMessage}>
              {chatMessages.length === 0 && (
                <div className="livechat-identity-inputs">
                  <input
                    type="text"
                    placeholder="Your Name (Optional)"
                    value={chatVisitorName}
                    onChange={(e) => setChatVisitorName(e.target.value)}
                  />
                  <input
                    type="text"
                    placeholder="Your Email / Phone (Optional)"
                    value={chatVisitorEmail}
                    onChange={(e) => setChatVisitorEmail(e.target.value)}
                  />
                </div>
              )}
              <div className="livechat-input-row">
                <input
                  type="text"
                  placeholder="Type your message..."
                  value={chatDraft}
                  onChange={(e) => setChatDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChatMessage(e);
                    }
                  }}
                  required
                />
                <button type="submit" disabled={chatSending}>
                  {chatSending ? "..." : "Send ➔"}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
