-- Customer database time = first customer message on the latest customer chat day (Bangkok time).
-- Messages from the Page/admin never affect this value.
alter table public.chat_customers
  add column if not exists first_customer_message_at timestamptz;

create or replace function public.first_customer_message_of_latest_day(payload jsonb)
returns timestamptz
language plpgsql
stable
as $$
declare
  item jsonb;
  message_at timestamptz;
  message_day date;
  latest_day date := null;
  first_at timestamptz := null;
begin
  if payload is null or jsonb_typeof(payload) <> 'array' then return null; end if;
  for item in select value from jsonb_array_elements(payload)
  loop
    if item->>'w' <> 'u' or nullif(item->>'at', '') is null then continue; end if;
    begin
      message_at := (item->>'at')::timestamptz;
    exception when others then
      continue;
    end;
    message_day := (message_at at time zone 'Asia/Bangkok')::date;
    if latest_day is null or message_day > latest_day then
      latest_day := message_day;
      first_at := message_at;
    elsif message_day = latest_day and (first_at is null or message_at < first_at) then
      first_at := message_at;
    end if;
  end loop;
  return first_at;
end;
$$;

create or replace function public.set_first_customer_message_at()
returns trigger
language plpgsql
as $$
declare
  candidate timestamptz;
  candidate_day date;
  previous_day date;
begin
  candidate := public.first_customer_message_of_latest_day(new.transcript);
  if tg_op = 'UPDATE' then
    if old.first_customer_message_at is not null then
      if candidate is null then
        new.first_customer_message_at := old.first_customer_message_at;
        return new;
      end if;
      candidate_day := (candidate at time zone 'Asia/Bangkok')::date;
      previous_day := (old.first_customer_message_at at time zone 'Asia/Bangkok')::date;
      if previous_day > candidate_day then
        new.first_customer_message_at := old.first_customer_message_at;
      elsif previous_day = candidate_day then
        new.first_customer_message_at := least(old.first_customer_message_at, candidate);
      else
        new.first_customer_message_at := candidate;
      end if;
    else
      new.first_customer_message_at := candidate;
    end if;
  else
    new.first_customer_message_at := candidate;
  end if;
  return new;
end;
$$;

drop trigger if exists chat_customers_first_customer_message_at on public.chat_customers;
create trigger chat_customers_first_customer_message_at
before insert or update of transcript on public.chat_customers
for each row execute function public.set_first_customer_message_at();

update public.chat_customers
set first_customer_message_at = public.first_customer_message_of_latest_day(transcript)
where first_customer_message_at is distinct from public.first_customer_message_of_latest_day(transcript);

create index if not exists chat_customers_page_first_customer_message_at_idx
  on public.chat_customers (page_id, first_customer_message_at desc);

delete from public.customer_report_cache;
