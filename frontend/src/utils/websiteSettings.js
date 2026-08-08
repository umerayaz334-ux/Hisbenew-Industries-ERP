export const WEBSITE_SECTIONS = [
  {
    id: "hero",
    label: "Hero",
    description: "First screen, primary headline, and calls to action.",
  },
  {
    id: "trust",
    label: "Trust bar",
    description: "Buyer metrics, credibility, and quick proof points.",
  },
  {
    id: "collections",
    label: "Collections",
    description: "Category cards generated from live product categories.",
  },
  {
    id: "featured",
    label: "Featured products",
    description: "Selected products shown on the homepage.",
  },
  {
    id: "about",
    label: "About",
    description: "Brand story and production quality message.",
  },
  {
    id: "process",
    label: "Process",
    description: "How buyers inquire, confirm, and receive orders.",
  },
  {
    id: "contact",
    label: "Contact",
    description: "Sales call-to-action and contact routes.",
  },
];

export const DEFAULT_WEBSITE_SETTINGS = {
  brand_name: "Hisbenew",
  tagline: "Handmade knives & wholesale blades",
  meta_title: "Hisbenew | Handmade Knives, Chef Blades & Wholesale Knife Sets",
  meta_description:
    "Shop handmade chef knives, hunting blades, collector pieces, and wholesale knife sets from Hisbenew Industries.",
  meta_keywords:
    "handmade knives, chef knives, hunting knives, wholesale knives, custom blades",
  canonical_url: "",
  announcement_text: "Wholesale and custom knife orders are open for this season.",
  theme_style: "atelier",
  hero_product_id: 0,
  hero_image_url: "",
  hero_badge: "Custom made",
  hero_title:
    "Premium custom knives designed for chefs, hunters, and wholesale buyers.",
  hero_subtitle:
    "Discover artisanal kitchen blades, rugged field knives, and bulk-ready sets with fast fulfillment and curated quality.",
  primary_cta_label: "Browse catalog",
  secondary_cta_label: "Request wholesale quote",
  contact_heading: "Ready to stock wholesale blades?",
  contact_text:
    "Connect with our team for custom orders, bulk pricing, and delivery support.",
  contact_button_label: "Contact sales",
  phone: "",
  email: "",
  whatsapp: "",
  collections_heading: "Shop by collection",
  collections_text:
    "Explore focused knife categories for kitchens, outdoors, gifting, and retail shelves.",
  featured_heading: "Featured blades",
  featured_text:
    "Best-fit products selected from live ERP inventory for buyers ready to compare.",
  about_heading: "Built for serious buyers and long-term partners.",
  about_text:
    "Hisbenew combines workshop finishing, practical materials, and export-ready fulfillment for retailers, chefs, collectors, and outdoor customers.",
  process_heading: "From inquiry to dispatch",
  process_text:
    "Clear product selection, confirmed availability, careful packing, and reliable handoff.",
  trust_metric_1_value: "25+",
  trust_metric_1_label: "blade designs",
  trust_metric_2_value: "100+",
  trust_metric_2_label: "buyer partners",
  trust_metric_3_value: "4.9/5",
  trust_metric_3_label: "average feedback",
  featured_limit: 8,
  show_prices: true,
  show_stock_badges: true,
  show_featured_products: true,
  section_order: WEBSITE_SECTIONS.map((section) => section.id),
  hidden_section_ids: [],
  featured_product_ids: [],
  hidden_product_ids: [],
  product_order_ids: [],
};

const uniquePositiveIds = (values = []) => {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)
    .filter((value) => {
      if (seen.has(value)) return false;
      seen.add(value);
      return true;
    });
};

export const normalizeWebsiteSettings = (settings = {}) => {
  const normalized = {
    ...DEFAULT_WEBSITE_SETTINGS,
    ...(settings || {}),
  };

  normalized.featured_limit = Math.max(
    1,
    Math.min(24, Number(normalized.featured_limit || DEFAULT_WEBSITE_SETTINGS.featured_limit))
  );
  normalized.show_prices = normalized.show_prices !== false;
  normalized.show_stock_badges = normalized.show_stock_badges !== false;
  normalized.show_featured_products = normalized.show_featured_products !== false;
  normalized.hero_product_id = Math.max(0, Number(normalized.hero_product_id || 0));

  const validSections = WEBSITE_SECTIONS.map((section) => section.id);
  const sectionOrder = Array.isArray(normalized.section_order)
    ? normalized.section_order.filter((section) => validSections.includes(section))
    : [];
  normalized.section_order = [
    ...sectionOrder,
    ...validSections.filter((section) => !sectionOrder.includes(section)),
  ];
  normalized.hidden_section_ids = Array.isArray(normalized.hidden_section_ids)
    ? normalized.hidden_section_ids.filter(
        (section) => validSections.includes(section) && section !== "hero"
      )
    : [];

  normalized.featured_product_ids = uniquePositiveIds(normalized.featured_product_ids);
  normalized.hidden_product_ids = uniquePositiveIds(normalized.hidden_product_ids);
  normalized.product_order_ids = uniquePositiveIds(normalized.product_order_ids);

  return normalized;
};

export const getVisibleSectionOrder = (settings = DEFAULT_WEBSITE_SETTINGS) => {
  const normalized = normalizeWebsiteSettings(settings);
  return normalized.section_order.filter(
    (section) => !normalized.hidden_section_ids.includes(section)
  );
};

export const websitePreviewUrl = () => {
  if (typeof window === "undefined") return "/";
  return window.location.origin;
};
