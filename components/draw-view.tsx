"use client";
import { ContentSkeleton } from "./content-skeleton";

import dynamic from "next/dynamic";
import { PenTool } from "lucide-react";
const Canvas = dynamic(() => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/excalidraw/";
  return import("./drawing-canvas");
}, { ssr: false, loading: () => <ContentSkeleton kind="canvas" label="Loading drawing" /> });

export function DrawView({ sessionToken, user }: { sessionToken: string; user: { _id: string; name: string } }) {
  return <section className="draw-view" aria-label="Draw"><Canvas sessionToken={sessionToken} user={user} /></section>;
}
