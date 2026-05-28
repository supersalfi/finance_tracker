export type BillItem = {
  description: string;
  quantity: number;
  amount: number;
  category: string;
  suggestedCategory?: string | null;
  rawText?: string;
};

export type BillDraft = {
  sourceUrl: string;
  vendor: string;
  purchasedAt: string | null;
  location: string | null;
  currency: string;
  total: number;
  items: BillItem[];
};

export type SavedBill = BillDraft & {
  id: number;
  createdAt: string;
};

export type SpendingSummary = {
  lifetimeTotal: number;
  currency: string;
  byCategory: Array<{ category: string; total: number }>;
  byMonth: Array<{ month: string; total: number }>;
};
