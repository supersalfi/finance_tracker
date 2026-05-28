from __future__ import annotations

import re
import unicodedata
from urllib.parse import urlparse

from bs4 import BeautifulSoup

from .models import BillDraft, BillItem


AMOUNT_RE = re.compile(r"(?<![\w.])(?P<currency>[$€£])?\s*(?P<amount>-?\d{1,3}(?:[,\s]\d{3})*(?:[.,]\d{2}))(?!\w)")
DATE_RE = re.compile(r"\b((?:20|19)\d{2})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])\b")
LOCATION_HINTS = ("store", "location", "address", "branch", "shop")

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Groceries": (
        "bread",
        "hleb",
        "hljeb",
        "pecivo",
        "kifla",
        "mleko",
        "mlijeko",
        "jogurt",
        "sir",
        "kajmak",
        "pavlaka",
        "egg",
        "jaje",
        "jaja",
        "fruit",
        "voce",
        "banana",
        "jabuka",
        "limun",
        "orange",
        "vegetable",
        "povrce",
        "paradajz",
        "krompir",
        "luk",
        "meat",
        "meso",
        "piletina",
        "pile",
        "svinjsko",
        "junetina",
        "salama",
        "kobasica",
        "rice",
        "pirinac",
        "pasta",
        "testenina",
        "ulje",
        "secer",
        "brasno",
        "cokolada",
        "keks",
        "voda",
        "sok",
        "market",
        "grocery",
    ),
    "Restaurants": (
        "restaurant",
        "restoran",
        "cafe",
        "kafana",
        "coffee shop",
        "pizza",
        "burger",
        "meal",
        "obrok",
        "sendvic",
        "sendvi",
        "giros",
        "kebab",
    ),
    "Household": (
        "detergent",
        "deterdz",
        "cleaner",
        "sredstvo",
        "paper",
        "papir",
        "toalet",
        "ubrus",
        "soap",
        "sapun",
        "towel",
        "kesa",
        "folija",
        "baterije",
        "sijalica",
    ),
    "Healthcare": (
        "pharmacy",
        "apoteka",
        "medicine",
        "lek",
        "lijek",
        "vitamin",
        "medical",
        "zdrav",
        "brufen",
        "paracetamol",
        "aspirin",
        "higijena",
    ),
    "Transport": (
        "fuel",
        "gorivo",
        "benzin",
        "dizel",
        "parking",
        "parkiranje",
        "parkiranja",
        "ticket",
        "karta",
        "train",
        "voz",
        "bus",
        "autobus",
        "taxi",
        "putarina",
    ),
    "Shopping": (
        "shirt",
        "majica",
        "shoe",
        "cipele",
        "patike",
        "electronics",
        "clothing",
        "odeca",
        "odjeca",
        "igracka",
        "knjiga",
    ),
    "Alcohol & Tobacco": (
        "cigare",
        "cigarete",
        "duvan",
        "tobacco",
        "pivo",
        "beer",
        "vino",
        "wine",
        "rakija",
        "vodka",
        "whisky",
    ),
    "Personal Care": (
        "sampon",
        "shampoo",
        "dezodorans",
        "deodorant",
        "pasta za zube",
        "toothpaste",
        "cetkica",
        "krema",
        "brijac",
        "ulozak",
    ),
    "Pets": ("pet", "pas", "macka", "hrana za pse", "hrana za macke", "granule", "posip"),
    "Baby": ("baby", "beba", "pelene", "vlazne maramice", "dohrana"),
}


def parse_bill_html(source_url: str, html: str) -> BillDraft:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    visible_text = normalize_space(soup.get_text("\n"))
    rows = extract_rows(soup)
    items = parse_rows(rows)
    if len(items) < 2:
        items = parse_lines(visible_text.splitlines())

    vendor = detect_vendor(source_url, soup, visible_text)
    purchased_at = detect_date(visible_text)
    location = detect_location(visible_text)
    currency = detect_currency(visible_text)
    total = round(sum(item.amount for item in items), 2)

    return BillDraft(
        source_url=source_url,
        vendor=vendor,
        purchased_at=purchased_at,
        location=location,
        currency=currency,
        total=total,
        items=items,
    )


