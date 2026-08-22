import { Link } from "react-router-dom";

type MarketingWordmarkProps = {
  linkTo?: string | null;
};

export function MarketingWordmark({ linkTo = "/" }: MarketingWordmarkProps) {
  const mark = (
    <span className="marketing-wordmark">
      <span className="marketing-wordmark-supplier">Supplier</span>
      <span className="marketing-wordmark-sync">Sync</span>
    </span>
  );

  if (linkTo) {
    return (
      <Link className="marketing-wordmark-link" to={linkTo}>
        {mark}
      </Link>
    );
  }

  return mark;
}
