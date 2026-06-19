import { Link } from "react-router-dom";
import { LEGAL_LAST_UPDATED } from "../lib/legal";

export function LegalFooter({ className }: { className?: string }) {
  return (
    <p className={`legal-footer${className ? ` ${className}` : ""}`}>
      <Link to="/terms">Terms of Service</Link>
      <span aria-hidden="true"> · </span>
      <Link to="/privacy">Privacy Policy</Link>
      <span className="legal-footer-updated muted small">Updated {LEGAL_LAST_UPDATED}</span>
    </p>
  );
}
