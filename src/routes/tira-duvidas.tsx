import { createFileRoute } from "@tanstack/react-router";
import { HELP_CATEGORIES, type HelpCategory } from "@/lib/dimensionamento-help";

type TiraDuvidasSearch = {
  q?: string;
  category?: HelpCategory;
};

export const Route = createFileRoute("/tira-duvidas")({
  validateSearch: (search: Record<string, unknown>): TiraDuvidasSearch => {
    const q = typeof search.q === "string" && search.q.trim() ? search.q : undefined;
    const category = HELP_CATEGORIES.includes(search.category as HelpCategory)
      ? (search.category as HelpCategory)
      : undefined;

    return { q, category };
  },
  head: () => ({
    meta: [
      { title: "Tira-dúvidas - Dimensionamento Care" },
      {
        name: "description",
        content: "Central de dúvidas sobre os conceitos e cálculos do Dimensionamento Care.",
      },
    ],
  }),
});
