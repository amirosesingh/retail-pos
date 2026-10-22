import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function SettingsBackLink() {
  return <Button asChild variant="outline" size="icon" className="shrink-0" aria-label="Back to Settings" title="Back to Settings">
    <Link to="/settings"><ArrowLeft className="size-4" aria-hidden="true" /></Link>
  </Button>;
}
