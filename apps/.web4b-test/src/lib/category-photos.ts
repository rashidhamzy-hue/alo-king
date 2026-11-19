// WEB4a: a photo for each of the catalogue's category codes (catalog_categories, 0085), from the founder's design reference's list
// (its src/lib/config.ts, imagery.categories: Unsplash, free under the Unsplash License). Downloaded once, cropped square, compressed to WebP
// (480 px for tiles and doors, 160 px for the round rail) and served from this site's own files (apps/web/public/categories): never loaded
// from Unsplash. Credited on How it works. Two were changed from the reference's choice because its photo showed other companies' brands,
// which the reference itself rules out ("never photos of branded packs"): water and drinks (juice in plain glass bottles, the reference's
// own "beverages" photo) and snacks (nuts and dried fruit, the reference's own "protein snacks" photo).
// A category code with no photo here shows the tone field with its name instead (never a broken picture).

export interface CategoryPhoto { /** Unsplash's photo id (the address of the original on images.unsplash.com) */ id: string; subject: string; tone: Tone; fresh: boolean }
export type Tone = "clay" | "sky" | "wheat" | "rose" | "ice" | "saffron" | "olive";

export const CATEGORY_PHOTOS: Record<string, CategoryPhoto> = {
  fruits_vegetables: { id: "photo-1785670719039-97d931c57436", subject: "vegetables at a market stall", tone: "olive", fresh: true },
  meat_poultry: { id: "photo-1786812594035-d9ff77d0ecb2", subject: "beef on trays at a butcher's counter", tone: "clay", fresh: true },
  deli_ready_meals: { id: "photo-1762553338305-e98211acc0ff", subject: "cheeses and cold cuts in a display case", tone: "rose", fresh: true },
  dairy_eggs: { id: "photo-1639151082235-406d8eb262b9", subject: "a bottle and a glass of milk", tone: "sky", fresh: true },
  frozen_food: { id: "photo-1601599967100-f16100982063", subject: "food in a shop's freezer", tone: "ice", fresh: true },
  bakery: { id: "photo-1710444448930-85ce405eb20f", subject: "a pile of pita bread", tone: "wheat", fresh: true },
  water_drinks: { id: "photo-1603569283847-aa295f0d016a", subject: "juices in glass bottles beside fruit", tone: "ice", fresh: false },
  breakfast_cereal: { id: "photo-1521483451569-e33803c0330c", subject: "a bowl of cereal with milk", tone: "sky", fresh: false },
  snacks_sweets: { id: "photo-1543158181-1274e5362710", subject: "nuts and dried fruit", tone: "saffron", fresh: false },
  pantry_staples: { id: "photo-1586201375761-83865001e31c", subject: "grains of white rice", tone: "wheat", fresh: false },
  canned_jarred: { id: "photo-1640348784724-93f7b14d8047", subject: "a shelf of jars", tone: "saffron", fresh: false },
  cooking_baking: { id: "photo-1474979266404-7eaacbcd87c5", subject: "an olive oil cruet", tone: "olive", fresh: false },
  cleaning_household: { id: "photo-1759846866217-e627e4478f82", subject: "cleaning things on a counter", tone: "sky", fresh: false },
  personal_care: { id: "photo-1767750666728-e21c57513343", subject: "skincare and a toothbrush", tone: "rose", fresh: false },
  baby_pet: { id: "photo-1788505433979-b9a68b3da444", subject: "a baby with silicone food pots", tone: "rose", fresh: false },
};
/** The Food door's photo: hummus, bread and olive oil (the reference's "ready to eat" photo). */
export const FOOD_PHOTO: CategoryPhoto = { id: "photo-1697126248475-a537cc5cce28", subject: "hummus, pita and olive oil", tone: "clay", fresh: false };

/** The file on this site. `small`: the 160 px one, for the round rail. */
export const photoFile = (code: string, small = false): string | null =>
  code === "food" || CATEGORY_PHOTOS[code] ? `/categories/${code}${small ? "-sm" : ""}.webp` : null;
export const toneOf = (code: string): Tone => CATEGORY_PHOTOS[code]?.tone ?? "wheat";
export const unsplashPage = (id: string): string => `https://images.unsplash.com/${id}`;
