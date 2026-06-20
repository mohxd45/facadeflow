import Link from "next/link";
import PageContainer from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <PageContainer>
      <div className="py-16 text-center">
        <h1 className="text-2xl font-semibold">Not found</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          The project or page you are looking for does not exist.
        </p>
        <Button asChild className="mt-6">
          <Link href="/projects">Go to projects</Link>
        </Button>
      </div>
    </PageContainer>
  );
}
