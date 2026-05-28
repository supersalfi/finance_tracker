from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, HttpUrl


class ApiModel(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class ScanRequest(ApiModel):
    url: HttpUrl


class BillItem(ApiModel):
    description: str
    quantity: float = 1
    amount: float
    category: str = "Other"
    suggested_category: str | None = Field(default=None, alias="suggestedCategory")
    raw_text: str | None = Field(default=None, alias="rawText")


class BillDraft(ApiModel):
    source_url: str = Field(alias="sourceUrl")
    vendor: str
    purchased_at: str | None = Field(default=None, alias="purchasedAt")
    location: str | None = None
    currency: str = "USD"
    total: float
    items: list[BillItem]


class SavedBill(BillDraft):
    id: int
    created_at: str = Field(alias="createdAt")


class SpendingSummary(ApiModel):
    lifetime_total: float = Field(alias="lifetimeTotal")
    currency: str = "USD"
    by_category: list[dict[str, float | str]] = Field(alias="byCategory")
    by_month: list[dict[str, float | str]] = Field(alias="byMonth")
