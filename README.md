# Aisle Wise

A grocery list for your phone that knows where everything is in the store.
It puts your list in the order of the shortest walk through the store, and
re-orders it as you move.

## How it works

1. **Add items** – type `milk, apples, pasta`. Each item is matched to a
   kind of product (e.g. "almond milk" → Dairy, "almonds" → Snacks) and then
   to the aisle or area in your store that stocks it.
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
   stop. The app remembers that location for that store.

## Store layout editor

Open the **Store layout** tab to build your own stores:

- **Aisles** run up-and-down or side-to-side, with shelves on both sides.
  Set the label, length and walkway width.
- **Open areas** are rectangles you can walk through, for departments like
  Produce, Deli or Bakery.
- For each aisle or area, choose **what's stocked there** (Dairy, Pasta &
  Rice, …). In aisles they're spread out in the order you list them.
- Drag shapes to move them and drag the round handle to resize, or use the
  arrows and +/− buttons for exact changes.
- Set where the **entrance** and **checkout** are.
- The editor warns you if something can't be reached or a kind of product
  isn't stocked anywhere.
- Keep several stores, and pick the one you're shopping in from the list
  header.

## Run it

```bash
npm install
npm run dev      # open the "Network" URL on your phone (same Wi-Fi)
npm test         # routing and matching tests
npm run build    # static files in dist/ – host anywhere (GitHub Pages, Netlify…)
```

On the phone, use **Share → Add to Home Screen** (iOS) or **Install app**
(Android) to run it full-screen like a native app. It keeps working with poor
signal inside the store.

## Project layout

```
src/core/types.ts                 Layout, aisle, area and list item types
src/core/categories.ts            Kinds of products and the words that identify them
src/core/demoLayout.ts            Example store
src/core/geometry.ts              Aisle/area shapes and pick-up spots
src/core/floor.ts                 Walkable grid and walking distances
src/core/locate.ts                Item name → spot in the store
src/core/route.ts                 Route planning (shortest walk)
src/core/validate.ts              Layout warnings
src/components/ShoppingView.tsx   Shopping list with drag-and-drop
src/components/LayoutEditor.tsx   Store layout editor
src/components/StoreMap.tsx       Store map used by both
```

## Ideas for next steps

- **Automatic indoor location** – GPS isn't accurate inside buildings.
  Options: Bluetooth beacons per aisle (needs a native wrapper such as
  Capacitor), scanning a QR code on each aisle sign, or a store's own API.
  Anything that produces a `Point` can drive the existing re-planning.
- **Share layouts** – export/import a store layout so friends can use it.
- **Shared lists** – sync a household list across phones.

## Live app

Every push to `main` is tested, built and published to GitHub Pages:
https://calmeddy.github.io/aisle-wise/
