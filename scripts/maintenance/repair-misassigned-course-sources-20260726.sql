\set ON_ERROR_STOP on

-- Point-in-time, row-level backups for the records touched below.
\copy (select * from "CourseSource" where id in ('cms0c6hh30001qu16muxfmmc3', 'cms0c6hgo0000qu162tzo7m43', 'cms0bcawu0001qusm5x9sjcwh')) to '/private/tmp/openmaic-repair-coursesource-20260726.csv' csv header
\copy (select * from "KnowledgeDocument" where "courseSourceId" in ('cms0c6hh30001qu16muxfmmc3', 'cms0c6hgo0000qu162tzo7m43', 'cms0bcawu0001qusm5x9sjcwh')) to '/private/tmp/openmaic-repair-documents-20260726.csv' csv header
\copy (select * from "KnowledgeChunk" where "courseSourceId" in ('cms0c6hh30001qu16muxfmmc3', 'cms0c6hgo0000qu162tzo7m43', 'cms0bcawu0001qusm5x9sjcwh')) to '/private/tmp/openmaic-repair-chunks-20260726.csv' csv header
\copy (select * from "Notebook" where id in ('cmrfgw3wh00057z24fl3nb4zv', 'cmre9z1f600037zxh2k4ydwg4', 'cmqoix8bm00cn8o0u502q9u1a')) to '/private/tmp/openmaic-repair-notebooks-20260726.csv' csv header
\copy (select * from "MarkdownNotebookSection" where "notebookId" in ('cmrfgw3wh00057z24fl3nb4zv', 'cmre9z1f600037zxh2k4ydwg4', 'cmqoix8bm00cn8o0u502q9u1a')) to '/private/tmp/openmaic-repair-sections-20260726.csv' csv header
\copy (select * from "StudyMemory" where id in ('memory_88b479677a2a4f6782d74f70d633ff6d', 'memory_72bc76ede0b94b3c8290bb892f6e51ee', 'memory_e3c241b938324939b8c44983a952c40a', 'memory_bd594ea246e84943ae7335c02e22f9a6', 'memory_816325520fe945bdad0829e0a2799b80', 'memory_1baff1f8784f411abd2d0408dca69447')) to '/private/tmp/openmaic-repair-memories-20260726.csv' csv header
\copy (select * from "MemoryFact" where id in ('fact_efc766cc381b480d8f436533d8104f07', 'fact_e2680d4d91be44ab8bf8f63928a0f9bd')) to '/private/tmp/openmaic-repair-facts-20260726.csv' csv header
\copy (select * from "MemoryFactEvent" where "factId" in ('fact_efc766cc381b480d8f436533d8104f07', 'fact_e2680d4d91be44ab8bf8f63928a0f9bd')) to '/private/tmp/openmaic-repair-fact-events-20260726.csv' csv header
\copy (select * from "MemoryKnowledgeCache" where id = 'knowledge_cache_e4bdc12f55ea4e46ac6ba31a897a6063') to '/private/tmp/openmaic-repair-cache-20260726.csv' csv header

begin;

do $$
begin
  if (
    select count(*)
    from "CourseSource"
    where
      (id = 'cms0c6hh30001qu16muxfmmc3' and "courseId" = 'cmqjfarz800158oi68s595q9n' and title = '09_Series.pdf')
      or
      (id = 'cms0c6hgo0000qu162tzo7m43' and "courseId" = 'cmqjfarz800158oi68s595q9n' and title = 'SketchMol.pdf')
      or
      (id = 'cms0bcawu0001qusm5x9sjcwh' and "courseId" = 'cmqoac1vb00498o0uludsvrhd')
  ) <> 3 then
    raise exception 'CourseSource precondition failed; refusing to repair';
  end if;

  if exists (
    select 1
    from "KnowledgeDocument" old_doc
    join "KnowledgeDocument" target_doc
      on target_doc."courseId" = 'cmqoac1vb00498o0uludsvrhd'
      and target_doc."documentKey" = old_doc."documentKey"
    where old_doc."courseSourceId" = 'cms0c6hgo0000qu162tzo7m43'
      and old_doc."documentType" <> 'course_source'
  ) then
    raise exception 'Unexpected Moleclue document-key conflict; refusing to repair';
  end if;
end
$$;

-- 09_Series belongs to MAT136. Move the complete source graph.
update "KnowledgeChunk"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where "courseSourceId" = 'cms0c6hh30001qu16muxfmmc3';

update "KnowledgeDocument"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where "courseSourceId" = 'cms0c6hh30001qu16muxfmmc3';

update "Notebook"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where id = 'cmrfgw3wh00057z24fl3nb4zv';

update "MarkdownNotebookSection"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where "notebookId" = 'cmrfgw3wh00057z24fl3nb4zv';

update "StudyMemory"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where id in ('memory_88b479677a2a4f6782d74f70d633ff6d', 'memory_72bc76ede0b94b3c8290bb892f6e51ee');

update "MemoryFact"
set "scopeId" = 'cmpanemia001v8ouzmhttvkrn'
where id = 'fact_efc766cc381b480d8f436533d8104f07';

