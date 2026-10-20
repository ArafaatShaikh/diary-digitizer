create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  personal_lexicon text[] default '{}',
  character_quirks text[] default '{}',
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  image_url text not null,
  raw_transcription text,
  corrected_transcription text,
  created_at timestamp with time zone default timezone('utc'::text, now())
);

alter table profiles enable row level security;
alter table entries enable row level security;

create policy "Users can view their own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users can update their own profile" on profiles
  for update using (auth.uid() = id);

create policy "Users can manage their own entries" on entries
  for all using (auth.uid() = user_id);
