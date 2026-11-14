-- Outbound messages are saved first, then delivered by the channel adapter; record how that went.
alter table messages add column if not exists delivery_status text not null default 'sent' check (delivery_status in ('pending','sent','failed'));
alter table messages add column if not exists error text;
