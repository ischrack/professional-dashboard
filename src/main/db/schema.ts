import Database from 'better-sqlite3'

export function initializeDatabase(db: Database.Database): void {
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.exec(`
    -- Resume bases (multiple named profiles)
    CREATE TABLE IF NOT EXISTS resume_bases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'text',
      doc_type TEXT NOT NULL DEFAULT 'resume',
      locked_sections TEXT NOT NULL DEFAULT '["publications"]',
      source_file_name TEXT,
      source_file_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Resume base versions (vault history)
    CREATE TABLE IF NOT EXISTS resume_base_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_id INTEGER NOT NULL REFERENCES resume_bases(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'text',
      source_file_name TEXT,
      source_file_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(base_id, version_number)
    );

    -- Post Generator sessions
    CREATE TABLE IF NOT EXISTS post_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_url TEXT,
      source_text TEXT,
      paper_title TEXT,
      paper_authors TEXT,
      paper_journal TEXT,
      paper_abstract TEXT,
      current_post TEXT NOT NULL DEFAULT '',
      messages TEXT NOT NULL DEFAULT '[]',
      word_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Paper search profiles
    CREATE TABLE IF NOT EXISTS search_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      keywords TEXT NOT NULL DEFAULT '[]',
      mesh_terms TEXT NOT NULL DEFAULT '[]',
      authors TEXT NOT NULL DEFAULT '[]',
      journals TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Papers
    CREATE TABLE IF NOT EXISTS papers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pmid TEXT UNIQUE,
      doi TEXT UNIQUE,
      title TEXT NOT NULL,
      authors TEXT NOT NULL DEFAULT '',
      journal TEXT NOT NULL DEFAULT '',
      year INTEGER,
      abstract TEXT NOT NULL DEFAULT '',
      pdf_path TEXT,
      impact_factor REAL,
      altmetric_score REAL,
      altmetric_cached_at TEXT,
      trending_tier TEXT,
      profile_ids TEXT NOT NULL DEFAULT '[]',
      is_read INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      source TEXT NOT NULL DEFAULT 'pubmed',
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      published_at TEXT
    );

    -- Paper <-> profile junction
    CREATE TABLE IF NOT EXISTS paper_profiles (
      paper_id INTEGER NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
      profile_id INTEGER NOT NULL REFERENCES search_profiles(id) ON DELETE CASCADE,
      PRIMARY KEY (paper_id, profile_id)
    );

    -- Jobs
    CREATE TABLE IF NOT EXISTS jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      title TEXT NOT NULL,
      location TEXT,
      remote TEXT,
      url TEXT,
      description TEXT,
      salary TEXT,
      job_type TEXT,
      seniority_level TEXT,
      num_applicants INTEGER,
      easy_apply INTEGER,
      status TEXT NOT NULL DEFAULT 'needs_enrichment',
      source TEXT NOT NULL DEFAULT 'linkedin',
      applied_at TEXT,
      salary_range TEXT,
      application_source TEXT DEFAULT 'LinkedIn',
      logo_url TEXT,
      company_research TEXT,
      added_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Application materials (resume, cover letter, recruiter message)
    CREATE TABLE IF NOT EXISTS application_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      messages TEXT NOT NULL DEFAULT '[]',
      base_resume_id INTEGER REFERENCES resume_bases(id),
      exported_docx_path TEXT,
      exported_pdf_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(job_id, type)
    );

    -- Q&A entries
    CREATE TABLE IF NOT EXISTS qa_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE CASCADE,
      question TEXT NOT NULL,
      answer TEXT NOT NULL DEFAULT '',
      char_limit INTEGER,
      is_template INTEGER NOT NULL DEFAULT 0,
      template_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Job notes
    CREATE TABLE IF NOT EXISTS job_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Interview briefs (one per job)
    CREATE TABLE IF NOT EXISTS interview_briefs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
      depth TEXT NOT NULL DEFAULT 'quick',
      content TEXT NOT NULL DEFAULT '',
      sources TEXT NOT NULL DEFAULT '[]',
      search_count INTEGER NOT NULL DEFAULT 0,
      brief_version INTEGER NOT NULL DEFAULT 1,
      partial INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Interview sessions
    CREATE TABLE IF NOT EXISTS interview_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      mode TEXT NOT NULL DEFAULT 'live_feedback',
      categories TEXT NOT NULL DEFAULT '[]',
      brief_version INTEGER,
      status TEXT NOT NULL DEFAULT 'in_progress',
      debrief_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Interview exchanges (individual Q&A turns within a session)
    CREATE TABLE IF NOT EXISTS interview_exchanges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES interview_sessions(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      answer_text TEXT NOT NULL DEFAULT '',
      feedback_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Code Learning: projects
    CREATE TABLE IF NOT EXISTS code_learning_projects (
      id                    TEXT PRIMARY KEY,
      title                 TEXT NOT NULL,
      summary               TEXT NOT NULL,
      languages             TEXT NOT NULL,          -- JSON array
      resume_artifact       TEXT NOT NULL,
      prerequisite_installs TEXT NOT NULL,          -- JSON array
      project_folder_path   TEXT,                   -- null until folder chosen
      intake_form_json      TEXT NOT NULL,          -- full intake form responses
      proposal_json         TEXT NOT NULL,          -- accepted ProjectProposal
      status                TEXT NOT NULL DEFAULT 'active',  -- active|paused|completed|archived
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL
    );

    -- Code Learning: steps (one row per step, ordered by step_number)
    CREATE TABLE IF NOT EXISTS code_learning_steps (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL REFERENCES code_learning_projects(id),
      step_number              INTEGER NOT NULL,
      title                    TEXT NOT NULL,
      objective                TEXT NOT NULL,
      context                  TEXT NOT NULL,
      instructions             TEXT NOT NULL,
      hints                    TEXT NOT NULL,       -- JSON array of strings
      hints_revealed           INTEGER NOT NULL DEFAULT 0,
      target_file              TEXT,
      target_function_or_block TEXT,
      validation_criteria      TEXT NOT NULL,
      estimated_minutes        INTEGER NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'locked',  -- locked|active|submitted|completed
      completion_method        TEXT,                -- manual|vscode|null
      completed_at             TEXT
    );

    -- Code Learning: coaching chat messages per step (including feedback cards)
    CREATE TABLE IF NOT EXISTS code_learning_messages (
      id         TEXT PRIMARY KEY,
      step_id    TEXT NOT NULL REFERENCES code_learning_steps(id),
      role       TEXT NOT NULL,   -- user|assistant|feedback
      content    TEXT NOT NULL,   -- plain text for user/assistant; JSON blob for feedback
      created_at TEXT NOT NULL
    );

    -- Code Learning: cached step-level conversation summary (generated when message count > 40)
    CREATE TABLE IF NOT EXISTS code_learning_step_summaries (
      step_id                       TEXT PRIMARY KEY REFERENCES code_learning_steps(id),
      summary                       TEXT NOT NULL,
      summarized_through_message_id TEXT NOT NULL,
      created_at                    TEXT NOT NULL
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
    CREATE INDEX IF NOT EXISTS idx_papers_pmid ON papers(pmid);
    CREATE INDEX IF NOT EXISTS idx_papers_added_at ON papers(added_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_added_at ON jobs(added_at);
    CREATE INDEX IF NOT EXISTS idx_post_sessions_updated ON post_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_qa_templates ON qa_entries(is_template);
    CREATE INDEX IF NOT EXISTS idx_interview_sessions_job ON interview_sessions(job_id);
    CREATE INDEX IF NOT EXISTS idx_interview_exchanges_session ON interview_exchanges(session_id);
    CREATE INDEX IF NOT EXISTS idx_resume_base_versions_base ON resume_base_versions(base_id);
    CREATE INDEX IF NOT EXISTS idx_code_learning_projects_status ON code_learning_projects(status);
    CREATE INDEX IF NOT EXISTS idx_code_learning_projects_updated ON code_learning_projects(updated_at);
    CREATE INDEX IF NOT EXISTS idx_code_learning_steps_project ON code_learning_steps(project_id);
    CREATE INDEX IF NOT EXISTS idx_code_learning_messages_step ON code_learning_messages(step_id);
  `)
}

