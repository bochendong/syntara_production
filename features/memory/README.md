# OpenMAIC Memory System

This feature owns the new memory boundary. Older `lib/server/study-memory*` and
`lib/server/memory-*` files are storage adapters; new product logic should live
under `features/memory`.

## Layers

1. **Short-term memory** is small overwriteable text. It tracks the learner's
   current state: what they can do, what they cannot do yet, why they are stuck,
   and the next teaching move.
2. **Long-term memory** is curated text. It stores durable course/notebook
   contracts, teacher-specific templates, local conventions, and recurring
   learner patterns.
3. **Knowledge cache** is the warm layer between curated memory and full RAG. It
   stores recently and frequently useful knowledge-base hits so repeated source
   and problem lookups can be injected cheaply before another broad search.
4. **Knowledge base** is RAG. It stores full source files, problem banks, and
   original passages that are too large to inject statically.

`MemoryFact` remains a control plane for exact current values. It is not a
fourth content layer; it decides which precise facts override fuzzy text recall.

## Read Order

Answers should read memory in this order:

1. Structured control facts.
2. Short-term learner state.
3. Static long-term course/notebook memory.
4. Dynamic long-term semantic memory.
5. Knowledge cache: recent/frequent source and problem hits.
6. Knowledge-base RAG: original source passages and problem-bank matches.

This keeps course-local rules such as CPSC107 HtDF, CSC108 docstring contracts,
or CSC148 representation invariants in the prompt, while keeping large files and
hundreds of problems searchable instead of pasted.

## Write Policy

Creator uploads may create public long-term memory and knowledge-base sources.
Learner actions may create private short-term state, private durable learning
patterns, and problem-attempt records.

### Learner event write contracts (Phase 07/08)

| Event | Source of truth | Short-term learner state | Private long-term StudyMemory | MemoryFact control plane | Knowledge base / cache |
| --- | --- | --- | --- | --- | --- |
| Submitted problem attempt | `NotebookProblemAttempt` and progress | Overwrite from one reliable graded attempt | Create only after repeated same-pattern non-passes, or a high-confidence student-authored code/reasoning trace; merge by user + target + semantic problem pattern | Read-only; a score or inferred weakness is not an exact user-confirmed fact | Read-only |
| Learner asks about a concept | Student `Message` (or a persisted local notebook-message id in local-first mode) | Overwrite when the course/topic is clear | Create or revise only when the student's own code, reasoning, or traceback directly exposes a high-confidence reusable pattern | Read-only unless the user explicitly confirms/corrects an exact current value through the confirmed fact workflow | Read-only |

The model proposes a diagnosis, but deterministic gates decide whether it may
write. Evidence excerpts must be literal substrings of the current student
message, answer, or trusted grader feedback. Assistant replies, retrieved
memory, reference answers, and fixture expectations are context only and never
prove learner ability.

A first pass after a durable gap changes the state to `improving`; it does not
claim stable mastery. Two independent same-pattern problem passes may resolve
and archive the gap. A later non-pass reactivates the same record instead of
creating a duplicate. Question-derived memories revise an existing normalized
knowledge-point record in place and must clear stale weakness/cause fields when
new grounded counter-evidence replaces them.

Course answer contracts provide an additional deterministic teaching signal for
student-authored code. CSC108 reviews inspect the teacher-style function
docstring even when the learner did not mention it; CSC148 reviews inspect
Representation Invariants and the course BinarySearchTree representation and
routing recipe. A failed check may project only
`knowledgePoint/masteredSignal/stuckPoint/cause/nextTeachingMove` plus short
literal submission excerpts into learner memory. The lecture/source and full
submission remain in their authoritative knowledge-base or attempt record.

Knowledge-base searches refresh `MemoryKnowledgeCache` with useful source and
problem hits. Cache entries are hints, not durable teaching contracts: verify
with original source evidence when exact wording matters, and promote only
course-local rules into long-term memory.

Do not promote generic textbook definitions into long-term memory. Promote only
the part that changes future answers: local templates, invariants, forbidden
moves, allowed tools, grading checks, and learner diagnosis.

For example, an OOP source should not store "a class is a blueprint". A CSC148
`Tweet` source should store the local class contract: attributes, representation
invariants, constructor expectations, and how those affect explanations or
grading.