def extract_rows(soup: BeautifulSoup) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in soup.select("tr"):
        cells = [normalize_space(cell.get_text(" ")) for cell in row.select("th, td")]
        cells = [cell for cell in cells if cell]
        if cells:
            rows.append(cells)
    return rows


def parse_rows(rows: list[list[str]]) -> list[BillItem]:
    items: list[BillItem] = []
    seen: set[str] = set()
    for row in rows:
        raw_text = normalize_space(" | ".join(row))
        amount_cell = next((cell for cell in reversed(row) if parse_amount(cell) is not None), None)
        if amount_cell is None:
            continue
        amount = parse_amount(amount_cell)
        description = normalize_space(" ".join(cell for cell in row if cell != amount_cell))
        if amount is None or should_skip(description):
            continue
        key = f"{description.lower()}:{amount}"
        if key in seen:
            continue
        seen.add(key)
        category = categorize(description)
        items.append(BillItem(description=description, quantity=1, amount=amount, category=category, suggested_category=category, raw_text=raw_text))
    return items


def parse_lines(lines: list[str]) -> list[BillItem]:
    items: list[BillItem] = []
    seen: set[str] = set()
    for line in lines:
        raw_text = normalize_space(line)
        if not raw_text:
            continue
        amount = parse_amount(raw_text)
        if amount is None:
            continue
        description = normalize_space(AMOUNT_RE.sub("", raw_text).strip(":-|"))
        if should_skip(description):
            continue
        key = f"{description.lower()}:{amount}"
        if key in seen:
            continue
        seen.add(key)
        category = categorize(description)
        items.append(BillItem(description=description, quantity=1, amount=amount, category=category, suggested_category=category, raw_text=raw_text))
    return items


def parse_amount(value: str) -> float | None:
    match = AMOUNT_RE.search(value)
    if match is None:
        return None
    raw_amount = match.group("amount").replace(" ", "")
    if "," in raw_amount and "." in raw_amount:
        raw_amount = raw_amount.replace(",", "")
    elif "," in raw_amount:
        raw_amount = raw_amount.replace(",", ".")
    try:
        return round(float(raw_amount), 2)
    except ValueError:
        return None


def categorize(description: str) -> str:
    lower = normalize_for_category(description)
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(keyword in lower for keyword in keywords):
            return category
    return "Other"


def normalize_for_category(value: str) -> str:
    value = unicodedata.normalize("NFKD", value.casefold())
    value = "".join(char for char in value if not unicodedata.combining(char))
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return normalize_space(value)


def detect_vendor(source_url: str, soup: BeautifulSoup, visible_text: str) -> str:
    title = normalize_space(soup.title.get_text(" ")) if soup.title else ""
    if title and not AMOUNT_RE.search(title):
        return title[:80]
    for line in visible_text.splitlines():
        clean = normalize_space(line)
        if 3 <= len(clean) <= 80 and not AMOUNT_RE.search(clean):
            return clean
    return urlparse(source_url).netloc or "Unknown vendor"


def detect_date(text: str) -> str | None:
    match = DATE_RE.search(text)
    if not match:
        return None
    year, month, day = match.groups()
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def detect_location(text: str) -> str | None:
    lines = [normalize_space(line) for line in text.splitlines() if normalize_space(line)]
    for index, line in enumerate(lines):
        lower = line.lower()
        if any(hint in lower for hint in LOCATION_HINTS):
            return line[:120]
        if re.search(r"\b(street|st\.|road|rd\.|avenue|ave\.|square|plaza|mall)\b", lower):
            return line[:120]
        if index > 40:
            break
    return None


def detect_currency(text: str) -> str:
    if "€" in text:
        return "EUR"
    if "£" in text:
        return "GBP"
    return "USD"


def should_skip(description: str) -> bool:
    if len(description) < 2:
        return True
    lower = description.lower()
    return any(word in lower for word in ("subtotal", "total", "balance", "tax", "vat", "paid", "change", "card"))


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()
