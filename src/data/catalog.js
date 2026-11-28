import { withBase } from '../lib/basePath.js';
import { formatInr } from '../lib/currency.js';

export const PRODUCTS = [
  {
    id: 'chronograph-silver-skeleton',
    slug: 'sovereign-silver-skeleton-chronograph',
    title: 'Sovereign Silver Skeleton',
    subtitle: '41mm Stainless Steel Mechanical Chronograph',
    category: 'Mechanical Skeleton',
    price: 14800,
    formattedPrice: formatInr(14800),
    image: withBase('/products/watch-silver-skeleton.png'),
    description:
      'Hand-finished 316L brushed stainless-steel case framing an open-worked calibre with column-wheel chronograph architecture, luminous indices, and integrated link bracelet.',
    specs: ['Calibre LS-901 Automatic', '72-Hour Power Reserve', 'Sapphire Crystal Caseback', '100m Water Resistance'],
    variants: [
      { id: 'silver-41', label: '41mm Brushed Steel', available: true },
      { id: 'silver-39', label: '39mm Brushed Steel', available: true },
    ],
  },
  {
    id: 'chronograph-tachymeter-macro',
    slug: 'monarch-tachymeter-chronograph',
    title: 'Monarch Tachymeter Steel',
    subtitle: '42mm Fluted Bezel Mechanical Chronograph',
    category: 'Chronographs',
    price: 16200,
    formattedPrice: formatInr(16200),
    image: withBase('/products/watch-chronograph-macro.png'),
    description:
      'Precision-milled notched tachymeter bezel paired with a multi-layered matte obsidian dial, gunmetal guilloche subdials, and solid H-link steel bracelet.',
    specs: ['Calibre LS-940 Chrono', 'Notched Steel Bezel', 'Triple Subdial Layout', '100m Water Resistance'],
    variants: [
      { id: 'monarch-42', label: '42mm Obsidian Dial', available: true },
      { id: 'monarch-40', label: '40mm Obsidian Dial', available: true },
    ],
  },
  {
    id: 'chronograph-gold-skeleton',
    slug: 'aurelia-18k-gold-skeleton',
    title: 'Aurelia 18K Gold Skeleton',
    subtitle: '41mm 18K Yellow Gold Mechanical Chronograph',
    category: 'Precious Metals',
    price: 32500,
    formattedPrice: formatInr(32500),
    image: withBase('/products/watch-gold-skeleton.png'),
    description:
      'Sculpted in solid 18K yellow gold with satin-brushed bracelet links and hand-bevelled skeletonized bridges revealing the twin-barrel escapement.',
    specs: ['18K Solid Yellow Gold', 'Calibre LS-980 Skeleton', '68-Hour Power Reserve', 'Exhibition Caseback'],
    variants: [
      { id: 'gold-41', label: '41mm 18K Yellow Gold', available: true },
    ],
  },
  {
    id: 'chronograph-rosegold-skeleton',
    slug: 'rose-atelier-chronograph',
    title: 'Rose Atelier Chronograph',
    subtitle: '40mm 18K Rose Gold Openworked Edition',
    category: 'Precious Metals',
    price: 29900,
    formattedPrice: formatInr(29900),
    image: withBase('/products/watch-rosegold-skeleton.png'),
    description:
      'Warm 18K rose gold alloy housing an architectural skeleton movement with anthracite chronograph counters and articulated fold-over deployment clasp.',
    specs: ['18K Rose Gold Case', 'Column-Wheel Chrono', 'Anti-Reflective Sapphire', '50m Water Resistance'],
    variants: [
      { id: 'rose-40', label: '40mm 18K Rose Gold', available: true },
    ],
  },
  {
    id: 'chronograph-obsidian-skeleton',
    slug: 'nocturne-obsidian-pvd',
    title: 'Nocturne Obsidian PVD',
    subtitle: '41mm Titanium & Obsidian PVD Skeleton',
    category: 'Limited Editions',
    price: 18400,
    formattedPrice: formatInr(18400),
    image: withBase('/products/watch-obsidian-skeleton.png'),
    description:
      'Micro-blasted grade-5 titanium finished in deep obsidian PVD, contrasted by exposed rhodium-plated gear trains and Super-LumiNova baton hands.',
    specs: ['Grade-5 Titanium PVD', 'Openworked Calibre', '70-Hour Reserve', '100m Water Resistance'],
    variants: [
      { id: 'obsidian-41', label: '41mm Obsidian PVD', available: true },
    ],
  },
  {
    id: 'chronograph-burgundy-edition',
    slug: 'maison-burgundy-bezel-edition',
    title: 'Maison Burgundy Edition',
    subtitle: '41mm Crimson Ceramic Bezel Chronograph',
    category: 'Runway Exclusives',
    price: 21600,
    formattedPrice: formatInr(21600),
    image: withBase('/products/watch-burgundy-skeleton.png'),
    description:
      'Signature Luxe Store runway exclusive pairing a deep crimson-burgundy ceramic tachymeter bezel with brushed stainless steel and an open-heart skeleton dial.',
    specs: ['Crimson Ceramic Bezel', 'Calibre LS-915 Skeleton', 'Numbered Runway Piece', '100m Water Resistance'],
    variants: [
      { id: 'burgundy-41', label: '41mm Crimson / Steel', available: true },
    ],
  },
  {
    id: 'chronograph-twotone-skeleton',
    slug: 'imperial-two-tone-skeleton',
    title: 'Imperial Two-Tone Gold',
    subtitle: '41mm Steel & 18K Gold Center-Link Chronograph',
    category: 'Precious Metals',
    price: 24900,
    formattedPrice: formatInr(24900),
    image: withBase('/products/watch-twotone-skeleton.png'),
    description:
      'Brushed stainless steel paired with solid 18K gold center links, fluted pushers, and tachymeter bezel framing an open-worked skeleton movement.',
    specs: ['Steel & 18K Gold Bracelet', 'Calibre LS-930 Chrono', '72-Hour Reserve', '100m Water Resistance'],
    variants: [
      { id: 'twotone-41', label: '41mm Two-Tone Steel/Gold', available: true },
    ],
  },
  {
    id: 'movement-heritage-calibre',
    slug: 'heritage-calibre-pocket-desk-piece',
    title: 'Heritage Openworked Calibre',
    subtitle: '39mm Exposed Movement Collector Edition',
    category: 'Haute Horlogerie',
    price: 24200,
    formattedPrice: formatInr(24200),
    image: withBase('/products/watch-movement-dial.png'),
    description:
      'Focused horological showcase highlighting hand-engraved skeletonized bridges, ruby jewel bearings, and exposed mainspring barrel architecture.',
    specs: ['Hand-Finished Bridges', '28,800 vph Frequency', 'Ruby Jewel Bearings', 'Swiss Certified'],
    variants: [
      { id: 'heritage-39', label: '39mm Collector Case', available: true },
    ],
  },
];

export function getProductById(productId) {
  return PRODUCTS.find((p) => p.id === productId || p.slug === productId) || null;
}

export function getDefaultVariant(product) {
  if (!product || !Array.isArray(product.variants)) return null;
  return product.variants.find((v) => v.available !== false) || product.variants[0] || null;
}
