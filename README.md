# Aisle Wise

A grocery list for your phone that knows where everything is in the store.
It puts your list in the order of the shortest walk through the store, and
re-orders it as you move.

## How it works

1. **Add items** – type `milk, apples, pasta` and each item is matched to a
   section of the store (e.g. "almond milk" → Dairy, "almonds" → Aisle 4).
2. **Plan the route** – items in the same section are grouped into one stop,
   and the stops are ordered for the shortest walk from where you are to the
   checkout. Store walking is modelled as parallel aisles joined by a front
   and back cross-aisle (`src/core/distance.ts`). Up to 12 stops are solved
   exactly; longer lists use nearest-neighbour + 2-opt (`src/core/route.ts`).
3. **Follow along** – the app knows where you are because:
   - checking off an item moves you to that item's section, and
   - you can tap a "You're near" chip (Aisle 3, Dairy, …) at any time.
   Each position change re-plans the rest of the list immediately.
4. **Teach it** – items it can't place show up under "Where is this?". Pick a
   section once and it remembers for next time.

Your list, position and learned locations are saved on the device.

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
src/core/types.ts            Store, section and list item types
src/core/demoStore.ts        Example store layout and product catalog
src/core/locate.ts           Item name → store section matching
src/core/distance.ts         Walking distance inside a store
src/core/route.ts            Route planning (shortest walk)
src/App.tsx                  Mobile UI
src/components/StoreMap.tsx  Live store map
```

## Ideas for next steps

- **Automatic indoor location** – GPS isn't accurate inside buildings.
  Options: Bluetooth beacons per aisle (needs a native wrapper such as
  Capacitor), scanning a QR code on each aisle sign, or a store's own API.
  Anything that produces a `Point` can drive the existing re-planning.
- **Real store layouts** – load layouts per store instead of the demo store,
  and let users pick their store.
- **Shared lists** – sync a household list across phones.
