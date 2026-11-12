-- Staff two-factor (TOTP) sign-in becomes a switch instead of a hard rule.
--
-- * private.security_settings holds one row; staff_mfa_required defaults to FALSE
--   (the owner asked for password-only admin sign-in for now).
-- * private.is_mfa_verified() now means "this session satisfies the staff MFA
--   policy": true for any session while the switch is off, and only for an aal2
--   session while it is on. Every RLS policy and RPC that already calls it
--   (has_permission, is_super_admin, staff_activate_self, ...) follows the switch
--   with no further change.
-- * my_staff_context() reports mfa_required so the app makes the same decision.
-- * A super admin flips it with admin_set_staff_mfa_required (audited).

create table private.security_settings (
  id boolean primary key default true check (id),
  staff_mfa_required boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into private.security_settings default values;

create or replace function private.staff_mfa_required()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.staff_mfa_required from private.security_settings s where s.id), true);
$$;
revoke all on function private.staff_mfa_required() from public;
grant execute on function private.staff_mfa_required() to authenticated, service_role;

create or replace function private.is_mfa_verified()
returns boolean
language sql
stable
set search_path = ''
as $$
  select not private.staff_mfa_required()
      or coalesce((select auth.jwt() ->> 'aal'), 'aal1') = 'aal2';
$$;

create or replace function public.my_staff_context()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'aal', coalesce((select auth.jwt() ->> 'aal'), 'aal1'),
    'mfa_required', private.staff_mfa_required(),
    'is_staff', sm.user_id is not null and sm.status in ('active', 'invited'),
    'status', sm.status,
    'role', sm.role_code,
    'display_name', sm.display_name,
    'permissions', case when sm.status = 'active' then coalesce(
      (select jsonb_agg(rp.permission_code order by rp.permission_code)
         from public.role_permissions rp where rp.role_code = sm.role_code),
      '[]'::jsonb) else '[]'::jsonb end
  )
  from (select 1) one
  left join public.staff_members sm on sm.user_id = (select auth.uid());
$$;
revoke all on function public.my_staff_context() from public;
grant execute on function public.my_staff_context() to authenticated;

-- Super admins switch staff MFA on or off. Turning it on sends every staff
-- session without a verified second factor to the authenticator step.
create or replace function public.admin_set_staff_mfa_required(p_required boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before boolean;
begin
  if not private.is_super_admin() then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_required is null then
    raise exception 'p_required is required' using errcode = '22004';
  end if;
  select staff_mfa_required into v_before from private.security_settings where id for update;
  update private.security_settings
     set staff_mfa_required = p_required, updated_at = now(), updated_by = (select auth.uid())
   where id;
  if v_before is distinct from p_required then
    perform private.write_audit('settings.staff_mfa', 'security_settings', 'staff_mfa_required',
      jsonb_build_object('staff_mfa_required', v_before), jsonb_build_object('staff_mfa_required', p_required), null);
  end if;
  return p_required;
end;
$$;
revoke all on function public.admin_set_staff_mfa_required(boolean) from public;
grant execute on function public.admin_set_staff_mfa_required(boolean) to authenticated;
