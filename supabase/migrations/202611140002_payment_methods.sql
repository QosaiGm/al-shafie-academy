-- Add selectable manual payment methods and the account details configured by the teacher.
-- Safe to run more than once; existing payment rows default to Jawwal Pay.
alter table public.payment_submissions
  add column if not exists payment_method text not null default 'jawwal_pay'
    check (payment_method in ('jawwal_pay', 'bank_of_palestine', 'palpay'));

alter table public.platform_settings
  add column if not exists bank_name text not null default 'بنك فلسطين',
  add column if not exists bank_account_holder text not null default '',
  add column if not exists bank_account_number text not null default '',
  add column if not exists bank_iban text not null default '',
  add column if not exists bank_instructions text not null default '',
  add column if not exists palpay_number text not null default '',
  add column if not exists palpay_holder text not null default '',
  add column if not exists palpay_instructions text not null default '';
