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
   Items a store doesn't sell are listed separately.

## Grocery items and categories

The **Items** tab holds the master list of grocery items (about 290 to start).

- Search, add, rename and delete items, and set each item's category.
- For each store, choose whether it's **sold there** and **where it is**:
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
