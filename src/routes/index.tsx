import { createFileRoute } from "@tanstack/react-router";
import { JourneyStudio } from "@/components/journey-studio";

export const Route = createFileRoute("/")({
  component: Home,
  head: () => ({
    meta: [
      { title: "Plainpath" },
      { name: "description", content: "Design website journeys and state machines in plain English." },
    ],
  }),
});

function Home() {
  return <JourneyStudio />;
}
