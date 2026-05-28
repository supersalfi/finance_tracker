import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CalendarDays, MapPin, ReceiptText, Save, Search, WalletCards } from "lucide-react";
import type { BillDraft, SavedBill, SpendingSummary } from "@finance/shared";
import { getBills, getSummary, saveBill, scanBill } from "./api";
import "./styles.css";

const categories = ["Groceries", "Restaurants", "Household", "Healthcare", "Transport", "Shopping", "Other"];

function App() {
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState<BillDraft | null>(null);
  const [bills, setBills] = useState<SavedBill[]>([]);
  const [summary, setSummary] = useState<SpendingSummary>({ lifetimeTotal: 0, currency: "USD", byCategory: [], byMonth: [] });
  const [status, setStatus] = useState("Paste a QR receipt URL to start.");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshHistory();
  }, []);

  const draftTotal = useMemo(() => {
    return draft?.items.reduce((sum, item) => sum + Number(item.amount || 0), 0) ?? 0;
  }, [draft]);

  async function refreshHistory() {
    const [nextBills, nextSummary] = await Promise.all([getBills(), getSummary()]);
    setBills(nextBills);
    setSummary(nextSummary);
  }

  async function handleScan(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("Reading receipt page...");
    try {
      const nextDraft = await scanBill(url);
      setDraft(nextDraft);
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
            <button onClick={handleSave} disabled={!draft || busy || draft.items.length === 0}>
              <Save size={18} aria-hidden="true" />
              <span>Save</span>
            </button>
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
                          <select value={item.category} onChange={(event) => updateItem(index, "category", event.target.value)}>
                            {categories.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
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
          <section className="panel side-panel">
            <h2>By Category</h2>
            <SummaryRows currency={summary.currency} rows={summary.byCategory.map((row) => [row.category, row.total])} />
          </section>
          <section className="panel side-panel">
            <h2>By Month</h2>
            <SummaryRows currency={summary.currency} rows={summary.byMonth.map((row) => [row.month, row.total])} />
          </section>
        </aside>
      </section>

      <section className="history-band panel">
        <h2>Saved Bills</h2>
        <div className="bill-list">
          {bills.length === 0 ? (
            <p className="muted">Saved bills will appear here.</p>
          ) : (
            bills.map((bill) => (
              <article key={bill.id} className="bill-row">
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
              </article>
            ))
          )}
        </div>
      </section>
    </main>
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

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
