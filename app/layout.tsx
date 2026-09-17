import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./product.css";
import "./interaction.css";
import "./features.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://origin.imbored.fun"),
  title: "Origin | A workspace for your team",
  description: "A shared space for your projects, conversations, and ideas. Plan the work, sketch together, and keep your team connected with Origin.",
  openGraph: { title: "Origin", description: "A shared space for whatever comes next.", images: [{ url: "/landing/issues.png", width: 1440, height: 820, alt: "Origin team workspace" }] },
  icons: [{ rel: "icon", url: "/origin.svg" }],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#070708",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
