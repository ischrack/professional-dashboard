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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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
  `)
}

export function runMigrations(db: Database.Database): void {
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
