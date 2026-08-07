import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
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
};

function isAccountPath(pathname: string, accountPath: string) {
  return pathname === accountPath || pathname.endsWith(accountPath);
}

export function ProfileMenu({ accountPath = "/app/account" }: ProfileMenuProps) {
  const { signOut, user } = useAuth();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const onAccountPage = isAccountPath(pathname, accountPath);

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
        className={`profile-menu-trigger${onAccountPage ? " is-active" : ""}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Account menu"
        aria-current={onAccountPage ? "page" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="profile-menu-avatar" aria-hidden="true">
          {profileInitials(user)}
        </span>
      </button>

      {open && (
        <div className="profile-menu-dropdown" role="menu">
          {user?.email && <p className="profile-menu-email">{user.email}</p>}
          <Link
            aria-current={onAccountPage ? "page" : undefined}
            className={`profile-menu-item${onAccountPage ? " is-active" : ""}`}
            role="menuitem"
            to={accountPath}
            onClick={() => setOpen(false)}
          >
            Account
          </Link>
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
