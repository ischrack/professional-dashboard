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

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_papers_doi ON papers(doi);
    CREATE INDEX IF NOT EXISTS idx_papers_pmid ON papers(pmid);
    CREATE INDEX IF NOT EXISTS idx_papers_added_at ON papers(added_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_added_at ON jobs(added_at);
    CREATE INDEX IF NOT EXISTS idx_post_sessions_updated ON post_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_qa_templates ON qa_entries(is_template);
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
