import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createStaff, deleteUsers, pool } from "./helpers";

let editor: string;
let catalog: string;
let editOnly: string;

beforeAll(async () => {
  editor = await createStaff("content_editor");
  catalog = await createStaff("catalog_manager");
  // A custom role with cms.edit but not cms.publish, to prove the split.
  await pool.query(`insert into public.staff_roles (code, name) values ('test_drafter', 'Test drafter') on conflict do nothing`);
  await pool.query(`insert into public.role_permissions values ('test_drafter', 'cms.edit') on conflict do nothing`);
  editOnly = await createStaff("test_drafter");
});

afterAll(async () => {
  await deleteUsers([editor, catalog, editOnly]);
  await pool.query(`delete from public.role_permissions where role_code = 'test_drafter'`);
  await pool.query(`delete from public.staff_roles where code = 'test_drafter'`);
  await pool.end();
});

const staff = (sub: string) => ({ role: "authenticated" as const, sub, aal: "aal2" as const });

describe("hero drafts vs published versions", () => {
  it("visitors read only the live snapshot, never drafts", () =>
    as({ role: "anon" }, async (sql) => {
      expect(await sql.query(`select * from public.hero_scenes`)).toHaveLength(0);
      const versions = await sql.query<{ scenes: unknown[] }>(`select scenes from public.hero_tour_versions`);
      expect(versions).toHaveLength(1);
      expect(versions[0]!.scenes).toHaveLength(5);
    }));

  it("draft edits do not change the live site until published, and rollback restores", () =>
    as(staff(editor), async (sql) => {
      await sql.query(`update public.hero_scenes set heading = 'Draft heading' where position = 1`);
      const live = async () => {
        await sql.query("set local role anon");
        const [{ h }] = await sql.query<{ h: string }>(`select scenes->0->>'heading' as h from public.hero_tour_versions`);
        await sql.query("reset role");
        await sql.query("set local role authenticated");
        return h;
      };
      const before = await live();
      const [{ max }] = await sql.query<{ max: number }>(`select max(version) as max from public.hero_tour_versions`);
      const [{ r }] = await sql.query<{ r: { version: number; version_id: string } }>(`select public.admin_publish_hero('home', 'test') as r`);
      expect(r.version).toBe(max + 1);
      expect(await live()).toBe("Draft heading");

      const [{ id: prev }] = await sql.query<{ id: string }>(`select id from public.hero_tour_versions where version = $1`, [max]);
      await sql.query(`select public.admin_rollback_hero($1)`, [prev]);
      expect(await live()).toBe(before);
      const [{ heading }] = await sql.query<{ heading: string }>(`select heading from public.hero_scenes where position = 1`);
      expect(heading).toBe(before);
      expect(await sql.errorCode(`update public.hero_tour_versions set note = 'x'`)).not.toBeNull();
    }));

  it("reorders scenes by swapping positions", () =>
    as(staff(editor), async (sql) => {
      const [{ id }] = await sql.query<{ id: string }>(`select id from public.hero_scenes where position = 1`);
      await sql.query(`select public.admin_move_hero_scene($1, 1)`, [id]);
      const [{ position }] = await sql.query<{ position: number }>(`select position from public.hero_scenes where id = $1`, [id]);
      expect(position).toBe(2);
    }));

  it("needs cms.publish to publish and cms.edit to draft", async () => {
    await as(staff(editOnly), async (sql) => {
      expect(await sql.errorCode(`update public.hero_scenes set heading = 'ok' where position = 2`)).toBeNull();
      expect(await sql.errorCode(`select public.admin_publish_hero('home', null)`)).toBe("42501");
    });
    await as(staff(catalog), async (sql) => {
      expect(await sql.query(`update public.hero_scenes set heading = 'nope' returning id`)).toHaveLength(0);
      expect(await sql.errorCode(`select public.admin_move_hero_scene(gen_random_uuid(), 1)`)).toBe("42501");
    });
    await as({ role: "authenticated", sub: editor, aal: "aal1" }, async (sql) => {
      expect(await sql.errorCode(`select public.admin_publish_hero('home', null)`)).toBe("42501");
    });
  });

  it("rejects unsafe scene links and images at the database", () =>
    as(staff(editor), async (sql) => {
      expect(await sql.errorCode(`update public.hero_scenes set cta_href = 'javascript:alert(1)' where position = 1`)).toBe("23514");
      expect(await sql.errorCode(`update public.hero_scenes set cta_href = '//evil.example' where position = 1`)).toBe("23514");
      expect(await sql.errorCode(`update public.hero_scenes set image_path = 'https://example.com/x.jpg' where position = 1`)).toBe("23514");
    }));
});
