export type Role = 'ADMIN' | 'CUSTOMER';

export type FieldError = {
  field: string;
  message: string;
};

export type ProductRecord = {
  id: string;
  name: string;
  price_yen: string;
  stock: number;
  weight_kg: number;
};

export type RequestedItem = {
  productId: string;
  quantity: number;
};

export type CalculatedItem = {
  productId: string;
  productName: string;
  unitPriceYen: string;
  unitWeightKg: number;
  quantity: number;
  subtotalYen: string;
  totalWeightKg: number;
};

export type CalculatedOrder = {
  items: CalculatedItem[];
  totalPriceYen: string;
  totalWeightKg: number;
  estimatedBoxes: number;
};

export const MAX_LONG = 9_223_372_036_854_775_807n;
export const MAX_STOCK = 2_147_483_647;
export const LOW_STOCK_THRESHOLD = 5;

const reservedCharacter = /[,|:\r\n]/;

export function registrationErrors(value: unknown): FieldError[] {
  if (typeof value !== 'object' || value === null) {
    return [{ field: 'request', message: 'A JSON request body is required.' }];
  }
  const input = value as Record<string, unknown>;
  const errors: FieldError[] = [];
  if (typeof input.username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(input.username)) {
    errors.push({ field: 'username', message: 'Use 3-20 letters, numbers, or underscores.' });
  }
  if (typeof input.password !== 'string' || input.password.length < 4 || input.password.length > 100) {
    errors.push({ field: 'password', message: 'Password must contain 4-100 characters.' });
  } else if (new TextEncoder().encode(input.password).length > 72) {
    errors.push({ field: 'password', message: 'Password must not exceed 72 UTF-8 bytes.' });
  } else if (reservedCharacter.test(input.password)) {
    errors.push({ field: 'password', message: 'Password contains a reserved character.' });
  }
  return errors;
}

export function productErrors(value: unknown): FieldError[] {
  if (typeof value !== 'object' || value === null) {
    return [{ field: 'request', message: 'A JSON request body is required.' }];
  }
  const input = value as Record<string, unknown>;
  const errors: FieldError[] = [];
  if (typeof input.id !== 'string' || !/^P\d{3}$/.test(input.id)) {
    errors.push({ field: 'id', message: 'Product ID must use P followed by three digits.' });
  }
  if (typeof input.name !== 'string' || input.name.trim() === '' || input.name.length > 100 || reservedCharacter.test(input.name)) {
    errors.push({ field: 'name', message: 'Name is required, must be at most 100 characters, and cannot contain CSV delimiters.' });
  }
  if (typeof input.priceYen !== 'string' || !/^[1-9]\d*$/.test(input.priceYen)) {
    errors.push({ field: 'priceYen', message: 'Price must be a positive whole-yen amount.' });
  } else {
    try {
      if (BigInt(input.priceYen) > MAX_LONG) errors.push({ field: 'priceYen', message: 'Price exceeds the supported range.' });
    } catch {
      errors.push({ field: 'priceYen', message: 'Price must be a positive whole-yen amount.' });
    }
  }
  if (typeof input.stock !== 'number' || !Number.isInteger(input.stock) || input.stock < 0 || input.stock > MAX_STOCK) {
    errors.push({ field: 'stock', message: 'Stock must be a non-negative whole number.' });
  }
  if (typeof input.weightKg !== 'number' || !Number.isFinite(input.weightKg) || input.weightKg <= 0) {
    errors.push({ field: 'weightKg', message: 'Weight must be positive and finite.' });
  }
  return errors;
}

export function stockErrors(value: unknown): FieldError[] {
  if (typeof value !== 'object' || value === null) {
    return [{ field: 'request', message: 'A JSON request body is required.' }];
  }
  const stock = (value as Record<string, unknown>).stock;
  return typeof stock === 'number' && Number.isInteger(stock) && stock >= 0 && stock <= MAX_STOCK
    ? []
    : [{ field: 'stock', message: 'Stock must be a non-negative whole number.' }];
}

export function normalizeRequestedItems(value: unknown): { items: RequestedItem[]; errors: FieldError[] } {
  if (typeof value !== 'object' || value === null || !Array.isArray((value as Record<string, unknown>).items)) {
    return { items: [], errors: [{ field: 'items', message: 'At least one order item is required.' }] };
  }
  const rawItems = (value as { items: unknown[] }).items;
  if (rawItems.length === 0) {
    return { items: [], errors: [{ field: 'items', message: 'At least one order item is required.' }] };
  }
  const merged = new Map<string, number>();
  const errors: FieldError[] = [];
  rawItems.forEach((raw, index) => {
    if (typeof raw !== 'object' || raw === null) {
      errors.push({ field: `items[${index}]`, message: 'An order item must be an object.' });
      return;
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.productId !== 'string' || !/^P\d{3}$/.test(item.productId)) {
      errors.push({ field: `items[${index}].productId`, message: 'Product ID must use P followed by three digits.' });
    }
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > MAX_STOCK) {
      errors.push({ field: `items[${index}].quantity`, message: 'Quantity must be a positive whole number.' });
    }
    if (typeof item.productId === 'string' && /^P\d{3}$/.test(item.productId)
      && typeof item.quantity === 'number' && Number.isInteger(item.quantity) && item.quantity >= 1 && item.quantity <= MAX_STOCK) {
      const next = (merged.get(item.productId) ?? 0) + item.quantity;
      if (next > MAX_STOCK) {
        errors.push({ field: `items[${index}].quantity`, message: 'Combined quantity exceeds the supported range.' });
      } else {
        merged.set(item.productId, next);
      }
    }
  });
  return { items: [...merged].map(([productId, quantity]) => ({ productId, quantity })), errors };
}

function roundedWeight(value: number): number {
  return Number(value.toFixed(6));
}

export function calculateOrder(products: ProductRecord[], requestedItems: RequestedItem[]): CalculatedOrder {
  const productsById = new Map(products.map((product) => [product.id, product]));
  let totalPrice = 0n;
  let totalWeight = 0;
  const items = requestedItems.map((requested) => {
    const product = productsById.get(requested.productId);
    if (!product) throw new Error(`PRODUCT_NOT_FOUND:${requested.productId}`);
    if (product.stock < requested.quantity) throw new Error(`INSUFFICIENT_STOCK:${requested.productId}`);
    const subtotal = BigInt(product.price_yen) * BigInt(requested.quantity);
    const itemWeight = roundedWeight(product.weight_kg * requested.quantity);
    totalPrice += subtotal;
    totalWeight = roundedWeight(totalWeight + itemWeight);
    return {
      productId: product.id,
      productName: product.name,
      unitPriceYen: product.price_yen,
      unitWeightKg: product.weight_kg,
      quantity: requested.quantity,
      subtotalYen: subtotal.toString(),
      totalWeightKg: itemWeight,
    };
  });
  return {
    items,
    totalPriceYen: totalPrice.toString(),
    totalWeightKg: totalWeight,
    estimatedBoxes: Math.max(1, Math.ceil(totalWeight / 10)),
  };
}
