# Athletica Manggahan

Court reservations, deposits, cancellations and the athlete shop for Manggahan Complex Sports & Recreation. *Play Hard. Move Forward.*

## Run it

Needs Node 18 or newer. No packages to install.

```bash
node server.js
```

Open http://localhost:8123. Data is read from and written to `data/db.json`.

```bash
node server.js --reset-db
```

Rebuilds `data/db.json` with sample bookings dated around today, then starts the server. Use `--seed-only` to rebuild without starting.

Opening `index.html` directly (or adding `?demo` to the URL) runs **demo mode**: the same `core.js` rules run in the browser against localStorage. Demo mode is for previews only, because nothing it enforces is protected from the person using the browser.

## Development accounts

| Role | Username | Password |
|---|---|---|
| Player | `athlete.demo` | `Athletica@123` |
| Front desk | `frontdesk.admin` | `FrontDesk@123` |

These exist for testing only. Remove them, and the demo-account panel on the sign-in page, before any real use.

## Sign-up and password reset

Anyone can create a **player** account from the sign-in page. Front desk accounts can't be created this way. Passwords need at least 8 characters, a letter and a number, can't be a common password and can't contain the username.

"Forgot password?" sends a 6-digit code to the email on the account. The reply is the same whether or not the account exists. Each code expires after 15 minutes, works once, stops working after 5 wrong tries, and is stored hashed. A new request cancels the previous code, and there are at most 3 requests per 15 minutes. A successful reset signs the account out on every device.

**No email service is connected yet.** With `node server.js`, the code is printed in the server's terminal. In demo mode it appears in a labelled "Demo mailbox" on the page. Replace `mailer()` in `server.js` with a real email provider before launch.

## Files

| File | What it holds |
|---|---|
| `core.js` | Every business rule: pricing, holds, payments, cancellations, refund policy, stock, notifications, activity log. Shared by the server and demo mode. |
| `server.js` | HTTP server, JSON API (`POST /api/<action>`), sessions, password hashing, atomic writes to `data/db.json`. |
| `app.js` | The interface. Renders what the API returns and never decides prices, eligibility or permissions. |
| `index.html`, `styles.css` | Page shell and styles. |
| `images/products/` | One illustration per shop product (SVG). Each product's `image` field in the database points here; older databases get it filled in on start. |
| `logo.svg` | The logo mark (vector, brand red `#DF3821`). Also the browser-tab icon. The header uses the same shapes inline, coloured with the site's `--red`. |
| `data/db.json` | The development database. |

## Booking flow

Book → choose a sport and date → choose a court from the 3D court cards (each shows its price and open hours for that day; closed courts can't be picked) → the court's details and hours appear → pick up to 3 back-to-back hours → sign in if needed (the selection is kept) → review → pay the deposit → staff verify → confirmed. The chosen sport, date, court and hours survive a page reload and the browser's back and forward buttons. Front desk accounts see every court's hours in one grid instead of the court cards.

The navigation sits in the top bar at every width; on phones it folds into a Menu button.

Visitors see Home, Courts, Features, How it works and Shop, plus **Sign in** and **Sign up** (on phones, at the bottom of the menu). Courts can be browsed without an account; booking asks you to sign in and keeps your selection. After signing in or up, players land on My reservations and front desk staff on the Front desk. Opening the site root while signed in goes straight there.

## Front desk floor view

Front desk accounts land on **Floor view**: every court as a 3D tile showing who is on it now (with player markers on the court), who is up next, and whether payment is still due. A timeline shows the floor at any hour today. Selecting a court opens its full schedule for the day, with the usual Check in, Cash received, Review payment and Cancel actions, plus its ratings. On smaller screens the panel slides up from the bottom. It's built from the reservations the front desk already receives; players get "Not available".

## Court ratings

Players can rate a court (1–5 stars, optional comment up to 300 characters) once their booking is completed, and edit it for 7 days. Courts show "★ 4.2 (9)" on the court cards, a Rating fact and the three latest comments; a court shows "New" until it has 3 visible ratings. The front desk can hide a rating (a reason is required and it's logged) or show it again; hidden ratings don't count. Ratings live in the `courtRatings` collection, and older databases get sample ratings on first start.

## How the rules are enforced

- Requests are applied one at a time and each writes the whole database atomically, so checking a slot and reserving it can't interleave. Two players racing for the same hour: one gets it, the other is told it's taken.
- Amounts, deposits, discounts and refunds are computed in `core.js` from `courts`, `products` and `settings`. Amounts sent by the browser are ignored.
- Players can only see and act on their own reservations; anything else returns "not found". Staff actions return 403 for player accounts.
- Passwords are stored as salted scrypt hashes. Sessions are opaque tokens in an HttpOnly, SameSite cookie and expire after 8 hours of inactivity.
- Cancelling never deletes anything: the reservation becomes `CANCELLED`, a `cancellations` record keeps the reason, policy snapshot and refund decision, and both are listed in `activityLogs`.
- Refunds are manual. `APPROVED` means staff agreed to refund; only after staff confirm the money went back does it become `COMPLETED` and the payment `REFUNDED`.

## Before production

`data/db.json` is a development database. For real use, move the same collections into a proper database with a unique constraint on court, date and hour. Load wallet numbers and QR codes from server configuration, store payment proofs outside the web root, and serve over HTTPS.
