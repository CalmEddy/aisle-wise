# Aisle Wise

A grocery list for your phone that knows where everything is in the store.
It puts your list in the order of the shortest walk through the store, and
re-orders it as you move.

## How it works

1. **Add items** – start typing; every suggestion shows where it is in the
   current store and has two buttons:
   - **+ List** adds it to your list.
   - **🛒 Cart** means you're holding it: it's checked off (or added as
     already in the cart). If it has no saved location in this store, where
     you're standing is saved. If it's saved somewhere else, the app asks
     whether to move it here or keep the saved place.
   Anything new you type joins the master list at your current spot. A
   banner confirms each add, with **Change place** and **Undo**.
2. **Plan the route** – items picked up at the same spot are grouped into one
   stop, and stops are ordered for the shortest walk from where you are to
   the checkout. Each shelf or area is picked up in one pass (walked end to
   end, in whichever direction is shorter), so a place is never split; only
   the order of places is optimised. The store floor is a grid; shelves
   block walking, so distances are real paths around them
   (`src/core/floor.ts`, `src/core/route.ts`).
3. **Follow along** – checking off an item moves you to that spot, and you
   can tap anywhere on the map, or a place or section name in the list
   (e.g. "Pasta & Rice"), to say where you are. Each move re-plans
   the rest of the list.
4. **Move items** – drag an item's ⠿ handle onto the exact spot on the map,
   or onto another item. The location is saved on that grocery item for this
   store only. **Change place** (in the ⋯ menu) opens the map: tap a shelf or
   area to zoom in, then tap the exact spot. Spots are saved relative to the
   shelf or area, so they stay right if you move or resize it. A shelf can be
   reached from either side; the route uses whichever is closer.
5. **Stops** – items on the same shelf or in the same area share one card,
   listed in walking order with where each one is ("near the top"). Items on
   the same square count as one spot (tomato soup and vegetable soup side by
   side are picked up together). Turn **Group by section** off for one list,
   nearest first, that re-sorts as you move. The map shows a dot for each
   item; tap 📍 on an item to pinpoint it with a red pulsing circle.
   Tap **⋯** on an item to change its **category**, change its place, or mark
   it **not available at this store**. Each item shows its category icon
   (switch off with **Icons in list**). Items not available here, and items with no location yet,
   are listed at the bottom under "Not on the route".

## Build mode: map a store as you shop

Turn on **🛠 Build mode** on the Shop tab. Say where you are (tap the map, or
use the ← ↑ ↓ → arrows to move a square at a time), then check items off or
tap 🛒 Cart. The map builds itself around you (`src/core/build.ts`):

- **On or right beside a shelf** – the item is saved on that shelf, level
  with you, and its category is added to the shelf.
- **In an open area** – saved at that spot in the area.
- **Up to 3 squares past the end of a shelf** (lined up with it) – the shelf
  is extended to you. Items already on it stay where they physically are.
- **Lined up with a shelf further away** (a vertical shelf above or below
  you, or a horizontal one to your left or right, with clear floor between)
  – the banner asks where the item goes: **Extend Shelf N** for the nearest
  such shelf in each direction, **New shelf** or **New area**. The item is
  in your cart either way; **Decide later** leaves its spot unset.
- **Anywhere else** – a new 3-square shelf is made through your square
  (trimmed to fit), numbered "Shelf 1", "Shelf 2"…. The banner asks
  ↕ / ↔ for its direction, and offers **Rename** and **Undo**.
- An item already saved somewhere else in the store isn't moved without
  asking (**Keep** / **Move here**).
- Switch **Build: Shelves | Areas** to make open areas instead: picking up on
  open floor makes a 3 × 3 area around you (trimmed to fit, numbered "Area 1",
  "Area 2"…), and picking up within 3 squares outside an area
  stretches it to include you.

Tap a shelf or area on the map to edit it right there – label, what's on
it, direction, length, position or delete – just like in the store editor.

Also in Build mode: **+ Area here**, **Turn shelf**, **I'm at the entrance**,
**I'm at checkout**, and **New store** to start a blank one. Stepping past
the edge of the map makes the store bigger.

## Grocery items and categories

The **Items** tab holds the master list of grocery items (about 290 to start).

- Search, add, rename and delete items, and set each item's category.
- For each store, choose whether it's **available there** and **where it is**:
  "Automatic" uses wherever that store stocks the item's category, or pick
  a specific shelf or area.
- Under **Categories**, add, rename, reorder and delete categories (Dairy,
  Snacks, Pharmacy, …), and tap a category's colour or icon to change it.
  Every starter category has its own colour and icon (🥛 Dairy, 🍝 Pasta…).

Switches under the map turn **colours on the map**, **icons on the map** and
**colours in the list** on or off (remembered per phone).

## Store layout editor

Open the **Store layout** tab to build your own stores:

- **Shelves** are single sticks, one square thick, running up-and-down or
  side-to-side, any length. Give each a **label** – it's written on the
  shelf itself on the map. Walkways are simply the floor between shelves,
  so two shelves facing each other make an aisle (pasta on one, soup on the
  other).
- **Open areas** are rectangles you can walk through, for departments like
  Produce, Deli or Bakery.
- Tap a shelf or area to choose **what's on it**: an ordered list of
  categories along the shelf (or across the area). Each category's section
  shows on the map in its colour, with its icon.
