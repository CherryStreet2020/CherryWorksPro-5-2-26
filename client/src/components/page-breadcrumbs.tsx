import { Fragment } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export interface PageBreadcrumbItem {
  label: string;
  href?: string;
  onClick?: () => void;
  testId?: string;
  withBackArrow?: boolean;
}

export interface PageBreadcrumbsProps {
  page: string;
  group?: string;
  showDashboard?: boolean;
  items?: PageBreadcrumbItem[];
  className?: string;
}

export function PageBreadcrumbs({
  page,
  group,
  showDashboard = true,
  items,
  className,
}: PageBreadcrumbsProps) {
  const leadingItems: PageBreadcrumbItem[] = [];
  if (showDashboard) {
    leadingItems.push({
      label: "Dashboard",
      href: "/",
      testId: "button-crumb-dashboard",
      withBackArrow: true,
    });
  }
  if (items) {
    leadingItems.push(...items);
  } else if (group) {
    leadingItems.push({ label: group });
  }

  const wrapperClass = `flex items-center gap-2 text-xs${className ? ` ${className}` : ""}`;

  return (
    <div
      className={wrapperClass}
      style={{ color: "var(--lux-text-muted)" }}
      data-testid="breadcrumbs"
    >
      {leadingItems.map((item, idx) => (
        <Fragment key={idx}>
          {renderItem(item)}
          <span>/</span>
        </Fragment>
      ))}
      <span style={{ color: "var(--lux-text)" }}>{page}</span>
    </div>
  );
}

function renderItem(item: PageBreadcrumbItem) {
  const className = item.withBackArrow
    ? "flex items-center gap-1 hover:underline"
    : "hover:underline";

  const content = (
    <>
      {item.withBackArrow && <ArrowLeft className="w-3 h-3" />}
      {item.label}
    </>
  );

  if (item.href) {
    return (
      <Link href={item.href} className={className} data-testid={item.testId}>
        {content}
      </Link>
    );
  }

  if (item.onClick) {
    return (
      <button
        type="button"
        onClick={item.onClick}
        className={className}
        data-testid={item.testId}
      >
        {content}
      </button>
    );
  }

  return <span data-testid={item.testId}>{item.label}</span>;
}
