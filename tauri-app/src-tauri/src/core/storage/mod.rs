use std::collections::HashSet;
use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use tracing::info;

use crate::core::errors::{AppError, AppResult};
use crate::core::models::{AppSettings, DownloadJob};

const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Persistent storage backed by SQLite.
pub struct Storage {
    conn: Connection,
}

impl Storage {
    /// Open (or create) the database at the given path.
    pub fn open(db_path: &Path) -> AppResult<Self> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let conn = Connection::open(db_path)
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        let mut storage = Self { conn };
        storage.run_migrations()?;
        Ok(storage)
    }

    fn run_migrations(&mut self) -> AppResult<()> {
        let version: u32 = self
            .conn
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap_or(0);

        if version < 1 {
            self.migrate_v1()?;
        }

        self.conn
            .pragma_update(None, "user_version", CURRENT_SCHEMA_VERSION)
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        info!("Database at schema version {}", CURRENT_SCHEMA_VERSION);
        Ok(())
    }

    fn migrate_v1(&self) -> AppResult<()> {
        self.conn
            .execute_batch(
                "
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS downloaded_hashes (
                hash TEXT NOT NULL,
                child_id TEXT NOT NULL,
                downloaded_at TEXT NOT NULL,
                dest_path TEXT,
                PRIMARY KEY (hash, child_id)
            );

            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                total_items INTEGER NOT NULL DEFAULT 0,
                completed_items INTEGER NOT NULL DEFAULT 0,
                failed_items INTEGER NOT NULL DEFAULT 0,
                skipped_items INTEGER NOT NULL DEFAULT 0,
                bytes_downloaded INTEGER NOT NULL DEFAULT 0,
                settings_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS job_items (
                id TEXT PRIMARY KEY,
                job_id TEXT NOT NULL REFERENCES jobs(id),
                child_id TEXT NOT NULL,
                photo_hash TEXT NOT NULL,
                photo_url TEXT NOT NULL,
                status TEXT NOT NULL,
                dest_path TEXT,
                retry_count INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                bytes_downloaded INTEGER NOT NULL DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_downloaded_hashes_child
                ON downloaded_hashes(child_id);
            CREATE INDEX IF NOT EXISTS idx_job_items_job
                ON job_items(job_id);
            CREATE INDEX IF NOT EXISTS idx_job_items_status
                ON job_items(status);
            ",
            )
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        info!("Migrated database to v1");
        Ok(())
    }

    // ── Settings ──

    pub fn save_settings(&self, settings: &AppSettings) -> AppResult<()> {
        let json = serde_json::to_string(settings)?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('app_settings', ?1)",
                params![json],
            )
            .map_err(|e| AppError::StorageError(e.to_string()))?;
        Ok(())
    }

    pub fn load_settings(&self) -> AppResult<Option<AppSettings>> {
        let result: Option<String> = self
            .conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'app_settings'",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        match result {
            Some(json) => Ok(Some(serde_json::from_str(&json)?)),
            None => Ok(None),
        }
    }

    // ── Downloaded hashes ──

    pub fn get_downloaded_hashes(&self, child_id: &str) -> AppResult<HashSet<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT hash FROM downloaded_hashes WHERE child_id = ?1")
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        let hashes = stmt
            .query_map(params![child_id], |row| row.get::<_, String>(0))
            .map_err(|e| AppError::StorageError(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(hashes)
    }

    pub fn mark_downloaded(
        &self,
        hash: &str,
        child_id: &str,
        dest_path: Option<&str>,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        self.conn
            .execute(
                "INSERT OR IGNORE INTO downloaded_hashes (hash, child_id, downloaded_at, dest_path) VALUES (?1, ?2, ?3, ?4)",
                params![hash, child_id, now, dest_path],
            )
            .map_err(|e| AppError::StorageError(e.to_string()))?;
        Ok(())
    }

    pub fn get_total_downloaded(&self, child_id: &str) -> AppResult<u32> {
        let count: u32 = self
            .conn
            .query_row(
                "SELECT COUNT(*) FROM downloaded_hashes WHERE child_id = ?1",
                params![child_id],
                |row| row.get(0),
            )
            .map_err(|e| AppError::StorageError(e.to_string()))?;
        Ok(count)
    }

    // ── Jobs ──

    pub fn save_job(&self, job: &DownloadJob) -> AppResult<()> {
        let settings_json = serde_json::to_string(&job.settings_snapshot)?;
        self.conn
            .execute(
                "INSERT OR REPLACE INTO jobs (id, status, created_at, updated_at, completed_at, total_items, completed_items, failed_items, skipped_items, bytes_downloaded, settings_json)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    job.id,
                    format!("{:?}", job.status),
                    job.created_at.to_rfc3339(),
                    job.updated_at.to_rfc3339(),
                    job.completed_at.map(|d| d.to_rfc3339()),
                    job.total_items,
                    job.completed_items,
                    job.failed_items,
                    job.skipped_items,
                    job.bytes_downloaded,
                    settings_json,
                ],
            )
            .map_err(|e| AppError::StorageError(e.to_string()))?;
        Ok(())
    }

    pub fn get_recent_jobs(&self, limit: u32) -> AppResult<Vec<(String, String, String, u32, u32, u32, u32)>> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, status, created_at, completed_items, failed_items, skipped_items, total_items
                 FROM jobs ORDER BY created_at DESC LIMIT ?1",
            )
            .map_err(|e| AppError::StorageError(e.to_string()))?;

        let jobs = stmt
            .query_map(params![limit], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, u32>(4)?,
                    row.get::<_, u32>(5)?,
                    row.get::<_, u32>(6)?,
                ))
            })
            .map_err(|e| AppError::StorageError(e.to_string()))?
            .filter_map(|r| r.ok())
            .collect();

        Ok(jobs)
    }

    /// Get the last incomplete job for resume.
    pub fn get_incomplete_job(&self) -> AppResult<Option<String>> {
        let result: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM jobs WHERE status NOT IN ('Completed', 'CompletedWithErrors', 'Failed', 'Cancelled')
                 ORDER BY created_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| AppError::StorageError(e.to_string()))?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::models::ChildConfig;
    use tempfile::tempdir;

    fn test_storage() -> Storage {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        Storage::open(&db_path).unwrap()
    }

    #[test]
    fn test_settings_roundtrip() {
        let storage = test_storage();
        let settings = AppSettings {
            school_id: "2521".into(),
            children: vec![ChildConfig {
                id: "123".into(),
                name: "Test".into(),
            }],
            output_dir: "/tmp/photos".into(),
            concurrency: 3,
            safe_mode: false,
        };

        storage.save_settings(&settings).unwrap();
        let loaded = storage.load_settings().unwrap().unwrap();
        assert_eq!(loaded.school_id, "2521");
        assert_eq!(loaded.children.len(), 1);
    }

    #[test]
    fn test_downloaded_hashes() {
        let storage = test_storage();
        storage
            .mark_downloaded("hash1", "child1", Some("/tmp/photo.jpg"))
            .unwrap();
        storage
            .mark_downloaded("hash2", "child1", None)
            .unwrap();
        storage
            .mark_downloaded("hash3", "child2", None)
            .unwrap();

        let hashes = storage.get_downloaded_hashes("child1").unwrap();
        assert_eq!(hashes.len(), 2);
        assert!(hashes.contains("hash1"));
        assert!(hashes.contains("hash2"));

        let total = storage.get_total_downloaded("child1").unwrap();
        assert_eq!(total, 2);
    }

    #[test]
    fn test_no_duplicate_hashes() {
        let storage = test_storage();
        storage.mark_downloaded("hash1", "child1", None).unwrap();
        storage.mark_downloaded("hash1", "child1", None).unwrap();

        let hashes = storage.get_downloaded_hashes("child1").unwrap();
        assert_eq!(hashes.len(), 1);
    }
}
