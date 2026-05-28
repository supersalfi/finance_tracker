from __future__ import annotations

import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .models import BillDraft, ScanRequest, SavedBill, SpendingSummary
from .parser import parse_bill_html
from .providers import parse_serbian_taxcore_receipt
from .storage import clear_bills, delete_bill, get_summary, init_db, list_bills, save_bill


app = FastAPI(title="Finance Tracker API")

origins = [origin.strip() for origin in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/scan", response_model=BillDraft, response_model_by_alias=True)
async def scan_bill(request: ScanRequest) -> BillDraft:
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            response = await client.get(
                str(request.url),
                headers={"User-Agent": "FinanceTrackerBot/0.1 personal finance receipt parser"},
            )
            response.raise_for_status()
            if request.url.host == "suf.purs.gov.rs":
                provider_bill = await parse_serbian_taxcore_receipt(client, str(request.url), response.text)
                if provider_bill is not None:
                    return provider_bill
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"Could not read that URL: {exc}") from exc

    content_type = response.headers.get("content-type", "")
    if "pdf" in content_type.lower():
        raise HTTPException(status_code=400, detail="PDF receipt parsing is planned, but the MVP expects an HTML page.")

    return parse_bill_html(str(request.url), response.text)


@app.post("/api/bills", response_model=SavedBill, response_model_by_alias=True)
def create_bill(draft: BillDraft) -> SavedBill:
    return save_bill(draft)


@app.get("/api/bills", response_model=list[SavedBill], response_model_by_alias=True)
def get_bills() -> list[SavedBill]:
    return list_bills()


@app.delete("/api/bills")
def remove_all_bills() -> dict[str, int]:
    return {"deleted": clear_bills()}


@app.delete("/api/bills/{bill_id}")
def remove_bill(bill_id: int) -> dict[str, bool]:
    if not delete_bill(bill_id):
        raise HTTPException(status_code=404, detail="Bill not found")
    return {"deleted": True}


@app.get("/api/summary", response_model=SpendingSummary, response_model_by_alias=True)
def summary() -> SpendingSummary:
    return get_summary()
