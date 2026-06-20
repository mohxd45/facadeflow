import type { Metadata } from "next";
import AppShell from "@/components/layout/AppShell";
import StoreHydrator from "@/components/providers/StoreHydrator";
import "./globals.css";

export const metadata: Metadata = {
  title: "Facade Takeoff — Quantity Takeoff for Construction Drawings",
  description:
    "Upload façade construction drawings and extract quantity takeoff items for ACP cladding, curtain wall, balustrades, and more.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AppShell>
          <StoreHydrator>{children}</StoreHydrator>
        </AppShell>
      </body>
    </html>
  );
}