- Stores made before shelves had "aisles"; each one is turned into two
  shelves (its left and right sides) automatically, keeping saved item
  locations (`src/core/migrate.ts`).
- Drag shapes to move them and drag the round handle to resize, or use the
  arrows and +/− buttons for exact changes.
- Set where the **entrance** and **checkout** are.
- The editor warns you if something can't be reached or a kind of product
  isn't stocked anywhere.
- Keep several stores, and pick the one you're shopping in from the list
  header. Copying a store also copies where its items are.

## Sharing

- **Share a list** – tap **Share** at the top of the Shop tab.
- **Share a store** – in **Store layout**, pick the store and tap **Share**.
  The layout, its categories, where items are in that store and which items
  it doesn't carry all come along.

Send the link any way you like (the phone's share menu, text, email). When
someone opens it, Aisle Wise shows what was shared and lets them add it. A
store they already have can be updated in place. Shared lists skip items
already on their list, and new items join their master list.

The shared data is packed into the link itself, after `#`, so it is never
uploaded anywhere. Links are copies: later changes aren't synced, so share
again to send updates (`src/core/share.ts`). For a list that stays in sync,
use a household.

## Households (live sharing)

Tap the **Share with household** button under the store name. Create an
account (email + password) or sign in, right in the app, then create a
household or join one with an invite code or link. Everyone in a household shares one shopping
list, grocery items, categories and stores, and changes appear on everyone's
phone as you shop. Where you're standing and which store you're in stay
per phone. It keeps working offline and catches up when the signal returns.

How it works: the shared data is split into small documents stored in
Supabase (`docs` table), one per list item, grocery item and store, plus
one for the category list. Each phone sends what changed and receives
other phones' changes live; the last change to a document wins
(`src/sync/engine.ts`). Database rules only let members of a household read
or change its data (`supabase/migrations/`).

### Live sharing setup (one time)

1. **Create the tables.** In your Supabase project, open **SQL Editor**,
   paste the contents of
   `supabase/migrations/20261024000000_households.sql`, and run it. It's
   safe to run again. To confirm it worked, run `supabase/check.sql`: every
   row should say OK.
2. **Turn on in-app sign-in without emails.** In **Authentication → Sign In
   / Providers → Email**, make sure **Email** is enabled and turn **Confirm
   email** off, then save. Accounts are then ready the moment they're
   created, and Supabase never needs to send an email.
3. **Give the app your project's address and public key.** In Supabase,
   **Project Settings → API** shows the **Project URL** and the **anon
   public** key. In GitHub, open the repo's **Settings → Secrets and
   variables → Actions → Variables** and add:
   - `SUPABASE_URL` = the Project URL
   - `SUPABASE_ANON_KEY` = the anon public key

   The anon key is meant to be public; the database rules protect the data.
4. **Redeploy.** Actions → **Deploy to GitHub Pages** → **Run workflow**.

For local development, put the same two values in `.env.local` as
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

Forgotten passwords: resetting one needs email, so instead create a new
account and rejoin with the household's invite code (the shared data lives in
the household). You can also delete old accounts under **Authentication →
Users**.


## Run it

```bash
npm install
npm run dev      # open the "Network" URL on your phone (same Wi-Fi)
npm test         # routing, matching, sharing, sync and database-rule tests
npm run build    # static files in dist/ – host anywhere (GitHub Pages, Netlify…)
npm run e2e      # browser tests on a phone-sized screen (after npm run build;
                 # first time: npx playwright install chromium)
```

The browser tests live in `e2e/`. GitHub Actions runs them, with the unit tests,
before every deploy and on pull requests.

On the phone, use **Share → Add to Home Screen** (iOS) or **Install app**
(Android) to run it full-screen like a native app. It keeps working with poor
signal inside the store.

## Project layout

```
src/core/types.ts                 Layout, shelf, area and list item types
src/core/categories.ts            Starter categories and grocery items
src/core/catalog.ts               Master list lookups: name matching and suggestions
src/core/demoLayout.ts            Example store
src/core/geometry.ts              Shelf/area shapes and pick-up spots
src/core/migrate.ts               Converting old aisles to shelves
src/core/build.ts                 Build mode: growing the map from where you shop
src/core/floor.ts                 Walkable grid and walking distances
src/core/locate.ts                Grocery item → spot in a store
src/core/route.ts                 Route planning (shortest walk)
src/core/validate.ts              Layout warnings
src/components/ShoppingView.tsx   Shopping list with suggestions and drag-and-drop
src/components/ItemsView.tsx      Grocery items and categories editor
src/components/LayoutEditor.tsx   Store layout editor
src/components/StoreMap.tsx       Store map used by both
src/components/ShareSheets.tsx    Share link and import screens
src/core/share.ts                 Packing lists/stores into links, and importing them
src/sync/engine.ts                Household sync: sending and receiving changes
src/sync/supabase.ts              Supabase connection
src/sync/useHousehold.ts          Sign-in, households, running the sync
src/components/HouseholdSheet.tsx Household screen
supabase/migrations/              Database tables and access rules
```

## Ideas for next steps

- **Automatic indoor location** – GPS isn't accurate inside buildings.
  Options: Bluetooth beacons per aisle (needs a native wrapper such as
  Capacitor), scanning a QR code on each aisle sign, or a store's own API.
  Anything that produces a `Point` can drive the existing re-planning.

## Live app

Every push to `main` is tested, built and published to GitHub Pages:
https://calmeddy.github.io/aisle-wise/
