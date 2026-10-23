import { describe, expect, it } from 'vitest';
import { demoStore } from './demoStore';
import { walkDistance } from './distance';
import { findSection, normalize } from './locate';
import { groupIntoStops, planRoute, routeLength } from './route';
import type { ListItem, Stop } from './types';

const item = (name: string): ListItem => ({ id: name, name, done: false });
const locate = (i: ListItem) => findSection(i.name, demoStore);
const sectionIds = (stops: Stop[]) => stops.map((s) => s.section.id);

describe('walkDistance', () => {
  const store = { depth: 60, aisleXs: [0, 10, 20] };

  it('walks straight within the same aisle', () => {
    expect(walkDistance({ x: 10, y: 5 }, { x: 10, y: 50 }, store)).toBe(45);
  });

  it('goes around the front when that is shorter', () => {
    expect(walkDistance({ x: 10, y: 5 }, { x: 20, y: 5 }, store)).toBe(20);
  });

  it('goes around the back when that is shorter', () => {
    expect(walkDistance({ x: 10, y: 55 }, { x: 20, y: 55 }, store)).toBe(20);
  });
});

describe('findSection', () => {
  it('normalizes plurals and punctuation', () => {
    expect(normalize('2x Bananas!')).toBe('x banana');
    expect(normalize('Strawberries')).toBe('strawberry');
  });

  it('prefers the longest keyword', () => {
    expect(findSection('almond milk', demoStore)?.id).toBe('dairy');
    expect(findSection('almonds', demoStore)?.id).toBe('a4f');
    expect(findSection('ice cream', demoStore)?.id).toBe('a8b');
    expect(findSection('cream', demoStore)?.id).toBe('dairy');
  });

  it('uses what the user taught it first', () => {
    expect(findSection('Grandma’s sauce', demoStore)).toBeUndefined();
    expect(findSection('Grandma’s sauce', demoStore, { 'grandma s sauce': 'a2b' })?.id).toBe('a2b');
  });
});

describe('planRoute', () => {
  it('groups items in the same section into one stop', () => {
    const { stops, unplaced } = groupIntoStops(
      [item('milk'), item('yogurt'), item('apples'), item('flux capacitor')],
      locate,
    );
    expect(stops).toHaveLength(2);
    expect(unplaced.map((i) => i.name)).toEqual(['flux capacitor']);
  });

  it('starts with what is nearest the entrance and re-plans from a new position', () => {
    const { stops } = groupIntoStops(
      [item('apples'), item('steak'), item('pasta'), item('milk')],
      locate,
    );
    const fromDoor = planRoute(demoStore.entrance, stops, demoStore);
    expect(sectionIds(fromDoor)[0]).toBe('fruit');

    const atMeat = demoStore.sections.find((s) => s.id === 'meat')!.point;
    const fromMeat = planRoute(atMeat, stops, demoStore);
    expect(sectionIds(fromMeat)[0]).toBe('meat');
  });

  it('finds a route at least as short as the list order', () => {
    const names = ['soda', 'bread', 'steak', 'cereal', 'shampoo', 'eggs', 'ice cream', 'apples', 'rice', 'diapers'];
    const { stops } = groupIntoStops(names.map(item), locate);
    const planned = planRoute(demoStore.entrance, stops, demoStore);
    expect(routeLength(demoStore.entrance, planned, demoStore)).toBeLessThanOrEqual(
      routeLength(demoStore.entrance, stops, demoStore),
    );
  });

  it('handles long lists with the heuristic and still beats list order', () => {
    const { stops } = groupIntoStops(
      demoStore.sections.map((s) => ({ id: s.id, name: s.id, done: false })),
      (i) => demoStore.sections.find((s) => s.id === i.id),
    );
    expect(stops.length).toBeGreaterThan(12);
    const planned = planRoute(demoStore.entrance, stops, demoStore);
    expect(new Set(sectionIds(planned)).size).toBe(stops.length);
    expect(routeLength(demoStore.entrance, planned, demoStore)).toBeLessThan(
      routeLength(demoStore.entrance, stops, demoStore),
    );
  });
});
