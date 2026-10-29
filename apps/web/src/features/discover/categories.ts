import { BookOpen, Clapperboard, Coffee, Compass, FlaskConical, Gamepad2, Music, Palette } from 'lucide-react';

/** Discover's categories, as the API knows them (DISCOVERY_CATEGORIES in beacons.routes.ts). */
export const DISCOVERY_CATEGORIES = [
  { id: 'gaming', label: 'Gaming', icon: Gamepad2 },
  { id: 'music', label: 'Music', icon: Music },
  { id: 'entertainment', label: 'Entertainment', icon: Clapperboard },
  { id: 'science-tech', label: 'Science & Tech', icon: FlaskConical },
  { id: 'education', label: 'Education', icon: BookOpen },
  { id: 'creative', label: 'Art & Creativity', icon: Palette },
  { id: 'hangout', label: 'Hangouts', icon: Coffee },
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number]['id'];

export const DISCOVER_HOME = { label: 'Home', icon: Compass };

export const categoryOf = (id: string | null | undefined) => DISCOVERY_CATEGORIES.find((c) => c.id === id);
