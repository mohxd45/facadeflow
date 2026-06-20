# Supabase Schema — Facade Takeoff

This file contains all DDL required to set up the Supabase database for Facade Takeoff.

## Quick-start

### 1. Create a Supabase project
Go to [supabase.com](https://supabase.com), create a new project, and wait for it to be provisioned.

### 2. Set environment variables
Copy `.env.local.example` to `.env.local` and fill in your values:

```
NEXT_PUBLIC_STORAGE_MODE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

Restart the dev server after changing `.env.local`.

### 3. Run the SQL (in order)
Open the Supabase SQL Editor and run the blocks below **in order**:
1. `projects`
2. `drawings`
3. `quantity_takeoff_items`
4. `layer_mappings`
5. `manual_quantities`
6. `company_profiles`
7. Storage bucket
8. RLS policies (optional — see below)

### 4. Test the connection
Go to **Settings → Supabase Tools → Test Supabase connection** in the app.
All six tables should show as **Ready**.

### 5. Migrate local data (optional)
Use **Settings → Supabase Tools → Copy local data to Supabase** to migrate
any existing localStorage data to Supabase before switching modes.

---

## Table DDL

### projects

```sql
create table if not exists projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  client_name  text,
  location     text,
  description  text,
  notes        text,
  status       text not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- auto-update updated_at
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger projects_updated_at
  before update on projects
  for each row execute procedure set_updated_at();
```

### drawings

```sql
create table if not exists drawings (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  file_name         text not null,
  file_type         text not null,
  file_size         bigint not null,
  drawing_view_type text not null default 'plan',
  category          text,
  floor_or_location text,
  uploaded_at       timestamptz not null default now(),
  preview_url       text,
  storage_path      text,
  status            text not null default 'uploaded',
  notes             text,
  has_local_blob    boolean not null default false,
  error_message     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger drawings_updated_at
  before update on drawings
  for each row execute procedure set_updated_at();

create index if not exists drawings_project_id_idx on drawings(project_id);
```

### quantity_takeoff_items

```sql
create table if not exists quantity_takeoff_items (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references projects(id) on delete cascade,
  item_code         text,
  element_name      text not null,
  category          text not null,
  drawing_view_type text not null default 'plan',
  location_floor    text not null default '',
  quantity          numeric not null,
  unit              text not null,
  source_drawing_id uuid references drawings(id) on delete set null,
  confidence        text not null default 'manual',
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger quantity_takeoff_items_updated_at
  before update on quantity_takeoff_items
  for each row execute procedure set_updated_at();

create index if not exists qto_project_id_idx on quantity_takeoff_items(project_id);
```

### layer_mappings

```sql
create table if not exists layer_mappings (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references projects(id) on delete cascade,
  layer_name       text not null,
  category         text not null,
  measurement_mode text not null default 'auto',
  unit             text not null,
  enabled          boolean not null default true,
  notes            text,
  entity_count     integer,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger layer_mappings_updated_at
  before update on layer_mappings
  for each row execute procedure set_updated_at();

create index if not exists layer_mappings_project_id_idx on layer_mappings(project_id);
```

### manual_quantities

```sql
create table if not exists manual_quantities (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references projects(id) on delete cascade,
  item_code      text,
  element_name   text not null,
  category       text not null,
  location_floor text,
  quantity       numeric not null,
  unit           text not null,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger manual_quantities_updated_at
  before update on manual_quantities
  for each row execute procedure set_updated_at();

create index if not exists manual_quantities_project_id_idx on manual_quantities(project_id);
```

### company_profiles

Only one row is used per deployment. The app always reads the first row ordered
by `created_at`.

> **Note on logo storage:** `logo_data_url` stores a Base64 data URL. This is
> fine for development. For production, upload the logo to Supabase Storage and
> store only the public URL instead.

```sql
create table if not exists company_profiles (
  id             uuid primary key default gen_random_uuid(),
  company_name   text not null,
  logo_data_url  text,
  address        text,
  phone          text,
  email          text,
  website        text,
  trn            text,
  prepared_by    text,
  checked_by     text,
  default_notes  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger company_profiles_updated_at
  before update on company_profiles
  for each row execute procedure set_updated_at();
```

---

## Storage bucket

```sql
-- Run in the SQL editor OR create via the Supabase UI: Storage → New Bucket
insert into storage.buckets (id, name, public)
values ('drawing-files', 'drawing-files', false)
on conflict (id) do nothing;
```

### Storage policy (allow all reads/writes for open dev mode)

```sql
create policy "Allow all operations on drawing-files"
on storage.objects
for all
using ( bucket_id = 'drawing-files' )
with check ( bucket_id = 'drawing-files' );
```

---

## Row-Level Security (RLS)

RLS is **disabled** in open development mode (no auth). Enable RLS and add
policies when you add Supabase Auth.

To disable RLS for all tables (dev mode):

```sql
alter table projects               disable row level security;
alter table drawings               disable row level security;
alter table quantity_takeoff_items disable row level security;
alter table layer_mappings         disable row level security;
alter table manual_quantities      disable row level security;
alter table company_profiles       disable row level security;
```

When you add auth, replace with per-user policies:

```sql
-- Example: users can only see their own projects
alter table projects enable row level security;

create policy "Users see own projects"
on projects for all
using ( auth.uid() = user_id );
```

---

## TypeScript ↔ Supabase column mapping

| TypeScript (camelCase) | Supabase column (snake_case) |
|------------------------|------------------------------|
| `clientName`           | `client_name`                |
| `createdAt`            | `created_at`                 |
| `updatedAt`            | `updated_at`                 |
| `projectId`            | `project_id`                 |
| `sourceDrawingId`      | `source_drawing_id`          |
| `drawingViewType`      | `drawing_view_type`          |
| `locationFloor`        | `location_floor`             |
| `floorOrLocation`      | `floor_or_location`          |
| `hasLocalBlob`         | `has_local_blob`             |
| `errorMessage`         | `error_message`              |
| `storagePath`          | `storage_path`               |
| `previewUrl`           | `preview_url`                |
| `itemCode`             | `item_code`                  |
| `elementName`          | `element_name`               |
| `layerName`            | `layer_name`                 |
| `measurementMode`      | `measurement_mode`           |
| `entityCount`          | `entity_count`               |
| `companyName`          | `company_name`               |
| `logoDataUrl`          | `logo_data_url`              |
| `preparedBy`           | `prepared_by`                |
| `checkedBy`            | `checked_by`                 |
| `defaultNotes`         | `default_notes`              |

---

## Switching storage mode

| Step | Action |
|------|--------|
| 1 | Run all DDL above in your Supabase SQL Editor |
| 2 | Verify tables in Settings → Supabase Tools → Test connection |
| 3 | (Optional) Migrate local data via Settings → Copy local data to Supabase |
| 4 | Set `NEXT_PUBLIC_STORAGE_MODE=supabase` in `.env.local` |
| 5 | Restart the dev server (`npm run dev`) |

To revert to local mode, set `NEXT_PUBLIC_STORAGE_MODE=local` and restart.
