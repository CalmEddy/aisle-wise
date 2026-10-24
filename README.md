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
   the checkout. The store floor is a grid; shelves block walking, so
   distances are real paths around them (`src/core/floor.ts`). Up to 12
   stops are solved exactly; longer lists use nearest-neighbour + 2-opt
   (`src/core/route.ts`).
3. **Follow along** – checking off an item moves you to that spot, and you
   can tap the map or a "You're near" chip at any time. Each move re-plans
   the rest of the list.
4. **Move items** – drag an item's ⠿ handle onto the map or onto another
   stop. The location is saved on that grocery item for this store only.
   Tap **⋯** on an item to change its place or mark it **not available at
   this store**. Items not available here, and items with no location yet,
   are listed at the bottom under "Not on the route".

## Grocery items and categories

The **Items** tab holds the master list of grocery items (about 290 to start).

- Search, add, rename and delete items, and set each item's category.
- For each store, choose whether it's **available there** and **where it is**:
  "Automatic" uses wherever that store stocks the item's category, or pick
  a specific aisle or area.
- Under **Categories**, add, rename, reorder and delete categories (Dairy,
  Snacks, Pharmacy, …).

## Store layout editor

Open the **Store layout** tab to build your own stores:

- **Aisles** run up-and-down or side-to-side, with shelves on both sides.
  Set the label, length and walkway width.
- **Open areas** are rectangles you can walk through, for departments like
  Produce, Deli or Bakery.
- For each aisle or area, choose **what's stocked there** (Dairy, Pasta &
  Rice, …) and use the arrows to set their order along the aisle or area.
- Drag shapes to move them and drag the round handle to resize, or use the
  arrows and +/− buttons for exact changes.
- Set where the **entrance** and **checkout** are.
- The editor warns you if something can't be reached or a kind of product
  isn't stocked anywhere.
- Keep several stores, and pick the one you're shopping in from the list
  header. Copying a store also copies where its items are.

## Sharing

- **Share a list** – tap **Share** at the top of the List tab.
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
```

On the phone, use **Share → Add to Home Screen** (iOS) or **Install app**
(Android) to run it full-screen like a native app. It keeps working with poor
signal inside the store.

## Project layout

```
src/core/types.ts                 Layout, aisle, area and list item types
src/core/categories.ts            Starter categories and grocery items
src/core/catalog.ts               Master list lookups: name matching and suggestions
src/core/demoLayout.ts            Example store
src/core/geometry.ts              Aisle/area shapes and pick-up spots
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
