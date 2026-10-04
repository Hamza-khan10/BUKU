import {
  Activity,
  BriefcaseBusiness,
  Car,
  Droplets,
  Dumbbell,
  Flower2,
  HandHeart,
  IdCard,
  Landmark,
  PawPrint,
  PersonStanding,
  Scale,
  Scissors,
  Shirt,
  Smile,
  Sparkles,
  Stethoscope,
  Store,
  Wrench,
  Zap,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { createElement } from 'react';

/**
 * Each category's icon, chosen by its slug: one consistent line-icon style
 * across the site instead of emoji (which look different on every device).
 * A category without an entry gets a neutral shop icon.
 */
const ICONS: Record<string, LucideIcon> = {
  'beauty-hair': Scissors,
  barbershop: Scissors,
  'hair-salon': Scissors,
  'nail-salon': Sparkles,
  'health-medical': Stethoscope,
  'dental-clinic': Smile,
  'general-physician': Stethoscope,
  physiotherapy: Activity,
  'wellness-spa': Flower2,
  spa: Flower2,
  massage: HandHeart,
  'yoga-studio': PersonStanding,
  fitness: Dumbbell,
  gym: Dumbbell,
  'personal-training': Dumbbell,
  automotive: Car,
  'car-wash': Droplets,
  'auto-repair': Wrench,
  pets: PawPrint,
  'pet-grooming': PawPrint,
  veterinary: PawPrint,
  'government-public': Landmark,
  'passport-office': IdCard,
  'utility-services': Zap,
  'home-professional': BriefcaseBusiness,
  tailor: Shirt,
  'legal-consultation': Scale,
};

export function categoryIcon(slug: string): LucideIcon {
  // Own keys only: a category named "constructor" must not pick up Object's own function.
  return (Object.hasOwn(ICONS, slug) ? ICONS[slug] : undefined) ?? Store;
}

/** A category's icon as an element (decorative: the category's name is always shown with it). */
export function CategoryIcon({ slug, ...props }: LucideProps & { slug: string }) {
  return createElement(categoryIcon(slug), { 'aria-hidden': true, ...props });
}
