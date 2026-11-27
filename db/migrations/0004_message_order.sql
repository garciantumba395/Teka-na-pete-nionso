-- 0004_message_order : ordre d'insertion stable pour les messages et les échanges de litige.
-- Deux lignes écrites dans la même milliseconde ont le même created_at, et leur id est un UUID aléatoire :
-- sans colonne de séquence, leur ordre d'affichage n'était pas déterministe.
alter table messages add column seq bigint generated always as identity;
create index messages_conversation_seq_idx on messages (conversation_id, seq);
alter table dispute_evidence add column seq bigint generated always as identity;
create index dispute_evidence_dispute_seq_idx on dispute_evidence (dispute_id, seq);
