// Skeleton během server-side práce stránky (auth + role) při přepnutí sekce.
// Obecný seznam — sekce s jiným tvarem (nástěnka, Můj den, přehled firmy)
// mají vlastní loading.tsx se stejným skeletonem, jaký pak ukazuje view.
import { ListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return <ListSkeleton />;
}
