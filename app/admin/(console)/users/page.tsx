import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Avatar } from "@/components/admin/admin-sidebar";
import { Badge, ButtonLink, PageHeader, Table, fieldCls, tdCls, thCls } from "@/components/admin/ui";
import { requireStaff } from "@/lib/auth/staff";
import { formatBDT } from "@/lib/money";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { setCustomerDisabled } from "./actions";

export const metadata: Metadata = { title: "Users" };

type Row = { id: string; email: string | null; full_name: string; phone: string | null; is_disabled: boolean; is_staff: boolean; created_at: string; last_sign_in_at: string | null; order_count: number; spent_minor: number; total_count: number };
const PAGE = 50;
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Asia/Dhaka", day: "numeric", month: "short", year: "numeric" }) : "never");

export default async function UsersPage({ searchParams }: PageProps<"/admin/users">) {
  const staff = await requireStaff("customers.read");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_customers", { p_search: q || null, p_limit: PAGE, p_offset: (page - 1) * PAGE });
  const rows = (error ? [] : (data ?? [])) as Row[];
  const total = Number(rows[0]?.total_count ?? 0);
  const canManage = staff.permissions.includes("customers.manage");
  const canStaff = staff.permissions.includes("staff.manage");
  const link = (p: number) => `/admin/users?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <div>
      <PageHeader
        title="Users"
        description="Everyone with an account: customers and staff. Disabling a customer stops them using their account (orders stay). Staff roles and MFA are managed on the Staff page."
        actions={canStaff ? <ButtonLink href="/admin/staff" variant="secondary">Manage staff &amp; roles</ButtonLink> : null}
      />
      <form className="mb-4 flex gap-2" role="search">
        <label className="sr-only" htmlFor="user-q">Search users</label>
        <input id="user-q" name="q" defaultValue={q} placeholder="Search name, email or phone" className={`${fieldCls} max-w-sm bg-white`} />
        <button className="rounded-lg border border-line bg-white px-4 text-sm">Search</button>
      </form>
      <Table testId="users-table">
        <thead><tr><th className={thCls}>User</th><th className={thCls}>Phone</th><th className={thCls}>Orders</th><th className={thCls}>Spent</th><th className={thCls}>Joined</th><th className={thCls}>Last sign-in</th><th className={thCls}>Status</th></tr></thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={7} className={`${tdCls} text-center text-muted`}>{q ? "No users match that search." : "No users yet."}</td></tr> : null}
          {rows.map((u) => (
            <tr key={u.id}>
              <td className={tdCls}>
                <div className="flex items-center gap-3">
                  <Avatar user={{ name: u.full_name || u.email || "?", avatar: null }} size={32} />
                  <div><p className="font-medium text-espresso">{u.full_name || "No name"}</p><p className="text-xs text-muted">{u.email}</p></div>
                </div>
              </td>
              <td className={tdCls}>{u.phone ?? "—"}</td>
              <td className={tdCls}>{u.order_count && u.phone ? <Link href={`/admin/orders?q=${encodeURIComponent(u.phone)}`} className="underline">{u.order_count}</Link> : u.order_count}</td>
              <td className={tdCls}>{formatBDT(Number(u.spent_minor))}</td>
              <td className={tdCls}>{day(u.created_at)}</td>
              <td className={tdCls}>{day(u.last_sign_in_at)}</td>
              <td className={tdCls}>
                <div className="flex flex-col items-start gap-2">
                  {u.is_staff ? <Badge tone="info">Staff</Badge> : u.is_disabled ? <Badge tone="bad">Disabled</Badge> : <Badge tone="good">Active</Badge>}
                  {canManage && !u.is_staff ? (
                    <details className="text-xs">
                      <summary className="cursor-pointer underline">{u.is_disabled ? "Enable" : "Disable"}</summary>
                      <div className="mt-2 w-64">
                        <ActionForm action={setCustomerDisabled.bind(null, u.id, !u.is_disabled)} label={`${u.is_disabled ? "Enable" : "Disable"} ${u.email}`} submitLabel={u.is_disabled ? "Enable account" : "Disable account"} danger={!u.is_disabled} className="space-y-2">
                          <input name="reason" required minLength={3} maxLength={300} placeholder="Reason (audit log)" className={fieldCls} />
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <span>{total} user{total === 1 ? "" : "s"}</span>
        <span className="flex gap-3">
          {page > 1 ? <Link href={link(page - 1)} className="underline">Previous</Link> : null}
          {page * PAGE < total ? <Link href={link(page + 1)} className="underline">Next</Link> : null}
        </span>
      </div>
    </div>
  );
}
