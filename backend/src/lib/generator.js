// Shared mock-data generation, used by both the seeder and the simulate route.

export const CATEGORIES = [
  'Electronics',
  'Books',
  'Home & Kitchen',
  'Clothing',
  'Sports',
  'Toys',
  'Beauty',
  'Automotive',
  'Garden',
  'Office',
  'Grocery',
  'Pet Supplies',
];

const ADJECTIVES = [
  'Premium', 'Compact', 'Wireless', 'Eco', 'Smart', 'Classic', 'Deluxe',
  'Portable', 'Ultra', 'Pro', 'Essential', 'Vintage', 'Modern', 'Heavy-Duty',
  'Lightweight', 'Ergonomic', 'Rechargeable', 'Stainless', 'Organic', 'Foldable',
];

const NOUNS = [
  'Headphones', 'Notebook', 'Blender', 'Jacket', 'Yoga Mat', 'Action Figure',
  'Moisturizer', 'Tire', 'Hose', 'Stapler', 'Coffee Beans', 'Dog Bed',
  'Speaker', 'Backpack', 'Lamp', 'Mug', 'Keyboard', 'Water Bottle',
  'Sneakers', 'Charger', 'Knife Set', 'Pillow', 'Drone', 'Sunglasses',
];

export function randomProductName() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const model = Math.floor(Math.random() * 9000) + 1000;
  return `${a} ${n} ${model}`;
}

export function randomPrice() {
  // 1.00 .. 999.99
  return (Math.random() * 998 + 1).toFixed(2);
}
