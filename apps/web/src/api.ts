import type { BillDraft, SavedBill, SpendingSummary } from "@finance/shared";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (response.status === 204) {
    return undefined as T;
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.detail ?? "Request failed");
  }
  return payload as T;
}

export function scanBill(url: string): Promise<BillDraft> {
  return request<BillDraft>("/api/scan", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
}

export function saveBill(bill: BillDraft): Promise<SavedBill> {
  return request<SavedBill>("/api/bills", {
    method: "POST",
    body: JSON.stringify(bill),
  });
}

export function getBills(): Promise<SavedBill[]> {
  return request<SavedBill[]>("/api/bills");
}

export function getSummary(): Promise<SpendingSummary> {
  return request<SpendingSummary>("/api/summary");
}

export function deleteBill(id: number): Promise<void> {
  return request<void>(`/api/bills/${id}`, { method: "DELETE" });
}

export function clearBills(): Promise<{ deleted: number }> {
  return request<{ deleted: number }>("/api/bills", { method: "DELETE" });
}
