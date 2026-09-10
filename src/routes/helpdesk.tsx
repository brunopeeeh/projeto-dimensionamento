import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/helpdesk")({
  head: () => ({
    meta: [
      { title: "Helpdesk - Dimensionamento Care" },
      {
        name: "description",
        content: "Volume e capacity do Helpdesk (canal único) por horário e dia da semana.",
      },
    ],
  }),
});
