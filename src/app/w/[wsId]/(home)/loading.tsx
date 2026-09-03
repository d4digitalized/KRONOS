// Přehled firmy (seznam projektů) — route group jen kvůli vlastnímu skeletonu,
// aby index nedostal obecný seznam z ../loading.tsx.
import { BoardsListSkeleton } from "@/components/Skeletons";

export default function Loading() {
  return <BoardsListSkeleton />;
}
