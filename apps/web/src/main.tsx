import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, ChartNoAxesColumn, ListPlus, MapPin, Plus, ReceiptText, Save, Search, Tags, Trash2, WalletCards, X } from "lucide-react";
import type { BillDraft, SavedBill, SpendingSummary } from "@finance/shared";
import { clearBills, deleteBill, getBills, getSummary, saveBill, scanBill } from "./api";
import "./styles.css";

const defaultCategories = ["Groceries", "Restaurants", "Household", "Healthcare", "Transport", "Shopping", "Other"];
const categoryStorageKey = "finance-tracker-categories";
type SideTab = "overview" | "categories";

function App() {
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<BillDraft | null>(null);
  const [bills, setBills] = useState<SavedBill[]>([]);
  const [summary, setSummary] = useState<SpendingSummary>({ lifetimeTotal: 0, currency: "USD", byCategory: [], byMonth: [] });
  const [status, setStatus] = useState("Paste a QR receipt URL to start.");
  const [busy, setBusy] = useState(false);
  const [selectedBillId, setSelectedBillId] = useState<number | null>(null);
  const [customCategories, setCustomCategories] = useState(() => loadCustomCategories());
  const [newCategory, setNewCategory] = useState("");
  const [sideTab, setSideTab] = useState<SideTab>("overview");
  const [itemCategoryInputs, setItemCategoryInputs] = useState<Record<number, string>>({});

  useEffect(() => {
    void refreshHistory();
  }, []);

  useEffect(() => {
    localStorage.setItem(categoryStorageKey, JSON.stringify(customCategories));
  }, [customCategories]);

  const draftTotal = useMemo(() => {
    return draft?.items.reduce((sum, item) => sum + Number(item.amount || 0), 0) ?? 0;
  }, [draft]);

  const selectedBill = bills.find((bill) => bill.id === selectedBillId) ?? null;
  const usedCategories = useMemo(() => {
    const fromSavedBills = bills.flatMap((bill) => bill.items.map((item) => item.category));
    const fromDraft = draft?.items.map((item) => item.category) ?? [];
    return uniqueCategories([...fromSavedBills, ...fromDraft]).filter((category) => category !== "Other");
  }, [bills, draft]);
  const categories = useMemo(() => {
    return uniqueCategories([...defaultCategories.filter((category) => category !== "Other"), ...usedCategories, ...customCategories, "Other"]);
  }, [customCategories, usedCategories]);

  async function refreshHistory() {
    const [nextBills, nextSummary] = await Promise.all([getBills(), getSummary()]);
    setBills(nextBills);
    setSummary(nextSummary);
    setSelectedBillId((currentId) => {
      if (currentId === null || nextBills.some((bill) => bill.id === currentId)) return currentId;
      return nextBills[0]?.id ?? null;
    });
  }

  async function handleScan(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("Reading receipt page...");
    try {
      const nextDraft = await scanBill(url);
      setDraft(nextDraft);
      setItemCategoryInputs({});
      setStatus(nextDraft.items.length ? `Found ${nextDraft.items.length} possible items.` : "No items found on that page.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not scan that receipt.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (!draft) return;
    setBusy(true);
    setStatus("Saving bill...");
    try {
      await saveBill({ ...draft, total: draftTotal });
      setDraft(null);
      setUrl("");
      await refreshHistory();
      setStatus("Saved. Historical totals are updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save this bill.");
    } finally {
      setBusy(false);
    }
  }

  function updateDraft<K extends keyof BillDraft>(field: K, value: BillDraft[K]) {
    if (!draft) return;
    setDraft({ ...draft, [field]: value });
  }

  function updateItem(index: number, field: "description" | "quantity" | "amount" | "category", value: string) {
    if (!draft) return;
    const items = draft.items.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      return { ...item, [field]: field === "amount" || field === "quantity" ? Number(value) : value };
    });
    setDraft({ ...draft, items, total: items.reduce((sum, item) => sum + Number(item.amount || 0), 0) });
  }

  function addCategoryForItem(index: number) {
    if (!draft) return;
    const category = itemCategoryInputs[index]?.trim();
    if (!category) return;
    const nextCustomCategories = categories.some((existing) => existing.toLowerCase() === category.toLowerCase())
      ? customCategories
      : [...customCategories, category];
    const items = draft.items.map((item, itemIndex) => (itemIndex === index ? { ...item, category } : item));
    setCustomCategories(nextCustomCategories);
    setDraft({ ...draft, items });
    setItemCategoryInputs(({ [index]: _removed, ...rest }) => rest);
  }

  function cancelDraft() {
    setDraft(null);
    setItemCategoryInputs({});
    setStatus("Scanned bill discarded.");
  }

  function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const category = newCategory.trim();
    if (!category || categories.some((existing) => existing.toLowerCase() === category.toLowerCase())) {
      setNewCategory("");
      return;
    }
    setCustomCategories([...customCategories, category]);
    setNewCategory("");
  }

  function removeCategory(category: string) {
    if (!customCategories.includes(category)) return;
    setCustomCategories(customCategories.filter((item) => item !== category));
    if (draft) {
      setDraft({
        ...draft,
        items: draft.items.map((item) => (item.category === category ? { ...item, category: "Other" } : item)),
      });
    }
  }

  async function handleDeleteBill(bill: SavedBill) {
    if (!window.confirm(`Delete ${bill.vendor} for ${formatMoney(bill.total, bill.currency)}?`)) return;
    setBusy(true);
    setStatus("Deleting bill...");
    try {
      await deleteBill(bill.id);
      setSelectedBillId(null);
      await refreshHistory();
      setStatus("Bill deleted. Historical totals are updated.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not delete this bill.");
    } finally {
      setBusy(false);
    }
  }

  async function handleClearBills() {
    if (!window.confirm("Delete all saved bills and item history?")) return;
    setBusy(true);
    setStatus("Clearing saved bills...");
    try {
      const result = await clearBills();
      setSelectedBillId(null);
      await refreshHistory();
      setStatus(result.deleted ? `Deleted ${result.deleted} saved bills.` : "No saved bills to delete.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not clear saved bills.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-band">
        <div>
          <p className="eyebrow">QR receipt finance tracker</p>
          <h1>Track what you actually bought.</h1>
        </div>
        <div className="total-tile">
          <WalletCards size={22} aria-hidden="true" />
          <span>Historical spend</span>
          <strong>{formatMoney(summary.lifetimeTotal, summary.currency)}</strong>
        </div>
      </section>

      <section className="scan-band">
        <form onSubmit={handleScan} className="scan-form">
          <label htmlFor="receipt-url">Receipt URL</label>
          <div className="url-row">
            <input
              id="receipt-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://receipt.example.com/..."
              required
            />
            <button type="submit" disabled={busy}>
              <Search size={18} aria-hidden="true" />
              <span>Scan</span>
            </button>
          </div>
          <p className="status">{status}</p>
        </form>
      </section>

      <section className="content-grid">
        <div className="panel">
          <div className="panel-heading">
            <div>
              <h2>Scanned Bill</h2>
              <p>Review the extracted data before saving.</p>
            </div>
            <div className="header-actions">
              <button className="secondary-button" onClick={cancelDraft} disabled={!draft || busy}>
                <X size={18} aria-hidden="true" />
                <span>Cancel</span>
              </button>
              <button onClick={handleSave} disabled={!draft || busy || draft.items.length === 0}>
                <Save size={18} aria-hidden="true" />
                <span>Save</span>
              </button>
            </div>
          </div>

          {draft ? (
            <>
              <div className="bill-fields">
                <label>
                  Store
                  <input value={draft.vendor} onChange={(event) => updateDraft("vendor", event.target.value)} />
                </label>
                <label>
                  Date bought
                  <input
                    type="date"
                    value={draft.purchasedAt ?? ""}
                    onChange={(event) => updateDraft("purchasedAt", event.target.value || null)}
                  />
                </label>
                <label>
                  Location
                  <input value={draft.location ?? ""} onChange={(event) => updateDraft("location", event.target.value || null)} />
                </label>
                <div className="sum-box">
                  <span>Bill sum</span>
                  <strong>{formatMoney(draftTotal, draft.currency)}</strong>
                </div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Qty</th>
                      <th>Category</th>
                      <th>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.items.map((item, index) => (
                      <tr key={`${item.description}-${index}`}>
                        <td>
                          <input value={item.description} onChange={(event) => updateItem(index, "description", event.target.value)} />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.001"
                            min="0"
                            value={item.quantity}
                            onChange={(event) => updateItem(index, "quantity", event.target.value)}
                          />
                        </td>
                        <td>
                          <div className="category-cell">
                            <span className="suggestion-label">Suggested: {item.suggestedCategory || item.category || "Other"}</span>
                            <select value={item.category} onChange={(event) => updateItem(index, "category", event.target.value)}>
                              {categories.map((category) => (
                                <option key={category} value={category}>
                                  {category}
                                </option>
                              ))}
                            </select>
                            <div className="inline-category-form">
                              <input
                                value={itemCategoryInputs[index] ?? ""}
                                onChange={(event) => setItemCategoryInputs({ ...itemCategoryInputs, [index]: event.target.value })}
                                placeholder="New category"
                              />
                              <button type="button" onClick={() => addCategoryForItem(index)} aria-label={`Add category for ${item.description}`}>
                                <Plus size={16} aria-hidden="true" />
                              </button>
                            </div>
                          </div>
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            value={item.amount}
                            onChange={(event) => updateItem(index, "amount", event.target.value)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="empty-state">
              <ReceiptText size={34} aria-hidden="true" />
              <p>No bill scanned yet.</p>
            </div>
          )}
        </div>

        <aside className="side-stack">
          <section className="panel side-tabs-panel">
            <div className="tabs" role="tablist" aria-label="Spending tools">
              <button
                className={sideTab === "overview" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={sideTab === "overview"}
                onClick={() => setSideTab("overview")}
              >
                <ChartNoAxesColumn size={17} aria-hidden="true" />
                <span>Overview</span>
              </button>
              <button
                className={sideTab === "categories" ? "is-active" : ""}
                type="button"
                role="tab"
                aria-selected={sideTab === "categories"}
                onClick={() => setSideTab("categories")}
              >
                <Tags size={17} aria-hidden="true" />
                <span>Categories</span>
              </button>
            </div>
            {sideTab === "overview" ? (
              <div className="tab-panel" role="tabpanel">
                <section className="side-panel nested-panel">
                  <h2>By Category</h2>
                  <CategoryBars rows={summary.byCategory} currency={summary.currency} />
                  <SummaryRows currency={summary.currency} rows={summary.byCategory.map((row) => [row.category, row.total])} />
                </section>
                <section className="side-panel nested-panel">
                  <h2>By Month</h2>
                  <SummaryRows currency={summary.currency} rows={summary.byMonth.map((row) => [row.month, row.total])} />
                </section>
              </div>
            ) : (
              <div className="tab-panel" role="tabpanel">
                <CategoryManager
                  categories={categories}
                  customCategories={customCategories}
                  usedCategories={usedCategories}
                  newCategory={newCategory}
                  onNewCategoryChange={setNewCategory}
                  onAddCategory={addCategory}
                  onRemoveCategory={removeCategory}
                />
              </div>
            )}
          </section>
        </aside>
      </section>

      <section className="history-band panel">
        <div className="section-heading">
          <h2>Saved Bills</h2>
          <button className="secondary-button danger-text-button" type="button" disabled={busy || bills.length === 0} onClick={handleClearBills}>
            <Trash2 size={16} aria-hidden="true" />
            <span>Clear all</span>
          </button>
        </div>
        <div className="history-layout">
          <div className="bill-list">
          {bills.length === 0 ? (
            <p className="muted">Saved bills will appear here.</p>
          ) : (
            bills.map((bill) => (
              <button
                key={bill.id}
                className={`bill-row ${selectedBillId === bill.id ? "is-selected" : ""}`}
                type="button"
                onClick={() => setSelectedBillId(bill.id)}
              >
                <div>
                  <strong>{bill.vendor}</strong>
                  <span>
                    <CalendarDays size={14} aria-hidden="true" />
                    {bill.purchasedAt ?? bill.createdAt.slice(0, 10)}
                  </span>
                  {bill.location ? (
                    <span>
                      <MapPin size={14} aria-hidden="true" />
                      {bill.location}
                    </span>
                  ) : null}
                </div>
                <strong>{formatMoney(bill.total, bill.currency)}</strong>
              </button>
            ))
          )}
          </div>
          <BillDetail bill={selectedBill} busy={busy} onClose={() => setSelectedBillId(null)} onDelete={handleDeleteBill} />
        </div>
      </section>
    </main>
  );
}

function BillDetail({
  bill,
  busy,
  onClose,
  onDelete,
}: {
  bill: SavedBill | null;
  busy: boolean;
  onClose: () => void;
  onDelete: (bill: SavedBill) => void;
}) {
  if (!bill) {
    return (
      <aside className="bill-detail empty-detail">
        <ReceiptText size={30} aria-hidden="true" />
        <p>Select a saved bill to inspect its items.</p>
      </aside>
    );
  }

  return (
    <aside className="bill-detail">
      <div className="detail-heading">
        <div>
          <p className="eyebrow">Bill detail</p>
          <h3>{bill.vendor}</h3>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Close bill detail">
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <dl className="detail-meta">
        <div>
          <dt>Date</dt>
          <dd>{bill.purchasedAt ?? bill.createdAt.slice(0, 10)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{formatMoney(bill.total, bill.currency)}</dd>
        </div>
        {bill.location ? (
          <div className="wide">
            <dt>Location</dt>
            <dd>{bill.location}</dd>
          </div>
        ) : null}
      </dl>

      <div className="detail-items">
        {bill.items.map((item, index) => (
          <article className="detail-item" key={`${item.description}-${index}`}>
            <div>
              <strong>{item.description}</strong>
              <span>
                Qty {formatQuantity(item.quantity)} · {item.category}
              </span>
            </div>
            <strong>{formatMoney(item.amount, bill.currency)}</strong>
          </article>
        ))}
      </div>

      <button className="danger-button" type="button" disabled={busy} onClick={() => onDelete(bill)}>
        <Trash2 size={17} aria-hidden="true" />
        <span>Delete bill</span>
      </button>
    </aside>
  );
}

function CategoryManager({
  categories,
  customCategories,
  usedCategories,
  newCategory,
  onNewCategoryChange,
  onAddCategory,
  onRemoveCategory,
}: {
  categories: string[];
  customCategories: string[];
  usedCategories: string[];
  newCategory: string;
  onNewCategoryChange: (value: string) => void;
  onAddCategory: (event: React.FormEvent) => void;
  onRemoveCategory: (category: string) => void;
}) {
  return (
    <section className="category-manager">
      <div className="category-header">
        <div>
          <h2>Categories</h2>
          <p>Defaults, receipt categories, and your custom labels.</p>
        </div>
        <strong>{categories.length}</strong>
      </div>
      <form className="category-form" onSubmit={onAddCategory}>
        <input value={newCategory} onChange={(event) => onNewCategoryChange(event.target.value)} placeholder="Add category" />
        <button type="submit" aria-label="Add category">
          <Plus size={17} aria-hidden="true" />
        </button>
      </form>
      <CategoryGroup title="Default" categories={defaultCategories} customCategories={customCategories} onRemoveCategory={onRemoveCategory} />
      <CategoryGroup title="From Bills" categories={usedCategories} customCategories={customCategories} onRemoveCategory={onRemoveCategory} />
      <CategoryGroup
        title="Custom"
        categories={customCategories}
        customCategories={customCategories}
        emptyText="Custom categories you add will appear here."
        onRemoveCategory={onRemoveCategory}
      />
    </section>
  );
}

function CategoryBars({ rows, currency }: { rows: Array<{ category: string; total: number }>; currency: string }) {
  if (rows.length === 0) {
    return (
      <div className="category-bars empty-bars">
        <p className="muted">Save bills to see category spending here.</p>
      </div>
    );
  }

  const max = Math.max(...rows.map((row) => row.total), 1);
  return (
    <div className="category-bars" aria-label="Expenses by category">
      {rows.map((row) => (
        <div className="bar-row" key={row.category}>
          <div className="bar-row-meta">
            <span>{row.category}</span>
            <strong>{formatMoney(row.total, currency)}</strong>
          </div>
          <div className="bar-track">
            <span style={{ width: `${Math.max((row.total / max) * 100, 4)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function CategoryGroup({
  title,
  categories,
  customCategories,
  emptyText = "No categories found yet.",
  onRemoveCategory,
}: {
  title: string;
  categories: string[];
  customCategories: string[];
  emptyText?: string;
  onRemoveCategory: (category: string) => void;
}) {
  const unique = uniqueCategories(categories);
  return (
    <div className="category-group">
      <div className="category-group-title">
        <ListPlus size={15} aria-hidden="true" />
        <h3>{title}</h3>
      </div>
      {unique.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="category-list">
          {unique.map((category) => (
            <span className="category-chip" key={`${title}-${category}`}>
              {category}
              {customCategories.includes(category) ? (
                <button type="button" onClick={() => onRemoveCategory(category)} aria-label={`Remove ${category}`}>
                  <X size={13} aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryRows({ rows, currency }: { rows: Array<[string, number]>; currency: string }) {
  if (rows.length === 0) return <p className="muted">No saved data yet.</p>;
  return (
    <div className="summary-list">
      {rows.map(([label, total]) => (
        <div className="summary-row" key={label}>
          <span>{label}</span>
          <strong>{formatMoney(total, currency)}</strong>
        </div>
      ))}
    </div>
  );
}

function formatMoney(value: number, currency = "USD") {
  if (currency === "MIXED") {
    return `${new Intl.NumberFormat().format(value || 0)} mixed`;
  }
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value || 0);
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(value || 0);
}

function loadCustomCategories() {
  try {
    const parsed = JSON.parse(localStorage.getItem(categoryStorageKey) ?? "[]");
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return uniqueCategories(parsed).filter((category) => !defaultCategories.includes(category));
    }
  } catch {
    return [];
  }
  return [];
}

function uniqueCategories(values: string[]) {
  const seen = new Set<string>();
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