update "MemoryFactEvent"
set "scopeId" = 'cmpanemia001v8ouzmhttvkrn'
where "factId" = 'fact_efc766cc381b480d8f436533d8104f07';

update "MemoryKnowledgeCache"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where id = 'knowledge_cache_e4bdc12f55ea4e46ac6ba31a897a6063';

update "CourseSource"
set "courseId" = 'cmpanemia001v8ouzmhttvkrn'
where id = 'cms0c6hh30001qu16muxfmmc3';

-- SketchMol is a duplicate source record for Moleclue. Keep both derived
-- notebooks, merge the old record's artifacts into the canonical source, then
-- remove only the duplicate source/document projection.
delete from "KnowledgeDocument"
where "courseSourceId" = 'cms0c6hgo0000qu162tzo7m43'
  and "documentType" = 'course_source';

update "KnowledgeChunk"
set
  "courseId" = 'cmqoac1vb00498o0uludsvrhd',
  "courseSourceId" = 'cms0bcawu0001qusm5x9sjcwh'
where "courseSourceId" = 'cms0c6hgo0000qu162tzo7m43';

update "KnowledgeDocument"
set
  "courseId" = 'cmqoac1vb00498o0uludsvrhd',
  "courseSourceId" = 'cms0bcawu0001qusm5x9sjcwh'
where "courseSourceId" = 'cms0c6hgo0000qu162tzo7m43';

update "Notebook"
set "courseId" = 'cmqoac1vb00498o0uludsvrhd'
where id = 'cmre9z1f600037zxh2k4ydwg4';

update "MarkdownNotebookSection"
set "courseId" = 'cmqoac1vb00498o0uludsvrhd'
where "notebookId" = 'cmre9z1f600037zxh2k4ydwg4';

update "StudyMemory"
set "courseId" = 'cmqoac1vb00498o0uludsvrhd'
where id in ('memory_e3c241b938324939b8c44983a952c40a', 'memory_bd594ea246e84943ae7335c02e22f9a6');

update "CourseSource"
set
  "metadataJson" = coalesce("metadataJson", '{}'::jsonb) || jsonb_build_object(
    'memoryIds', to_jsonb(array[
      'memory_816325520fe945bdad0829e0a2799b80',
      'memory_1baff1f8784f411abd2d0408dca69447',
      'memory_e3c241b938324939b8c44983a952c40a',
      'memory_bd594ea246e84943ae7335c02e22f9a6'
    ]),
    'sectionIds', to_jsonb(array[
      'cmqv9uz3a00018o4h54th4xym',
      'cmqoix8rg00cp8o0un2h6m4s9',
      'cmqoix8tq00cr8o0u6dv68v9s',
      'cmqoix8ww00ct8o0ubeu2pwh7',
      'cmqoix8y400cv8o0uhmi42i7x',
      'cmqoix8zc00cx8o0u007qisdr',
      'cmre9z6oh00057zxh18g80iw3',
      'cmre9z7hb00077zxh0btb0kbu',
      'cmre9z7w000097zxh677tqojp',
      'cmre9z8af000b7zxhym44nbu3',
      'cmre9z8p4000d7zxhpbyfezsz'
    ]),
    'notebookIds', to_jsonb(array[
      'cmqoix8bm00cn8o0u502q9u1a',
      'cmre9z1f600037zxh2k4ydwg4'
    ])
  ),
  "artifactCountsJson" = coalesce("artifactCountsJson", '{}'::jsonb) || jsonb_build_object(
    'memoryCount', 4,
    'sectionCount', 11,
    'notebookCount', 2
  ),
  "contentVersion" = "contentVersion" + 1
where id = 'cms0bcawu0001qusm5x9sjcwh';

delete from "CourseSource"
where id = 'cms0c6hgo0000qu162tzo7m43';

-- Recompute the denormalized notebook counts from the authoritative rows.
update "Course" course
set "notebookCount" = (
  select count(*)::int
  from "Notebook"
  where "courseId" = course.id
)
where id in (
  'cmpanemia001v8ouzmhttvkrn',
  'cmqjfarz800158oi68s595q9n',
  'cmqoac1vb00498o0uludsvrhd'
);

do $$
begin
  if exists (
    select 1
    from "Notebook"
    where id in ('cmrfgw3wh00057z24fl3nb4zv', 'cmre9z1f600037zxh2k4ydwg4')
      and "courseId" = 'cmqjfarz800158oi68s595q9n'
  ) then
    raise exception 'A repaired notebook is still assigned to CSC148';
  end if;

  if (select count(*) from "CourseSource" where id = 'cms0c6hgo0000qu162tzo7m43') <> 0 then
    raise exception 'Duplicate SketchMol CourseSource still exists';
  end if;

  if (select "courseId" from "CourseSource" where id = 'cms0c6hh30001qu16muxfmmc3') <> 'cmpanemia001v8ouzmhttvkrn' then
    raise exception '09_Series CourseSource was not moved to MAT136';
  end if;
end
$$;

commit;
