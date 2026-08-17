import type { Metadata } from "next";
import Studio from "@/components/Studio";
import { apiKeyPresent } from "@/lib/ai";

export const metadata: Metadata = {
  title: "Studio · Discord Bot Generator using AI",
  description: "Compose a Discord bot, test its mind, and download the project.",
};

export default function BuilderPage() {
  // Read on the server so the client never sees the key, only whether one exists.
  return <Studio configured={apiKeyPresent()} />;
}
