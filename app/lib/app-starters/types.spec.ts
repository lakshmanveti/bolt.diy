import { describe, expect, it } from 'vitest';
import { isValidCategorySlug, slugifyCategory } from './types';

describe('slugifyCategory', () => {
  it('turns product names into slugs', () => {
    expect(slugifyCategory('PO manager')).toBe('po_manager');
    expect(slugifyCategory('Purchase Order Management')).toBe('purchase_order_management');
  });

  it('rejects unknown', () => {
    expect(isValidCategorySlug('unknown')).toBe(false);
    expect(isValidCategorySlug('purchase_order')).toBe(true);
  });
});
