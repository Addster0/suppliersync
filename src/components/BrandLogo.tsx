import { Link } from "react-router-dom";
import { APP_NAME, LOGO_SRC } from "../lib/brand";

type BrandLogoProps = {
  variant?: "nav" | "auth" | "sidebar" | "footer";
  linkTo?: string | null;
};

export function BrandLogo({ variant = "nav", linkTo = "/" }: BrandLogoProps) {
  const image = (
    <img src={LOGO_SRC} alt={APP_NAME} className="brand-logo-img" loading="eager" decoding="async" />
  );

  if (linkTo) {
    return (
      <Link className={`brand-logo brand-logo--${variant}`} to={linkTo}>
        {image}
      </Link>
    );
  }

  return <div className={`brand-logo brand-logo--${variant}`}>{image}</div>;
}
