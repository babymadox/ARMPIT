-- Singular models agencies and sources as many-to-many. A (source, agency) pair is the unit that carries stats,
-- so a source can work with several agencies and an agency with several sources, each with its own numbers.
alter type channel_kind add value if not exists 'linkedin';

alter table tracker_sources add column if not exists external_group text not null default '';
alter table tracker_sources drop constraint if exists tracker_sources_connection_id_external_id_key;
alter table tracker_sources add constraint tracker_sources_pair_key unique (connection_id, external_id, external_group);

alter table partner_links add column if not exists external_group text not null default '';
alter table partner_links drop constraint if exists partner_links_connection_id_external_id_key;
alter table partner_links add constraint partner_links_pair_key unique (connection_id, external_id, external_group);

-- Catalogue rows from before agencies were tracked have no agency; they are rediscovered by the next sync.
delete from tracker_sources where external_group = '';
