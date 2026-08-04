import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

function profileInitials(user: { email?: string; user_metadata?: Record<string, unknown> } | null): string {
  const fullName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  const email = user?.email?.trim() ?? "";
  if (email) return email.slice(0, 2).toUpperCase();
  return "?";
}

type ProfileMenuProps = {
  accountPath?: string;
  billingPath?: string;
  showBilling?: boolean;
};

export function ProfileMenu({
  accountPath = "/app/account",
  billingPath = "/app/billing",
  showBilling = true,
}: ProfileMenuProps) {
  const { signOut, user } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        type="button"
        className="profile-menu-trigger"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="profile-menu-avatar" aria-hidden="true">
          {profileInitials(user)}
        </span>
      </button>

      {open && (
        <div className="profile-menu-dropdown" role="menu">
          {user?.email && <p className="profile-menu-email">{user.email}</p>}
          <Link className="profile-menu-item" role="menuitem" to={accountPath} onClick={() => setOpen(false)}>
            Account
          </Link>
          {showBilling && (
            <Link className="profile-menu-item" role="menuitem" to={billingPath} onClick={() => setOpen(false)}>
              Billing
            </Link>
          )}
          <button
            type="button"
            className="profile-menu-item profile-menu-signout"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
