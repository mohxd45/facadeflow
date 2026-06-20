"use client";

import { usePathname } from "next/navigation";
import TopNav from "@/components/layout/TopNav";

interface AppShellProps {
  children: React.ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen flex-col">
      <TopNav currentPath={pathname} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
