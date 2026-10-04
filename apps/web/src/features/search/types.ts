/** Shapes of the search API's public answers. */

export interface SearchItem {
  id: string;
  slug: string;
  name: string;
  category: { slug: string; name: string };
  city: string;
  address: string | null;
  location: { lat: number; lng: number } | null;
  distanceKm: number | null;
  rating: { average: number; count: number };
  verified: boolean;
  reliability: { keptPercent: number; basedOn: number } | null;
  priceFrom: { amount: number; currency: string } | null;
  openNow: boolean;
  queue: { open: boolean; waiting: number } | null;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  isPromoted: boolean;
}

export interface SearchMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  sort: string;
}

export interface CategoryNode {
  slug: string;
  name: string;
  icon: string | null;
  children: CategoryNode[];
}

export interface CategoryDetail extends CategoryNode {
  parent: { slug: string; name: string } | null;
}

export interface City {
  city: string;
  country: string;
  businesses: number;
}

export interface Suggestions {
  businesses: { id: string; slug: string; name: string; city: string; category: string }[];
  categories: { slug: string; name: string }[];
  services: string[];
}