export function runMigrations(db: Database.Database): void {
  // Resume vault columns on resume_bases
  const resumeBaseColumns = db.pragma('table_info(resume_bases)') as { name: string }[]
  if (!resumeBaseColumns.some(c => c.name === 'doc_type')) {
    db.exec(`ALTER TABLE resume_bases ADD COLUMN doc_type TEXT NOT NULL DEFAULT 'resume'`)
  }
  if (!resumeBaseColumns.some(c => c.name === 'locked_sections')) {
    db.exec(`ALTER TABLE resume_bases ADD COLUMN locked_sections TEXT NOT NULL DEFAULT '["publications"]'`)
  }
  if (!resumeBaseColumns.some(c => c.name === 'source_file_name')) {
    db.exec(`ALTER TABLE resume_bases ADD COLUMN source_file_name TEXT`)
  }
  if (!resumeBaseColumns.some(c => c.name === 'source_file_path')) {
    db.exec(`ALTER TABLE resume_bases ADD COLUMN source_file_path TEXT`)
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS resume_base_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      base_id INTEGER NOT NULL REFERENCES resume_bases(id) ON DELETE CASCADE,
      version_number INTEGER NOT NULL,
      content TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'text',
      source_file_name TEXT,
      source_file_path TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(base_id, version_number)
    );
    CREATE INDEX IF NOT EXISTS idx_resume_base_versions_base ON resume_base_versions(base_id);
  `)

  // Backfill history for existing bases if missing.
  const existingBases = db.prepare(`
    SELECT id, content, format, source_file_name, source_file_path, created_at
    FROM resume_bases
  `).all() as Array<{
    id: number
    content: string
    format: string
    source_file_name: string | null
    source_file_path: string | null
    created_at: string
  }>

  const hasVersionStmt = db.prepare('SELECT id FROM resume_base_versions WHERE base_id = ? LIMIT 1')
  const insertVersionStmt = db.prepare(`
    INSERT INTO resume_base_versions
      (base_id, version_number, content, format, source_file_name, source_file_path, created_at)
    VALUES (?, 1, ?, ?, ?, ?, ?)
  `)

  for (const base of existingBases) {
    const existingVersion = hasVersionStmt.get(base.id) as { id: number } | undefined
    if (!existingVersion) {
      insertVersionStmt.run(
        base.id,
        base.content || '',
        base.format || 'text',
        base.source_file_name,
        base.source_file_path,
        base.created_at || new Date().toISOString(),
      )
    }
  }

  // Add category column to qa_entries if it doesn't exist
  const qaColumns = db.pragma('table_info(qa_entries)') as { name: string }[]
  if (!qaColumns.some(c => c.name === 'category')) {
    db.exec(`ALTER TABLE qa_entries ADD COLUMN category TEXT`)
  }

  // Add sources + title columns to post_sessions if they don't exist
  const postCols = db.pragma('table_info(post_sessions)') as { name: string }[]
  if (!postCols.some(c => c.name === 'sources')) {
    db.exec(`ALTER TABLE post_sessions ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'`)
  }
  if (!postCols.some(c => c.name === 'title')) {
    db.exec(`ALTER TABLE post_sessions ADD COLUMN title TEXT`)
  }

  // Pattern repository — tracks user-confirmed/highlighted DOM patterns for future enrichment rebuilding
  db.exec(`
    CREATE TABLE IF NOT EXISTS enrichment_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
      url TEXT,
      url_pattern TEXT,
      field_type TEXT NOT NULL DEFAULT 'description',
      selected_text TEXT,
      chain_json TEXT,
      selectors_json TEXT,
      source TEXT NOT NULL DEFAULT 'manual_enrich',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Code Learning module — four new tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_learning_projects (
      id                    TEXT PRIMARY KEY,
      title                 TEXT NOT NULL,
      summary               TEXT NOT NULL,
      languages             TEXT NOT NULL,
      resume_artifact       TEXT NOT NULL,
      prerequisite_installs TEXT NOT NULL,
      project_folder_path   TEXT,
      intake_form_json      TEXT NOT NULL,
      proposal_json         TEXT NOT NULL,
      status                TEXT NOT NULL DEFAULT 'active',
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_learning_steps (
      id                       TEXT PRIMARY KEY,
      project_id               TEXT NOT NULL REFERENCES code_learning_projects(id),
      step_number              INTEGER NOT NULL,
      title                    TEXT NOT NULL,
      objective                TEXT NOT NULL,
      context                  TEXT NOT NULL,
      instructions             TEXT NOT NULL,
      hints                    TEXT NOT NULL,
      hints_revealed           INTEGER NOT NULL DEFAULT 0,
      target_file              TEXT,
      target_function_or_block TEXT,
      validation_criteria      TEXT NOT NULL,
      estimated_minutes        INTEGER NOT NULL,
      status                   TEXT NOT NULL DEFAULT 'locked',
      completion_method        TEXT,
      completed_at             TEXT
    );

    CREATE TABLE IF NOT EXISTS code_learning_messages (
      id         TEXT PRIMARY KEY,
      step_id    TEXT NOT NULL REFERENCES code_learning_steps(id),
      role       TEXT NOT NULL,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_learning_step_summaries (
      step_id                       TEXT PRIMARY KEY REFERENCES code_learning_steps(id),
      summary                       TEXT NOT NULL,
      summarized_through_message_id TEXT NOT NULL,
      created_at                    TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_code_learning_projects_status ON code_learning_projects(status);
    CREATE INDEX IF NOT EXISTS idx_code_learning_projects_updated ON code_learning_projects(updated_at);
    CREATE INDEX IF NOT EXISTS idx_code_learning_steps_project ON code_learning_steps(project_id);
    CREATE INDEX IF NOT EXISTS idx_code_learning_messages_step ON code_learning_messages(step_id);
  `)
}

export function prunePostSessions(db: Database.Database, keepCount = 20): void {
  const sessions = db.prepare(
    `SELECT id FROM post_sessions ORDER BY updated_at DESC LIMIT -1 OFFSET ?`
  ).all(keepCount) as { id: number }[]
  if (sessions.length > 0) {
    const ids = sessions.map((s) => s.id).join(',')
    db.exec(`DELETE FROM post_sessions WHERE id IN (${ids})`)
  }
}
