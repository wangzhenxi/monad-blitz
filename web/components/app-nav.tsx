"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLotteryAddr } from "@/lib/lottery-hooks";

const GITHUB_URL = "https://github.com/wangzhenxi/monad-blitz";

/// 需要携带活动上下文（?addr=）的页面
const TABS: { href: string; label: string; withAddr?: boolean }[] = [
  { href: "/", label: "首页" },
  { href: "/play", label: "活动", withAddr: true },
  { href: "/gather", label: "集熵现场", withAddr: true },
  { href: "/host", label: "签发工具", withAddr: true },
  { href: "/create", label: "创建活动" },
  { href: "/docs/product", label: "产品设计" },
  { href: "/docs/tech", label: "技术方案" },
];

/// 全站统一顶部导航：所有页面入口 + GitHub 外链。
/// 页面标题由各页传入（与 tab 名保持一致），右侧可放钱包连接等。
export function AppNav({ title, right }: { title: string; right?: ReactNode }) {
  const pathname = usePathname();
  const addr = useLotteryAddr();

  return (
    <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-6 py-3 border-b">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-lg font-bold">{title}</span>
        <nav className="flex gap-3 text-sm text-muted-foreground flex-wrap">
          {TABS.map((t) => {
            const active = pathname === t.href;
            const href = t.withAddr && addr ? `${t.href}?addr=${addr}` : t.href;
            return (
              <a
                key={t.href}
                className={`${active ? "text-foreground font-medium underline underline-offset-4" : "hover:text-foreground"}`}
                href={href}
              >
                {t.label}
              </a>
            );
          })}
          <a
            className="hover:text-foreground"
            href={GITHUB_URL}
            target="_blank"
            rel="noreferrer"
          >
            GitHub ↗
          </a>
        </nav>
      </div>
      {right}
    </header>
  );
}
