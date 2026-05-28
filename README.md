# Finance Tracker

MVP app for extracting line items from receipt/bill web pages opened by QR codes.

## Shape

- `apps/api`: Python FastAPI backend that fetches a bill URL, parses likely line items, stores saved bills, and returns historical totals.
- `apps/web`: React + TypeScript web app for pasting a URL, reviewing extracted items, and viewing totals.
- `packages/shared`: Shared TypeScript models intended to be reusable by the web app and a future React Native app.

## Run With Docker

```powershell
docker compose up --build
```

Then open:

- Web: `http://localhost:5173`
- API docs: `http://localhost:8000/docs`

## MVP Flow

1. Paste a bill URL from a QR code.
2. Backend fetches the page and extracts likely purchased items.
3. Web app displays item, amount, purchase date, location, and sum spent.
4. Save the bill to include it in historical totals.

## Notes

Some receipt pages may require login, block server-side fetching, or render items with JavaScript after page load. The MVP handles plain HTML pages first. Later we can add PDF parsing, authenticated browser capture, provider-specific parsers, and a React Native app that uses the same API and shared models.
