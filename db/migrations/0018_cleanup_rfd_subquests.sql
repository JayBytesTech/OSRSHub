-- 0018_cleanup_rfd_subquests: one-time cleanup of orphan Recipe for Disaster SUBQUEST rows.
-- Dink used to auto-tick each RFD subquest (e.g. "Recipe for Disaster - Mountain Dwarf") as its own
-- quest_completions row, but the hub tracks RFD atomically as "Recipe for Disaster", so those rows
-- never counted toward QP or displayed — pure orphans. The ingest now skips subquest names
-- (isAutoTickableQuest); this removes any already stored. The bare "Recipe for Disaster" is kept.

DELETE FROM quest_completions
 WHERE quest LIKE 'Recipe for Disaster %'
   AND quest <> 'Recipe for Disaster';
